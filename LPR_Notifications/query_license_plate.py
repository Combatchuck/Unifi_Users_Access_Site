#!/usr/bin/env python3
"""
Query UniFi Protect for license plate detection history
"""

import asyncio
import os
import sys
from dotenv import load_dotenv
from datetime import datetime, timedelta

# Load environment variables
load_dotenv()

async def query_license_plate(plate_number):
    """Query for license plate detections"""
    
    try:
        from uiprotect import ProtectApiClient
    except ImportError:
        print("ERROR: uiprotect not installed. Run: pip install uiprotect")
        sys.exit(1)
    
    # Get connection details from .env
    api_key = os.getenv('UNIFI_PROTECT_API_KEY')
    host = os.getenv('UNIFI_PROTECT_HOST')
    if not host:
        print('Error: UNIFI_PROTECT_HOST not set. See .env.example')
        sys.exit(1)
    port = 443
    username = os.getenv('UNIFI_PROTECT_USERNAME')
    password = os.getenv('UNIFI_PROTECT_PASSWORD', '')
    
    print(f"\n{'='*70}")
    print(f"License Plate Query: {plate_number}")
    print(f"{'='*70}")
    print(f"Connecting to: {host}:{port}")
    print(f"Username: {username}\n")
    
    try:
        # Initialize and connect
        protect = ProtectApiClient(
            host=host,
            port=port,
            username=username,
            password=password,
            verify_ssl=os.getenv('UNIFI_PROTECT_VERIFY_SSL', 'true').lower() in ('1','true','yes'),
            api_key=api_key
        )
        
        print("[1] Connecting to UniFi Protect...")
        await protect.update()
        print("✓ Connected\n")
        
        # Get events with a larger limit to search through
        print(f"[2] Querying events for license plate '{plate_number}'...")
        events = await protect.get_events(limit=100)
        
        if not events:
            print(f"No events found\n")
            return
        
        print(f"Retrieved {len(events)} events. Searching for plate...\n")
        
        # Search through events for the license plate
        found_events = []
        
        for event in events:
            # Check various attributes where plate data might be stored
            event_dict = {}
            
            # Try to get event as dict/object
            if hasattr(event, 'dict'):
                try:
                    event_dict = event.dict()
                except:
                    pass
            
            # Search through event attributes
            event_str = str(event).lower()
            if plate_number.lower() in event_str:
                found_events.append(event)
                continue
            
            # Check specific attributes
            if hasattr(event, 'description') and event.description:
                if plate_number.lower() in str(event.description).lower():
                    found_events.append(event)
                    continue
            
            if hasattr(event, 'type') and event.type:
                if 'recognition' in str(event.type).lower() or 'plate' in str(event.type).lower():
                    # This might be a recognition event, check it
                    if hasattr(event, 'data'):
                        try:
                            data_str = str(event.data).lower()
                            if plate_number.lower() in data_str:
                                found_events.append(event)
                        except:
                            pass
        
        # Display results
        if found_events:
            print(f"{'='*70}")
            print(f"✓ FOUND {len(found_events)} detection(s) for plate: {plate_number}")
            print(f"{'='*70}\n")
            
            for idx, event in enumerate(found_events[:10], 1):  # Show first 10
                print(f"Detection #{idx}:")
                
                if hasattr(event, 'start'):
                    print(f"  Time: {event.start}")
                if hasattr(event, 'end'):
                    print(f"  End: {event.end}")
                if hasattr(event, 'type'):
                    print(f"  Type: {event.type}")
                if hasattr(event, 'camera_id'):
                    print(f"  Camera ID: {event.camera_id}")
                    # Try to get camera name
                    if event.camera_id in protect.bootstrap.cameras:
                        camera = protect.bootstrap.cameras[event.camera_id]
                        if hasattr(camera, 'name'):
                            print(f"  Camera: {camera.name}")
                if hasattr(event, 'description'):
                    print(f"  Description: {event.description}")
                
                # Show all attributes for debugging
                if hasattr(event, '__dict__'):
                    attrs = [a for a in dir(event) if not a.startswith('_') and not callable(getattr(event, a))]
                    for attr in attrs[:5]:  # Show first 5 relevant attributes
                        try:
                            val = getattr(event, attr)
                            if val and not isinstance(val, (dict, list)):
                                print(f"  {attr}: {val}")
                        except:
                            pass
                
                print()
            
            # Show the most recent
            if found_events:
                latest = found_events[0]
                print(f"{'='*70}")
                print(f"MOST RECENT DETECTION: {plate_number}")
                if hasattr(latest, 'start'):
                    print(f"Time: {latest.start}")
                    # Calculate time ago
                    if hasattr(latest.start, 'timestamp'):
                        ts = latest.start.timestamp()
                        time_ago = datetime.now() - datetime.fromtimestamp(ts)
                        print(f"Time Ago: {time_ago}")
                print(f"{'='*70}\n")
        
        else:
            print(f"\n✗ License plate '{plate_number}' not found in recent events")
            print(f"\nSearched {len(events)} events from Protect system.")
            print(f"\nNote: LPR recognition data might require:")
            print(f"  - Real-time WebSocket subscription (not just events query)")
            print(f"  - Specific camera models with LPR capability")
            print(f"  - Protect version with LPR feature enabled\n")
        
        # Show available event types for reference
        print(f"Event types in system:")
        event_types = set()
        for event in events[:20]:
            if hasattr(event, 'type'):
                event_types.add(str(event.type))
        for etype in sorted(event_types):
            print(f"  - {etype}")
        
    except Exception as e:
        print(f"\n✗ Error: {e}")
        print(f"Error type: {type(e).__name__}\n")
        sys.exit(1)

if __name__ == '__main__':
    # Get plate from command line or use example
    plate = sys.argv[1] if len(sys.argv) > 1 else 'EBB212'
    asyncio.run(query_license_plate(plate))
