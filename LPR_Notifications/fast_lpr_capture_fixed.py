#!/usr/bin/env python3
"""
Fast LPR License Plate Capture Service - FIXED VERSION
Efficiently captures license plate detections from 2 LPR cameras
Stores directly to MongoDB with proper plate extraction

Usage:
  python fast_lpr_capture_fixed.py              # Run continuously
  python fast_lpr_capture_fixed.py 120          # Run for 2 minutes
"""

import asyncio
import os
import sys
import logging
from datetime import datetime, timedelta
from pymongo import MongoClient

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class FastLPRCapture:
    """Minimal, fast LPR capture service"""
    
    def __init__(self, duration=0, catchup_on_start=False):
        self.duration = duration
        self.protect = None
        self.db = None
        self.lpr_cameras = {}
        self.stats = {'detected': 0, 'stored': 0}
        self.last_check = datetime.utcnow()
        self.catchup_on_start = catchup_on_start
        
    async def start(self):
        """Start the service"""
        try:
            from uiprotect import ProtectApiClient
            
            # Connect to Protect
            self.protect = ProtectApiClient(
                host=os.getenv('UNIFI_PROTECT_HOST')
            if not host:
                print('Error: UNIFI_PROTECT_HOST not set. See .env.example')
                sys.exit(1)
                port=443,
                username=os.getenv('UNIFI_PROTECT_USERNAME'),
                password=os.getenv('UNIFI_PROTECT_PASSWORD', ''),
                verify_ssl=os.getenv('UNIFI_PROTECT_VERIFY_SSL', 'true').lower() in ('1','true','yes'),
                api_key=os.getenv('UNIFI_PROTECT_API_KEY', '')
            )
            
            await self.protect.update()
            logger.info("✓ Connected to UniFi Protect")
            
            # Get 2 LPR cameras
            self.lpr_cameras = {
                c.id: c.name 
                for c in self.protect.bootstrap.cameras.values() 
                if c.type == 'UVC AI LPR'
            }
            
            logger.info(f"✓ Monitoring {len(self.lpr_cameras)} LPR cameras:")
            for cid, name in self.lpr_cameras.items():
                logger.info(f"  • {name}")
            
        except Exception as e:
            logger.error(f"Failed to connect: {e}")
            return False
        
        # Connect to MongoDB
        try:
            mongo_url = os.getenv('MONGO_URL')
            if not mongo_url:
                print('Error: MONGO_URL not set. See .env.example')
                sys.exit(1)
            mongo = MongoClient(mongo_url)
            self.db = mongo['web-portal']
            self.lpr_table = self.db['license_plates']
            self.lpr_table.create_index('event_id', unique=True)
            self.lpr_table.create_index('timestamp')
            self.lpr_table.create_index('camera_id')
            logger.info("✓ Connected to MongoDB")
        except Exception as e:
            logger.error(f"MongoDB error: {e}")
            return False
        
        logger.info(f"\n{'='*70}")
        logger.info("🎯 License Plate Capture Running")
        logger.info(f"{'='*70}\n")
        
        # Optional startup catch-up: replay recent events to recover missed plates
        if self.catchup_on_start:
            await self.catchup_missing_plates()
        
        return True
    
    async def catchup_missing_plates(self):
        """Catch up on any missing plates since last capture"""
        try:
            newest_in_db = self.lpr_table.find_one(sort=[('timestamp', -1)])
            
            if not newest_in_db:
                logger.info("No previous captures found - skipping catch-up")
                return
            
            last_capture_time = newest_in_db['timestamp'].replace(tzinfo=None)
            catchup_start = last_capture_time
            catchup_end = datetime.utcnow()
            gap_minutes = (catchup_end - catchup_start).total_seconds() / 60
            
            # Only catch up if there's a gap > 1 minute
            if gap_minutes <= 1:
                logger.info("No significant gap detected - skipping catch-up")
                return
            
            logger.info(f"⏱️  Catching up {gap_minutes:.0f} minutes of missing plates...")
            
            # Get all events
            events = await self.protect.get_events()
            
            caught_up = 0
            for event in events:
                event_time = event.start.replace(tzinfo=None) if hasattr(event.start, 'replace') else event.start
                
                # Only catch events in the gap
                if event_time <= last_capture_time or event_time > catchup_end:
                    continue
                
                # Only process LPR camera events
                if event.camera_id not in self.lpr_cameras:
                    continue
                
                # Check for license plate detection
                if not event.smart_detect_types or 'licensePlate' not in event.smart_detect_types:
                    continue
                
                # Check if already stored
                if self.lpr_table.find_one({'event_id': event.id}):
                    continue
                
                # Extract license plate
                license_plate = None
                confidence = 0
                thumbnail_id = None
                vehicle_data = {}
                
                if event.metadata and event.metadata.detected_thumbnails:
                    for thumb in event.metadata.detected_thumbnails:
                        if thumb.type == 'vehicle' and thumb.name:
                            name_str = str(thumb.name).strip().upper()
                            if len(name_str) > 0 and name_str != 'NONE':
                                license_plate = name_str
                                confidence = int(float(thumb.confidence)) if thumb.confidence else 0
                                confidence = min(100, max(0, confidence))
                                
                                # Capture thumbnail and vehicle data
                                thumbnail_id = thumb.cropped_id
                                
                                # Capture vehicle characteristics from thumbnail
                                if thumb.coord:
                                    vehicle_data['bounding_box'] = {
                                        'x': thumb.coord[0] if len(thumb.coord) > 0 else None,
                                        'y': thumb.coord[1] if len(thumb.coord) > 1 else None,
                                        'width': thumb.coord[2] if len(thumb.coord) > 2 else None,
                                        'height': thumb.coord[3] if len(thumb.coord) > 3 else None
                                    }
                                
                                if thumb.object_id:
                                    vehicle_data['object_id'] = thumb.object_id
                                
                                # Capture vehicle attributes if available
                                if thumb.attributes:
                                    try:
                                        attrs_dict = thumb.attributes.model_dump(exclude_none=True)
                                        
                                        # Process attributes to extract readable values
                                        processed_attrs = {}
                                        for key, val in attrs_dict.items():
                                            if isinstance(val, dict) and 'val' in val:
                                                # Handle EventThumbnailAttribute with confidence and val
                                                processed_attrs[key] = {
                                                    'value': val['val'],
                                                    'confidence': val.get('confidence', 0)
                                                }
                                            elif isinstance(val, dict) and 'confidence' in val and 'val' in val:
                                                processed_attrs[key] = {
                                                    'value': val['val'],
                                                    'confidence': val.get('confidence', 0)
                                                }
                                            else:
                                                processed_attrs[key] = val
                                        
                                        vehicle_data['attributes'] = processed_attrs
                                    except Exception as e:
                                        # Fallback if model_dump fails
                                        logger.warning(f"Could not extract attributes: {e}")
                                
                                if thumb.group:
                                    try:
                                        group_dict = thumb.group.model_dump(exclude_none=True)
                                        vehicle_data['group'] = group_dict
                                    except Exception as e:
                                        logger.warning(f"Could not extract group: {e}")
                                
                                break
                
                # Store event
                doc = {
                    'event_id': event.id,
                    'timestamp': event.start,
                    'camera_id': event.camera_id,
                    'camera_name': self.lpr_cameras[event.camera_id],
                    'license_plate': license_plate or 'UNREAD',
                    'confidence': confidence,
                    'thumbnail_id': thumbnail_id,
                    'vehicle_data': vehicle_data if vehicle_data else None,
                    'detected_at': datetime.utcnow().isoformat()
                }

                # Guard: ensure we only store events for allowed cameras
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

                self.lpr_table.insert_one(doc)
                caught_up += 1

                if license_plate and license_plate != 'UNREAD':
                    logger.info(f"  ↻ Caught: {license_plate} ({confidence}%) @ {self.lpr_cameras[event.camera_id]}")
            
            if caught_up > 0:
                logger.info(f"✓ Catch-up complete: {caught_up} plates recovered")
            else:
                logger.info(f"✓ Catch-up complete: no missing plates found")
                
        except Exception as e:
            logger.error(f"Catch-up error: {e}")
            import traceback
            traceback.print_exc()

    async def capture_plates(self):
        """Poll for new events since last check"""
        try:
            # Get events from last check time
            start = self.last_check
            self.last_check = datetime.utcnow()
            
            # Get all events since last check
            events = await self.protect.get_events(
                start=start,
                limit=500
            )
            
            # Filter for LPR camera events with license plate detections
            for event in events:
                # Initialize per-event variables to avoid UnboundLocalError
                license_plate = None
                confidence = 0
                thumbnail_id = None
                vehicle_data = {}
                skip_reason = None
                exists = False

                # Only process LPR camera events
                if event.camera_id not in self.lpr_cameras:
                    skip_reason = 'not an LPR camera'
                    continue
                
                # Check for license plate detection
                if not event.smart_detect_types:
                    skip_reason = 'no smart_detect_types'
                    continue
                
                if 'licensePlate' not in event.smart_detect_types:
                    skip_reason = 'no licensePlate detect'
                    continue
                
                # Check if already stored
                if self.lpr_table.find_one({'event_id': event.id}):
                    exists = True
                    skip_reason = 'already stored'
                    continue
                
                # Extract license plate from detected_thumbnails
                
                if event.metadata and event.metadata.detected_thumbnails:
                    for thumb in event.metadata.detected_thumbnails:
                        # Vehicle thumbnails contain the license plate name
                        if thumb.type == 'vehicle' and thumb.name:
                            name_str = str(thumb.name).strip().upper()
                            if len(name_str) > 0 and name_str != 'NONE':
                                license_plate = name_str
                                # Convert confidence from 0-1 to 0-100 scale
                                confidence = int(float(thumb.confidence) * 100) if thumb.confidence else 0
                                break  # Use first valid plate found
                
                # Store event (even if plate is unreadable)
                doc = {
                    'event_id': event.id,
                    'timestamp': event.start,
                    'camera_id': event.camera_id,
                    'camera_name': self.lpr_cameras[event.camera_id],
                    'license_plate': license_plate or 'UNREAD',
                    'confidence': confidence,
                    'detected_at': datetime.utcnow().isoformat(),
                    'origin': 'fast_capture_fixed'
                }

                # Guard: enforce allowed cameras (skip Entry/Exit by default)
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

                self.lpr_table.insert_one(doc)
                self.stats['stored'] += 1

                if license_plate:
                    logger.info(f"✓ Plate: {license_plate} | Camera: {self.lpr_cameras[event.camera_id]} | Confidence: {confidence}%")
                else:
                    logger.debug(f"Event {event.id}: No readable plate extracted")
                
        except Exception as e:
            logger.debug(f"Capture error: {e}")
    
    async def run(self):
        """Main loop"""
        if not await self.start():
            return
        
        import time
        start = time.time()
        
        try:
            while True:
                if self.duration > 0 and (time.time() - start) > self.duration:
                    break
                
                await self.capture_plates()
                await asyncio.sleep(5)  # Poll every 5 seconds
                
        except KeyboardInterrupt:
            logger.info("\n⚠️  Stopped")
        finally:
            total = self.lpr_table.count_documents({})
            logger.info(f"\n✓ Total plates captured: {total}")

async def main():
    # Parse args: optional duration and --catchup flag
    duration = 0
    catchup = False
    for arg in sys.argv[1:]:
        if arg == '--catchup':
            catchup = True
        else:
            try:
                duration = int(arg)
            except Exception:
                pass
    service = FastLPRCapture(duration=duration, catchup_on_start=catchup)
    await service.run()

if __name__ == '__main__':
    asyncio.run(main())
