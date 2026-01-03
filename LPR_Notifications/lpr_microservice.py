#!/usr/bin/env python3
"""
UniFi Protect LPR to MongoDB Microservice
Continuously captures license plate detections and stores them

Usage:
  python lpr_microservice.py              # Run with default 60-second timeout
  python lpr_microservice.py 0            # Run continuously (0 = infinite)
  python lpr_microservice.py 300          # Run for 5 minutes
"""

import asyncio
import os
import sys
import json
import logging
from datetime import datetime
from dotenv import load_dotenv

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

def mask_plate(plate: str) -> str:
    """Mask a license plate for logging unless ALLOW_RAW_PLATE_LOG or ALLOW_RAW_LOGS is true."""
    if os.getenv('ALLOW_RAW_PLATE_LOG', 'false').lower() == 'true' or os.getenv('ALLOW_RAW_LOGS', 'false').lower() == 'true':
        return plate
    if not plate:
        return ''
    if len(plate) <= 2:
        return '*' * len(plate)
    return '*' * (len(plate) - 2) + plate[-2:]

class LPRMicroservice:
    """Microservice to capture LPR events and store in MongoDB"""
    
    def __init__(self, listen_duration=60):
        """Initialize the microservice"""
        self.listen_duration = listen_duration
        self.protect = None
        self.mongo_client = None
        self.db = None
        self.lpr_collection = None
        self.event_count = {'detected': 0, 'stored': 0, 'errors': 0}
        
    async def connect_protect(self):
        """Connect to UniFi Protect console"""
        try:
            from uiprotect import ProtectApiClient
            
            api_key = os.getenv('UNIFI_PROTECT_API_KEY')
            host = os.getenv('UNIFI_PROTECT_HOST')
            if not host:
                logger.error('UNIFI_PROTECT_HOST not set. See .env.example')
                return False
            port = int(os.getenv('UNIFI_PROTECT_PORT', '443'))
            username = os.getenv('UNIFI_PROTECT_USERNAME')
            password = os.getenv('UNIFI_PROTECT_PASSWORD')
            
            # Require either an API key or username+password
            if not api_key and not (username and password):
                logger.error('Missing UniFi Protect credentials or API key. Set UNIFI_PROTECT_API_KEY or UNIFI_PROTECT_USERNAME+UNIFI_PROTECT_PASSWORD (see .env.example)')
                return False

            verify_ssl = os.getenv('UNIFI_PROTECT_VERIFY_SSL', 'true').lower() in ('1','true','yes')
            
            self.protect = ProtectApiClient(
                host=host,
                port=port,
                username=username,
                password=password,
                verify_ssl=verify_ssl,
                api_key=api_key
            )
            
            await self.protect.update()
            logger.info("✓ Connected to UniFi Protect")
            
            # Get camera info
            self.cameras_by_id = {
                cam_id: cam.name 
                for cam_id, cam in self.protect.bootstrap.cameras.items()
            }
            
            lpr_cameras = [
                cam_id for cam_id, cam in self.protect.bootstrap.cameras.items()
                if cam.can_detect_license_plate and cam.is_license_plate_detection_on
            ]
            self.lpr_camera_ids = lpr_cameras

            logger.info(f"LPR Cameras Configured: {len(lpr_cameras)}")
            for cam_id in lpr_cameras:
                logger.info(f"  • {self.cameras_by_id[cam_id]}")
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to connect to Protect: {e}")
            return False
    
    def connect_mongodb(self):
        """Connect to MongoDB"""
        try:
            from pymongo import MongoClient
            
            mongo_url = os.getenv('MONGO_URL')
            if not mongo_url:
                print('Error: MONGO_URL not set. See .env.example')
                sys.exit(1)
            self.mongo_client = MongoClient(mongo_url)
            self.db = self.mongo_client.get_database()
            self.lpr_collection = self.db['license_plate_detections']
            
            # Create indexes
            self.lpr_collection.create_index('timestamp')
            self.lpr_collection.create_index('license_plate')
            self.lpr_collection.create_index('camera_name')
            
            logger.info("✓ Connected to MongoDB (license_plate_detections)")
            return True
            
        except Exception as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            return False
    
    def on_event(self, msg):
        """Handle WebSocket events"""
        try:
            # Check if this looks like a detection event
            msg_str = str(msg).lower()
            
            # Parse the message
            event_data = {
                'timestamp': datetime.utcnow(),
                'received_at': datetime.utcnow().isoformat(),
                'message_type': getattr(msg, 'action_frame', 'unknown'),
                'created': datetime.utcnow(),
                'origin': 'microservice'
            }
            
            # Extract data from message
            if hasattr(msg, '__dict__'):
                for key, val in msg.__dict__.items():
                    if val and not callable(val):
                        try:
                            event_data[key] = str(val)[:500]  # Limit string length
                        except:
                            pass

            # Optionally redact verbose fields unless explicitly allowed
            if os.getenv('STORE_RAW_MESSAGES', 'false').lower() != 'true' and os.getenv('ALLOW_RAW_LOGS', 'false').lower() != 'true':
                if 'raw_message' in event_data:
                    event_data['raw_message'] = '[REDACTED]'
                if 'detected_thumbnails' in event_data:
                    event_data['detected_thumbnails'] = '[REDACTED]'
            
            # Check for LPR/detection keywords
            has_lpr_data = any(
                keyword in msg_str 
                for keyword in ['license', 'plate', 'licensePlate', 'vehicle', 'detection', 'smart']
            )
            
            if has_lpr_data:
                self.event_count['detected'] += 1

                # Attempt to determine camera and license plate presence
                camera_id = event_data.get('camera_id') or event_data.get('camera') or None
                camera_name = None
                if camera_id and camera_id in self.cameras_by_id:
                    camera_name = self.cameras_by_id[camera_id]

                # Try to detect license plate string in the raw message or detected_thumbnails
                license_plate = None
                try:
                    import re
                    # look for name='PLATE'
                    m = re.search(r"name=(?:'|\")?([A-Z0-9-]{2,})", event_data.get('raw_message',''), re.I)
                    if m:
                        license_plate = m.group(1)
                    else:
                        # fallback: search detected_thumbnails string for 'name='
                        td = event_data.get('detected_thumbnails','')
                        m2 = re.search(r"name=(?:'|\")?([A-Z0-9-]{2,})", str(td), re.I)
                        if m2:
                            license_plate = m2.group(1)
                except Exception:
                    license_plate = None

                # Require a license plate to store events. If none detected, skip and log.
                if not license_plate:
                    logger.info(f"Skipping store: no license plate found in event (camera_name={camera_name}, camera_id={camera_id})")
                    return

                # Ensure camera is a known LPR camera; if not, log and skip
                if hasattr(self, 'lpr_camera_ids') and camera_id and camera_id not in self.lpr_camera_ids:
                    logger.info(f"Skipping store: camera_id {camera_id} not in configured LPR cameras (camera_name={camera_name})")
                    return

                # Additional guard: skip cameras matching common non-LPR substrings (Entry/Exit) unless explicitly allowed
                skip_subs = [s.strip().lower() for s in os.getenv('LPR_SKIP_CAMERA_SUBSTRINGS', 'Entry,Exit,Kiosk').split(',') if s.strip()]
                if camera_name and any(sub in camera_name.lower() for sub in skip_subs):
                    logger.info(f"Skipping store: camera_name '{camera_name}' matches skip substrings {skip_subs}")
                    return

                # Store in MongoDB
                try:
                    # Prepare stored data: mask plate unless raw allowed, and optionally keep raw plate if allowed
                    allow_raw_plate = (os.getenv('ALLOW_RAW_PLATE_LOG', 'false').lower() == 'true') or (os.getenv('ALLOW_RAW_LOGS', 'false').lower() == 'true')
                    store_raw_messages = os.getenv('STORE_RAW_MESSAGES', 'false').lower() == 'true'
                    
                    def _mask_plate(p):
                        if not p:
                            return ''
                        if allow_raw_plate:
                            return p
                        if len(p) <= 2:
                            return '*' * len(p)
                        return '*' * (len(p) - 2) + p[-2:]
                    
                    if store_raw_messages or allow_raw_plate:
                        event_data['license_plate_raw'] = license_plate
                    event_data['license_plate'] = _mask_plate(license_plate)
                    
                    # redact verbose fields if not allowed
                    if not store_raw_messages and os.getenv('ALLOW_RAW_LOGS', 'false').lower() != 'true':
                        if 'detected_thumbnails' in event_data:
                            event_data['detected_thumbnails'] = '[REDACTED]'
                    
                    result = self.lpr_collection.insert_one(event_data)
                    self.event_count['stored'] += 1
                    masked_plate = event_data.get('license_plate', '[REDACTED]')
                    logger.info(f"✓ Event stored: {result.inserted_id} (camera: {camera_name or camera_id}, plate: {masked_plate})")

                except Exception as e:
                    self.event_count['errors'] += 1
                    logger.error(f"Failed to store event: {e}")
        
        except Exception as e:
            self.event_count['errors'] += 1
            logger.error(f"Error processing event: {e}")
    
    async def run(self):
        """Run the microservice"""
        
        print(f"\n{'='*70}")
        print("UniFi Protect LPR Microservice")
        print(f"{'='*70}\n")
        
        # Connect to services
        if not await self.connect_protect():
            return False
        
        if not self.connect_mongodb():
            return False
        
        # Start listening
        try:
            logger.info(f"\nListening for LPR events (duration: {self.listen_duration}s)...")
            logger.info("Drive a vehicle past an LPR camera to capture a detection.\n")
            
            unsub = self.protect.subscribe_websocket(self.on_event)
            
            # Listen for specified duration
            if self.listen_duration == 0:
                # Run indefinitely (until KeyboardInterrupt)
                while True:
                    await asyncio.sleep(1)
            else:
                # Run for specified duration
                await asyncio.sleep(self.listen_duration)
            
            unsub()
            
        except KeyboardInterrupt:
            logger.info("\n\nShutdown requested")
        except Exception as e:
            logger.error(f"Error during listening: {e}")
        finally:
            await self.protect.close_session()
        
        # Summary
        self.print_summary()
        return True
    
    def print_summary(self):
        """Print summary of operations"""
        print(f"\n{'='*70}")
        print("Microservice Summary")
        print(f"{'='*70}")
        print(f"Events detected: {self.event_count['detected']}")
        print(f"Events stored: {self.event_count['stored']}")
        print(f"Errors: {self.event_count['errors']}")
        
        if self.event_count['stored'] > 0:
            print(f"\nRecent events in MongoDB:\n")
            for doc in self.lpr_collection.find().sort('timestamp', -1).limit(3):
                print(f"  • {doc['timestamp']}: {doc.get('message_type', 'unknown')}")
        
        print(f"\n{'='*70}\n")
        
        if self.mongo_client:
            self.mongo_client.close()

async def main():
    """Main entry point"""
    
    # Get listen duration from command line
    duration = 60  # Default: 60 seconds
    if len(sys.argv) > 1:
        try:
            duration = int(sys.argv[1])
        except ValueError:
            print(f"Invalid duration: {sys.argv[1]}")
            print("Usage: python lpr_microservice.py [duration_in_seconds]")
            print("       python lpr_microservice.py 0  # Run continuously")
            sys.exit(1)
    
    service = LPRMicroservice(listen_duration=duration)
    success = await service.run()
    
    sys.exit(0 if success else 1)

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\nShutting down...")
        sys.exit(0)
