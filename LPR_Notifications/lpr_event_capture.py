#!/usr/bin/env python3
"""
UniFi Protect LPR Event Capture Service
Continuously polls for license plate detection events from the 2 LPR cameras
Stores all detected plates in MongoDB with full metadata

Usage:
  python lpr_event_capture.py              # Run continuously
  python lpr_event_capture.py 300          # Run for 5 minutes then exit
"""

import asyncio
import os
import sys
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List
import time

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Environment variables
PROTECT_HOST = os.getenv('UNIFI_PROTECT_HOST')
if not PROTECT_HOST:
    print('Error: UNIFI_PROTECT_HOST not set. See .env.example')
    sys.exit(1)
PROTECT_PORT = 443
PROTECT_USERNAME = os.getenv('UNIFI_PROTECT_USERNAME')
PROTECT_PASSWORD = os.getenv('UNIFI_PROTECT_PASSWORD', '')
PROTECT_API_KEY = os.getenv('UNIFI_PROTECT_API_KEY', '')

MONGO_URL = os.getenv('MONGO_URL')
if not MONGO_URL:
    print('Error: MONGO_URL not set. See .env.example')
    sys.exit(1)

import re

# Shared sanitizer helper
from LPR_Notifications.lpr_helpers import sanitize_plate

PLATE_REGEX = re.compile(r'^[A-Z0-9-]{2,}$')
MIN_CONF = int(os.getenv('LPR_MIN_CONF', '50'))


