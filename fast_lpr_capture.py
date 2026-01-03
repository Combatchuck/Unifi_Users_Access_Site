#!/usr/bin/env python3
"""
Fast LPR License Plate Capture Service
Efficiently captures license plate detections from 2 LPR cameras only
Stores directly to MongoDB

Usage:
  python fast_lpr_capture.py              # Run continuously
  python fast_lpr_capture.py 120          # Run for 2 minutes
"""

import asyncio
import os
import sys
import logging
from datetime import datetime, timedelta
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def mask_plate(plate: str) -> str:
    """Mask a license plate for logging unless ALLOW_RAW_PLATE_LOG=true."""
    if os.getenv('ALLOW_RAW_PLATE_LOG', 'false').lower() == 'true':
        return plate
    if not plate:
        return ''
    # Keep last 2 characters for context, mask the rest
    if len(plate) <= 2:
        return '*' * len(plate)
    return '*' * (len(plate) - 2) + plate[-2:]

class FastLPRCapture:
    """Minimal, fast LPR capture service"""
    
    def __init__(self, duration=0):
        self.duration = duration
        self.protect = None
        self.db = None
        self.lpr_cameras = {}
        self.stats = {'detected': 0, 'stored': 0}
        self.last_check = datetime.utcnow()
        
    async def start(self):
        """Start the service"""
        try:
            from uiprotect import ProtectApiClient
            
            # Connect to Protect - require env vars
            host = os.getenv('UNIFI_PROTECT_HOST')
            port = int(os.getenv('UNIFI_PROTECT_PORT', 443))
            username = os.getenv('UNIFI_PROTECT_USERNAME')
            password = os.getenv('UNIFI_PROTECT_PASSWORD')
            api_key = os.getenv('UNIFI_PROTECT_API_KEY')

            if not host:
                logger.error('UNIFI_PROTECT_HOST not set. See .env.example')
                return False
            if not api_key and not (username and password):
                logger.error('UNIFI_PROTECT_API_KEY or UNIFI_PROTECT_USERNAME+UNIFI_PROTECT_PASSWORD must be set. See .env.example')
                return False

            verify_ssl = os.getenv('UNIFI_PROTECT_VERIFY_SSL', 'true').lower() == 'true'

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
            
            # Get LPR cameras only
            self.lpr_cameras = {
                c.id: c.name 
                for c in self.protect.bootstrap.cameras.values() 
                if c.type == 'UVC AI LPR'
            }
            
            if not self.lpr_cameras:
                logger.warning("⚠️  No LPR cameras found. Check camera types.")
            
            logger.info(f"✓ Monitoring {len(self.lpr_cameras)} LPR cameras:")
            for cid, name in self.lpr_cameras.items():
                logger.info(f"  • {name}")
            
        except Exception as e:
            logger.error(f"Failed to connect to Protect: {e}")
            return False
        
        # Connect to MongoDB
        try:
            mongo_url = os.getenv('MONGO_URL')
            mongo_db = os.getenv('MONGODB_DATABASE', 'web-portal')

            if mongo_url:
                mongo = MongoClient(mongo_url)
            else:
                mongo_host = os.getenv('MONGODB_HOST', 'localhost')
                mongo_port = os.getenv('MONGODB_PORT', '27017')
                mongo = MongoClient(f"{mongo_host}:{mongo_port}")

            self.db = mongo[mongo_db]
            self.lpr_table = self.db['license_plates']
            
            # Create indexes for efficient querying
            self.lpr_table.create_index('event_id', unique=True)
            self.lpr_table.create_index('timestamp')
            self.lpr_table.create_index('camera_id')
            self.lpr_table.create_index('license_plate')
            
            logger.info("✓ Connected to MongoDB")
        except Exception as e:
            logger.error(f"MongoDB error: {e}")
            return False
        
        logger.info(f"\n{'='*70}")
        logger.info("🎯 License Plate Capture Running")
        logger.info(f"{'='*70}\n")
        
        return True
    
    async def capture_plates(self):
        """Poll for new events since last check"""
        try:
            # Get events from last 5 minutes
            start = self.last_check
            self.last_check = datetime.utcnow()
            
            # Get events
            events = await self.protect.get_events(
                start=start,
                limit=100
            )
            
            for event in events:
                # Only process LPR camera events
                if event.camera_id not in self.lpr_cameras:
                    continue
                
                # Check for license plate detection
                if not event.smart_detect_types:
                    continue
                
                if 'licensePlate' not in event.smart_detect_types:
                    continue
                
                # Check if already stored
                if self.lpr_table.find_one({'event_id': event.id}):
                    continue
                
                # Extract license plate from detected_thumbnails
                license_plate = None
                confidence = 0
                
                if event.metadata and event.metadata.detected_thumbnails:
                    for thumb in event.metadata.detected_thumbnails:
                        if thumb.type == 'vehicle' and thumb.name:
                            license_plate = thumb.name
                            confidence = thumb.confidence
                            break
                
                if not license_plate:
                    continue
                
                # Look up user by license plate
                user_email = self._lookup_user_by_plate(license_plate)
                
                # Store event
                doc = {
                    'event_id': event.id,
                    'timestamp': event.start,
                    'camera_id': event.camera_id,
                    'camera_name': self.lpr_cameras[event.camera_id],
                    'license_plate': license_plate,
                    'confidence': confidence,
                    'user_email': user_email,
                    'detected_at': datetime.utcnow().isoformat()
                }
                
                self.lpr_table.insert_one(doc)
                self.stats['stored'] += 1
                
                user_info = f" | User: {user_email}" if user_email != "unknown" else " | User: unknown"
                logger.info(f"✓ Plate: {license_plate} | Camera: {self.lpr_cameras[event.camera_id]} | Confidence: {confidence}%{user_info}")
                
        except Exception as e:
            logger.debug(f"Capture error: {e}")
    
    def _lookup_user_by_plate(self, plate):
        """Look up user by license plate number"""
        try:
            users_cache = self.db['users_cache']
            
            # Search for the plate in users' license_plates array
            user = users_cache.find_one({
                'license_plates': {
                    '$elemMatch': {
                        'credential': plate
                    }
                }
            })
            
            if user:
                return user.get('user_email') or user.get('email') or 'unknown'
            else:
                return 'unknown'
        except Exception as e:
            logger.debug("User lookup error for plate %s: %s", plate, e)
            return 'unknown'

    
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
            logger.info(f"\n{'='*70}")
            logger.info(f"Final Stats: {self.stats['stored']} plates stored | Total in DB: {total}")
            logger.info(f"{'='*70}")

async def main():
    duration = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    service = FastLPRCapture(duration=duration)
    await service.run()

if __name__ == '__main__':
    asyncio.run(main())
