#!/usr/bin/env python3
"""
Improved LPR License Plate Capture Service - Version 3
Captures license plate detections from UniFi Protect using event subscription
"""

import asyncio
import os
import sys
import logging
from datetime import datetime
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class LPRCaptureV3:
    """Improved LPR capture service using subscriptions"""
    
    def __init__(self):
        self.protect = None
        self.db = None
        self.lpr_cameras = {}
        self.stats = {'detected': 0, 'stored': 0}
        self.processed_events = set()
        self.last_check = datetime.utcnow()
        
    async def start(self):
        """Initialize connections"""
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
            
            # Get LPR cameras
            self.lpr_cameras = {
                c.id: c.name 
                for c in self.protect.bootstrap.cameras.values() 
                if 'LPR' in c.type or 'lpr' in c.type.lower()
            }
            
            logger.info(f"✓ Found {len(self.lpr_cameras)} LPR cameras:")
            for cid, name in self.lpr_cameras.items():
                logger.info(f"  • {name} ({cid})")
            
        except Exception as e:
            logger.error(f"Failed to connect to Protect: {e}")
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
            logger.info("✓ Connected to MongoDB")
        except Exception as e:
            logger.error(f"MongoDB error: {e}")
            return False
        
        logger.info("\n" + "="*70)
        logger.info("🎯 License Plate Capture Service V3 Running")
        logger.info("="*70 + "\n")
        
        return True
    
    async def handle_event(self, event):
        """Handle incoming event"""
        try:
            # Check if it's from an LPR camera
            if event.camera_id not in self.lpr_cameras:
                return

            # Check if it has license plate detection
            if not event.smart_detect_types:
                return

            if 'licensePlate' not in event.smart_detect_types:
                return

            # Avoid duplicates
            if event.id in self.processed_events:
                return

            self.processed_events.add(event.id)

            # Skip if already in DB
            if self.lpr_table.find_one({'event_id': event.id}):
                logger.debug(f"Event {event.id} already stored")
                return

            # Extract license plate info
            license_plate = None
            confidence = 0

            # Try to get plate from thumbnail names (OpenALPR data)
            if event.metadata and event.metadata.detected_thumbnails:
                for thumb in event.metadata.detected_thumbnails:
                    # Look for vehicle type which should contain plate
                    if thumb.type and 'vehicle' in thumb.type.lower():
                        if thumb.name and len(thumb.name) > 0:
                            license_plate = thumb.name
                            confidence = int(thumb.confidence * 100) if thumb.confidence else 0
                            break

            # Alternative: look through all smart detections
            if not license_plate and event.metadata:
                logger.debug(f"Event {event.id} has no plate in thumbnails, checking detections...")
                logger.debug(f"  Metadata: {event.metadata}")

            # Store in database even if we didn't extract plate text
            # (so we can investigate later)
            doc = {
                'event_id': event.id,
                'timestamp': event.start,
                'camera_id': event.camera_id,
                'camera_name': self.lpr_cameras[event.camera_id],
                'license_plate': license_plate or 'UNREAD',
                'confidence': confidence,
                'detected_at': datetime.utcnow().isoformat(),
                'raw_metadata': str(event.metadata) if event.metadata else None,
                'origin': 'capture_v3'
            }

            # Guard: filter by allowed cameras / skip substrings
            cam = doc.get('camera_name') or ''
            cam_id = doc.get('camera_id')
            allowed_ids = {s.strip() for s in os.getenv('LPR_CAMERA_IDS', '').split(',') if s.strip()}
            allowed_names = [s.strip() for s in os.getenv('LPR_CAMERA_NAMES', '').split(',') if s.strip()]
            skip_subs = [s.strip().lower() for s in os.getenv('LPR_SKIP_CAMERA_SUBSTRINGS', 'Entry,Exit,Kiosk').split(',') if s.strip()]

            if allowed_ids and cam_id not in allowed_ids:
                logger.info(f"Skipping store for event {event.id}: camera_id {cam_id} not in LPR_CAMERA_IDS")
                return
            if allowed_names and not any(sub in cam for sub in allowed_names):
                logger.info(f"Skipping store for event {event.id}: camera_name '{cam}' not matching LPR_CAMERA_NAMES")
                return
            if not allowed_ids and not allowed_names and any(sub in cam.lower() for sub in skip_subs):
                logger.info(f"Skipping store for event {event.id}: camera '{cam}' matches skip substrings {skip_subs}")
                return

            try:
                self.lpr_table.insert_one(doc)
                self.stats['stored'] += 1
                logger.info(f"✓ Captured: {license_plate or 'UNREAD'} | Camera: {self.lpr_cameras[event.camera_id]} | Confidence: {confidence}%")
            except Exception as e:
                if 'duplicate' in str(e).lower():
                    logger.debug(f"Duplicate event {event.id}")
                else:
                    logger.error(f"Failed to store event: {e}")

        except Exception as e:
            logger.error(f"Error handling event: {e}")

    async def capture_poll_once(self):
        """Poll Protect once for recent events and handle them."""
        try:
            start = self.last_check
            self.last_check = datetime.utcnow()
            events = await self.protect.get_events(start=start, limit=500)
            if not events:
                return
            for event in events:
                try:
                    await self.handle_event(event)
                except Exception as e:
                    logger.error(f"Error handling polled event: {e}")
        except Exception as e:
            logger.error(f"Error during poll: {e}")
    
    async def run(self):
        """Main loop using event subscriptions with automatic reconnect/backoff"""
        backoff = 1
        while True:
            try:
                if not await self.start():
                    logger.error("Start failed, retrying in 5s")
                    await asyncio.sleep(5)
                    continue

                unsub = None
                try:
                    # Subscribe to all events (use the protected subscribe_websocket API when available)
                    async def event_callback(event):
                        await self.handle_event(event)

                    if hasattr(self.protect, 'subscribe_websocket'):
                        unsub = self.protect.subscribe_websocket(event_callback)
                        logger.info("✓ Subscribed to events via websocket\n")
                    elif hasattr(self.protect, 'events') and hasattr(self.protect.events, 'subscribe'):
                        unsub = self.protect.events.subscribe(event_callback)
                        logger.info("✓ Subscribed to events via protect.events\n")
                    else:
                        logger.warning("Protect client does not support event subscriptions; falling back to polling")

                    # If subscription is not available, poll periodically
                    while True:
                        if unsub is None:
                            await self.capture_poll_once()
                        await asyncio.sleep(1)

                except KeyboardInterrupt:
                    logger.info("\n⚠️  Stopped")
                    break
                except Exception as e:
                    logger.error(f"Error in main loop: {e}")
                    # Fall through to cleanup then reconnect after backoff

                finally:
                    # Unsubscribe if necessary
                    try:
                        if callable(unsub):
                            unsub()
                    except Exception:
                        pass
                    # Ensure the Protect client session is closed to avoid unclosed connectors
                    try:
                        if hasattr(self.protect, 'close_session'):
                            await self.protect.close_session()
                    except Exception:
                        pass

                # If we reach here, we had an error and will retry
                logger.info(f"Restarting capture loop in {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 300)

            except Exception as outer_exc:
                logger.error(f"Unexpected error in run loop: {outer_exc}")
                await asyncio.sleep(5)
                continue

        total = self.lpr_table.count_documents({})
        logger.info(f"\n✓ Total plates captured: {total}")

async def main():
    service = LPRCaptureV3()
    await service.run()

if __name__ == '__main__':
    asyncio.run(main())