class LPREventCapture:
    """Capture license plate detection events from Protect API"""
    
    def __init__(self, duration=0):
        """Initialize event capture service"""
        self.duration = duration  # 0 = infinite, n = seconds
        self.protect = None
        self.mongo_client = None
        self.db = None
        self.lpr_collection = None
        self.lpr_camera_ids = []
        self.lpr_camera_names = {}
        self.stats = {
            'total_events_checked': 0,
            'lpr_events_found': 0,
            'plates_captured': 0,
            'errors': 0
        }
        self.last_event_id = None
        
    async def connect_protect(self) -> bool:
        """Connect to UniFi Protect"""
        try:
            from uiprotect import ProtectApiClient
            
            self.protect = ProtectApiClient(
                host=PROTECT_HOST,
                port=PROTECT_PORT,
                username=PROTECT_USERNAME,
                password=PROTECT_PASSWORD,
                verify_ssl=os.getenv('UNIFI_PROTECT_VERIFY_SSL', 'true').lower() in ('1','true','yes'),
                api_key=PROTECT_API_KEY
            )
            
            await self.protect.update()
            logger.info("✓ Connected to UniFi Protect")
            
            # Identify the 2 LPR cameras
            lpr_cams = [
                (cam_id, cam.name) 
                for cam_id, cam in self.protect.bootstrap.cameras.items()
                if cam.type == 'UVC AI LPR'
            ]
            
            self.lpr_camera_ids = [cid for cid, _ in lpr_cams]
            self.lpr_camera_names = {cid: name for cid, name in lpr_cams}
            
            logger.info(f"✓ Found {len(self.lpr_camera_ids)} LPR Cameras:")
            for cam_id, name in self.lpr_camera_names.items():
                logger.info(f"  • {name} ({cam_id})")
            
            return True
            
        except Exception as e:
            logger.error(f"✗ Failed to connect to Protect: {e}")
            return False
    
    def connect_mongodb(self) -> bool:
        """Connect to MongoDB"""
        try:
            from pymongo import MongoClient
            
            self.mongo_client = MongoClient(MONGO_URL)
            self.db = self.mongo_client.get_database()
            self.lpr_collection = self.db['license_plates']
            
            # Create indexes for fast queries
            self.lpr_collection.create_index('timestamp')
            self.lpr_collection.create_index('license_plate')
            self.lpr_collection.create_index('camera_id')
            self.lpr_collection.create_index('protect_event_id', unique=True)
            
            logger.info(f"✓ Connected to MongoDB (db: {self.db.name})")
            logger.info(f"✓ Using collection: license_plates")
            
            return True
            
        except Exception as e:
            logger.error(f"✗ Failed to connect to MongoDB: {e}")
            return False
    
    async def fetch_and_process_events(self):
        """Fetch events and process LPR detections"""
        try:
            # Query events from last 24 hours
            start_time = datetime.utcnow() - timedelta(days=1)
            
            # Get all events
            events = await self.protect.get_events(
                start=start_time,
                limit=1000
            )
            
            self.stats['total_events_checked'] = len(events)
            
            for event in events:
                try:
                    # Skip if not from an LPR camera
                    if event.camera_id not in self.lpr_camera_ids:
                        continue
                    
                    # Check if event has license plate detection
                    if not hasattr(event, 'smart_detect_types'):
                        continue
                    
                    # Check if licensePlate was detected
                    if 'licensePlate' not in (event.smart_detect_types or []):
                        continue
                    
                    # Check if already stored
                    existing = self.lpr_collection.find_one({
                        'protect_event_id': event.id
                    })
                    
                    if existing:
                        continue  # Already stored
                    
                    # Extract license plate data
                    camera_name = self.lpr_camera_names.get(
                        event.camera_id, 
                        'Unknown'
                    )

                    # Attempt to find a recognized license plate in detected_thumbnails (sanitize)
                    license_plate = None
                    confidence = 0
                    if hasattr(event, 'metadata') and event.metadata:
                        try:
                            thumbs = getattr(event.metadata, 'detected_thumbnails', [])
                            for thumb in thumbs:
                                if getattr(thumb, 'type', None) == 'vehicle':
                                    cand = getattr(thumb, 'name', None)
                                    plate = sanitize_plate(cand)
                                    if plate:
                                        license_plate = plate
                                        confidence = getattr(thumb, 'confidence', 0)
                                        break
                        except Exception:
                            pass

                    # If no license plate was found, skip storing this event
                    if not license_plate:
                        self.stats['errors'] += 1
                        logger.debug(f"Skipping event {getattr(event, 'id', None)} from {camera_name}: no license plate detected")
                        continue

                    # Validate plate format and confidence
                    if not PLATE_REGEX.match(license_plate):
                        logger.info(f"Skipping store for event {event.id}: invalid license_plate '{license_plate}'")
                        continue
                    try:
                        conf_val = int(confidence) if confidence is not None else 0
                    except Exception:
                        conf_val = 0
                    if conf_val < MIN_CONF:
                        logger.info(f"Skipping store for event {event.id}: confidence {conf_val} < MIN_CONF {MIN_CONF}")
                        continue

                    # Store event
                    doc = {
                        'protect_event_id': event.id,
                        'timestamp': event.start,
                        'end_time': event.end,
                        'camera_id': event.camera_id,
                        'camera_name': camera_name,
                        'event_type': 'licensePlate',
                        'smart_detect_types': event.smart_detect_types,
                        'thumbnail': event.thumbnail,
                        'license_plate': license_plate,
                        'confidence': confidence,
                    'origin': 'event_capture',
                    
                    # Attach metadata if available
                    if hasattr(event, 'metadata') and event.metadata:
                        doc['metadata'] = event.metadata

                    # Guard: enforce allowed cameras if configured, otherwise skip common non-LPR substrings
                    cam = doc.get('camera_name') or ''
                    cam_id = doc.get('camera_id')
                    allowed_ids = {s.strip() for s in os.getenv('LPR_CAMERA_IDS', '').split(',') if s.strip()}
                    allowed_names = [s.strip() for s in os.getenv('LPR_CAMERA_NAMES', '').split(',') if s.strip()]
                    skip_subs = [s.strip().lower() for s in os.getenv('LPR_SKIP_CAMERA_SUBSTRINGS', 'Entry,Exit,Kiosk').split(',') if s.strip()]

                    if allowed_ids and cam_id not in allowed_ids:
                        logger.info(f"Skipping store for event {event.id}: camera_id {cam_id} not in LPR_CAMERA_IDS")
                        continue
                    if allowed_names and not any(sub in cam for sub in allowed_names):
                        logger.info(f"Skipping store for event {event.id}: camera_name '{cam}' not matching LPR_CAMERA_NAMES")
                        continue
                    if not allowed_ids and not allowed_names and any(sub in cam.lower() for sub in skip_subs):
                        logger.info(f"Skipping store for event {event.id}: camera '{cam}' matches skip substrings {skip_subs}")
                        continue

                    try:
                        result = self.lpr_collection.insert_one(doc)
                        self.stats['lpr_events_found'] += 1
                        self.stats['plates_captured'] += 1
                        logger.info(f"✓ Stored LPR event from {camera_name}: {event.id} (plate: {license_plate})")
                    except Exception as e:
                        logger.error(f"Mongo write failed for event {event.id} (plate={license_plate}, camera={cam}, camera_id={cam_id}): {e}")
                        try:
                            if self.db:
                                self.db.get_collection('license_plate_write_errors').insert_one({
                                    'event_id': event.id,
                                    'camera_id': cam_id,
                                    'camera_name': cam,
                                    'license_plate': license_plate,
                                    'confidence': confidence,
                                    'error': str(e),
                                    'timestamp': datetime.utcnow()
                                })
                        except Exception:
                            pass
                    
                except Exception as e:
                    logger.debug(f"Error processing event: {e}")
                    self.stats['errors'] += 1
        
        except Exception as e:
            logger.error(f"Error fetching events: {e}")
            self.stats['errors'] += 1
    
    async def run(self):
        """Main event capture loop"""
        if not await self.connect_protect():
            return
        
        if not self.connect_mongodb():
            return
        
        logger.info(f"\n{'='*70}")
        logger.info(f"🎯 License Plate Event Capture Started")
        logger.info(f"{'='*70}\n")
        
        if self.duration > 0:
            logger.info(f"⏱️  Running for {self.duration} seconds...")
        else:
            logger.info(f"⏱️  Running continuously (Ctrl+C to stop)...")
        
        start_time = time.time()
        poll_interval = 10  # Poll every 10 seconds
        
        try:
            while True:
                # Check if duration exceeded
                if self.duration > 0:
                    elapsed = time.time() - start_time
                    if elapsed > self.duration:
                        logger.info(f"\n⏱️  Duration limit reached ({self.duration}s)")
                        break
                
                logger.debug("Checking for new LPR events...")
                await self.fetch_and_process_events()
                
                # Wait before next poll
                await asyncio.sleep(poll_interval)
                
        except KeyboardInterrupt:
            logger.info("\n⚠️  Interrupted by user")
        except Exception as e:
            logger.error(f"Error in main loop: {e}")
        finally:
            self.print_summary()
            if self.mongo_client:
                self.mongo_client.close()
    
    def print_summary(self):
        """Print execution summary"""
        logger.info(f"\n{'='*70}")
        logger.info("📊 SUMMARY")
        logger.info(f"{'='*70}")
        logger.info(f"Events checked:      {self.stats['total_events_checked']}")
        logger.info(f"LPR events found:    {self.stats['lpr_events_found']}")
        logger.info(f"Plates captured:     {self.stats['plates_captured']}")
        logger.info(f"Errors:              {self.stats['errors']}")
        
        if self.lpr_collection:
            total_stored = self.lpr_collection.count_documents({})
            logger.info(f"\nTotal plates in MongoDB: {total_stored}")
        
        if self.stats['plates_captured'] > 0:
            logger.info(f"\n✅ Successfully captured {self.stats['plates_captured']} license plates")
        else:
            logger.info(f"\n⚠️  No license plate detections found")
            logger.info("    (Check Protect UI to verify LPR is detecting plates)")
        
        logger.info(f"{'='*70}\n")


async def main():
    """Main entry point"""
    duration = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    
    service = LPREventCapture(duration=duration)
    await service.run()


if __name__ == '__main__':
    asyncio.run(main())
