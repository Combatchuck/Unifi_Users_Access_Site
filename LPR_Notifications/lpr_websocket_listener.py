#!/usr/bin/env python3
"""
UniFi Protect LPR WebSocket Listener
Captures real-time license plate detections and stores in MongoDB
"""

import asyncio
import os
import sys
import json
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

async def listen_for_lpr_events():
    """Listen for LPR events via WebSocket and store in MongoDB"""
    
    try:
        from uiprotect import ProtectApiClient
        from pymongo import MongoClient
    except ImportError as e:
        print(f"ERROR: Missing required package: {e}")
        print("Install with: pip install uiprotect pymongo")
        sys.exit(1)
    
    # Get connection details from .env
    api_key = os.getenv('UNIFI_PROTECT_API_KEY')
    host = os.getenv('UNIFI_PROTECT_HOST')
    port = int(os.getenv('UNIFI_PROTECT_PORT', '443'))
    username = os.getenv('UNIFI_PROTECT_USERNAME')
    password = os.getenv('UNIFI_PROTECT_PASSWORD', '')
    if not host:
        print('Error: UNIFI_PROTECT_HOST not set. See .env.example')
        sys.exit(1)
    mongo_url = os.getenv('MONGO_URL')
    if not mongo_url:
        print('Error: MONGO_URL not set. See .env.example')
        sys.exit(1)
    
    print(f"\n{'='*70}")
    print("UniFi Protect LPR WebSocket Listener")
    print(f"{'='*70}")
    print(f"Protect Console: {host}:{port}")
    print(f"MongoDB: {mongo_url.split('@')[-1] if '@' in mongo_url else mongo_url}")
    print(f"{'='*70}\n")
    
    # Connect to Protect
    print("[1] Connecting to UniFi Protect...")
    protect = ProtectApiClient(
        host=host,
        port=port,
        username=username,
        password=password,
        verify_ssl=os.getenv('UNIFI_PROTECT_VERIFY_SSL', 'true').lower() in ('1','true','yes'),
        api_key=api_key
    )
    
    try:
        await protect.update()
        print("✓ Connected to Protect\n")
    except Exception as e:
        print(f"✗ Failed to connect: {e}\n")
        sys.exit(1)
    
    # Connect to MongoDB
    print("[2] Connecting to MongoDB...")
    try:
        mongo_client = MongoClient(mongo_url)
        db = mongo_client.get_database()
        
        # Create collections if they don't exist
        lpr_collection = db['license_plate_detections']
        
        # Create index on timestamp for faster queries
        lpr_collection.create_index('timestamp')
        lpr_collection.create_index('license_plate')
        lpr_collection.create_index('camera_name')
        
        print("✓ Connected to MongoDB")
        print(f"  Collection: license_plate_detections\n")
    except Exception as e:
        print(f"✗ Failed to connect to MongoDB: {e}\n")
        sys.exit(1)
    
    # Get camera info
    cameras_by_id = {cam_id: cam.name for cam_id, cam in protect.bootstrap.cameras.items()}
    lpr_cameras = [
        cam_id for cam_id, cam in protect.bootstrap.cameras.items()
        if cam.can_detect_license_plate and cam.is_license_plate_detection_on
    ]
    
    print(f"[3] LPR Cameras Configured:")
    for cam_id in lpr_cameras:
        print(f"  ✓ {cameras_by_id[cam_id]}")
    print()
    
    # Counter for events
    event_count = {'detected': 0, 'stored': 0}
    
    def on_event(msg):
        """Handle WebSocket messages"""
        try:
            # msg is a WSSubscriptionMessage
            # Check if it contains license plate data
            
            if not hasattr(msg, 'data') or not msg.data:
                return
            
            # Convert to dict for inspection
            msg_data = msg.data if isinstance(msg.data, dict) else {}
            msg_str = str(msg).lower()
            
            # Check if this is an LPR event
            if 'license' in msg_str or 'plate' in msg_str or 'licensePlate' in msg_str:
                event_count['detected'] += 1

                print(f"\n[LPR EVENT DETECTED] #{event_count['detected']}")
                print(f"{'─'*70}")

                # Extract event data
                try:
                    event_data = {
                        'timestamp': datetime.utcnow(),
                        'raw_message': str(msg),
                        'message_type': getattr(msg, 'action_frame', 'unknown'),
                        'origin': 'websocket_listener'
                    }

                    # Try to extract structured data
                    if hasattr(msg, '__dict__'):
                        for key, val in msg.__dict__.items():
                            if val and not callable(val):
                                event_data[key] = str(val)

                    # Determine camera and license plate presence for safety checks
                    camera_name = event_data.get('camera_name') or event_data.get('camera') or None
                    camera_id = event_data.get('camera_id') or event_data.get('camera') or None
                    # Try to find license plate in event_data
                    license_plate = None
                    try:
                        if 'detected_thumbnails' in event_data:
                            # naive check: look for 'name=' in stringified detected_thumbnails
                            td = event_data.get('detected_thumbnails')
                            if td and 'name=' in str(td):
                                # extract possible plate name heuristically
                                import re
                                m = re.search(r"name='?([A-Z0-9-]{2,})'?", str(td))
                                if m:
                                    license_plate = m.group(1)
                    except Exception:
                        pass

                    print("Event Data Captured:")
                    for key, val in event_data.items():
                        if key not in ['raw_message']:
                            print(f"  {key}: {val}")

                    # Require license plate to store events
                    if not license_plate:
                        print(f"Skipping storing event: no license plate detected (camera: {camera_name or camera_id}, message_type: {event_data.get('message_type')})")
                        return

                    # Ensure camera is LPR-configured (from bootstrap list)
                    if camera_id and camera_id not in lpr_cameras:
                        print(f"Skipping storing event: camera_id {camera_id} is not configured as an LPR camera (camera_name: {camera_name})")
                        return

                    # Store in MongoDB, include explicit license_plate for easier querying
                    event_data['license_plate'] = license_plate
                    result = lpr_collection.insert_one(event_data)
                    event_count['stored'] += 1

                    print(f"\n✓ Stored to MongoDB: {result.inserted_id} (camera: {camera_name}, plate: {license_plate})")
                    print(f"Total stored: {event_count['stored']}")

                except Exception as e:
                    print(f"Error processing event: {e}")
            
            # Also check for any smart detection events
            elif 'smart' in msg_str or 'detection' in msg_str:
                # Log all smart detection events to check format
                print(f"\n[SMART DETECTION EVENT]")
                print(f"Message: {str(msg)[:200]}...")
        
        except Exception as e:
            print(f"Error in on_event: {e}")
    
    # Subscribe to WebSocket
    print("[4] Subscribing to real-time events via WebSocket...")
    print("    Listening for license plate detections...\n")
    print(f"{'='*70}\n")
    
    try:
        unsub = protect.subscribe_websocket(on_event)
        
        # Keep listening for 60 seconds
        print("⏳ Listening for LPR events (60 seconds)...")
        print("   Drive a vehicle past an LPR camera to trigger a detection.\n")
        
        await asyncio.sleep(60)
        
        # Unsubscribe
        unsub()
        
    except KeyboardInterrupt:
        print("\n\nManually stopped listening")
        unsub()
    except Exception as e:
        print(f"Error in WebSocket: {e}")
    finally:
        await protect.close_session()
    
    # Summary
    print(f"\n{'='*70}")
    print("WebSocket Listener Summary")
    print(f"{'='*70}")
    print(f"License plate events detected: {event_count['detected']}")
    print(f"Events stored in MongoDB: {event_count['stored']}")
    print(f"{'='*70}\n")
    
    # Show stored data
    if event_count['stored'] > 0:
        print("Stored Events in MongoDB:\n")
        for doc in lpr_collection.find().sort('timestamp', -1).limit(5):
            print(f"  • {doc['timestamp']}: {doc}")
    
    mongo_client.close()

if __name__ == '__main__':
    print("\nNote: This script listens for 60 seconds.")
    print("For continuous monitoring, you can run this in a loop.\n")
    
    try:
        asyncio.run(listen_for_lpr_events())
    except KeyboardInterrupt:
        print("\n\nShutting down...")
        sys.exit(0)
