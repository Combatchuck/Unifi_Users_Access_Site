#!/usr/bin/env python3
"""
UniFi Protect LPR to MongoDB Microservice - Enhanced Version
Captures ONLY license plate detection events from 2 LPR cameras
Filters for actual LPR events and extracts plate information

Usage:
  python lpr_microservice_v2.py              # Run with default 60-second timeout
  python lpr_microservice_v2.py 0            # Run continuously (0 = infinite)
  python lpr_microservice_v2.py 300          # Run for 5 minutes
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

class LPRMicroserviceV2:
    """Enhanced microservice to capture LPR events from 2 LPR cameras only"""
    
    def __init__(self, listen_duration=60):
        """Initialize the microservice"""
        self.listen_duration = listen_duration
        self.protect = None
        self.mongo_client = None
        self.db = None
        self.lpr_collection = None
        self.event_count = {'detected': 0, 'stored': 0, 'errors': 0}
        self.lpr_camera_ids = []  # Will store IDs of 2 LPR cameras
        self.lpr_camera_names = {}  # Will map IDs to names
        
    async def connect_protect(self):
        """Connect to UniFi Protect console"""
        try:
            from uiprotect import ProtectApiClient
            
            api_key = os.getenv('UNIFI_PROTECT_API_KEY')
            host = os.getenv('UNIFI_PROTECT_HOST')
            port = int(os.getenv('UNIFI_PROTECT_PORT', '443'))
            username = os.getenv('UNIFI_PROTECT_USERNAME')
            password = os.getenv('UNIFI_PROTECT_PASSWORD', '')
            if not host:
                logger.error('UNIFI_PROTECT_HOST not set. See .env.example')
                return False
            
            self.protect = ProtectApiClient(
                host=host,
                port=port,
                username=username,
                password=password,
                verify_ssl=os.getenv('UNIFI_PROTECT_VERIFY_SSL', 'true').lower() in ('1','true','yes'),
                api_key=api_key
            )
            
            await self.protect.update()
            logger.info("✓ Connected to UniFi Protect")
            
            # Get ONLY the 2 LPR cameras with LPR detection enabled
            self.lpr_camera_ids = [
                cam_id for cam_id, cam in self.protect.bootstrap.cameras.items()
                if cam.type == 'UVC AI LPR' and cam.is_license_plate_detection_on
            ]
            
            self.lpr_camera_names = {
                cam_id: self.protect.bootstrap.cameras[cam_id].name
                for cam_id in self.lpr_camera_ids
            }
            
            logger.info(f"✓ Found {len(self.lpr_camera_ids)} LPR Cameras (type='UVC AI LPR')")
            for cam_id, name in self.lpr_camera_names.items():
                logger.info(f"  • {name} ({cam_id})")
            
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
                logger.error('MONGO_URL not set. See .env.example')
                return False
            self.mongo_client = MongoClient(mongo_url)
            self.db = self.mongo_client.get_database()
            self.lpr_collection = self.db['license_plate_detections_v2']
            
            # Create indexes for fast querying
            self.lpr_collection.create_index('timestamp')
            self.lpr_collection.create_index('license_plate')
            self.lpr_collection.create_index('camera_name')
            
            logger.info(f"✓ Connected to MongoDB (db: {self.db.name})")
            return True
            
        except Exception as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            return False
    
    def on_event(self, msg):
        """Handle WebSocket events - filter for LPR events only"""
        try:
            # Extract the object from the message
            if not hasattr(msg, 'new_obj'):
                return
            
            obj = msg.new_obj
            
            # Filter: Only process events from the 2 LPR cameras
            if not hasattr(obj, 'id') or obj.id not in self.lpr_camera_ids:
                return
            
            camera_name = self.lpr_camera_names.get(obj.id, 'Unknown')
            
            # Filter: Look for license plate detection events
            # Check if object has smart_detect_events or similar
            if not hasattr(obj, 'last_smart_detects'):
                return
            
            # Look through smart detection data
            smart_detects = getattr(obj, 'last_smart_detects', {})
            
            # If there are license plate detections
            if 'licensePlate' in smart_detects:
                detection_data = smart_detects['licensePlate']
                
                # Extract plate if present
                plate = detection_data.get('plate') if isinstance(detection_data, dict) else None
                plate = plate if plate and len(str(plate).strip()) >= 2 else None

                self.event_count['detected'] += 1
                logger.info(f"🚗 LPR Detection from {camera_name}: {detection_data}")

                if not plate:
                    logger.info(f"Skipping store: detection from {camera_name} has no plate: {detection_data}")
                    return
                
                # Store in MongoDB
                event_doc = {
                    'timestamp': datetime.utcnow(),
                    'camera_id': obj.id,
                    'camera_name': camera_name,
                    'license_plate': plate,
                    'confidence': detection_data.get('confidence'),
                    'raw_detection': str(detection_data),
                    'detected_at': datetime.utcnow().isoformat(),
                    'origin': 'microservice_v2'
                }
                
                result = self.lpr_collection.insert_one(event_doc)
                self.event_count['stored'] += 1
                logger.info(f"✓ Stored: {result.inserted_id}")
                
        except Exception as e:
            self.event_count['errors'] += 1
            logger.debug(f"Event processing error: {e}")
    
    async def run(self):
        """Main event loop"""
        if not await self.connect_protect():
            return
        
        if not self.connect_mongodb():
            return
        
        logger.info(f"\n{'='*70}")
        logger.info(f"🎯 Listening for LPR events from {len(self.lpr_camera_ids)} cameras")
        
        if self.listen_duration > 0:
            logger.info(f"⏱️  Duration: {self.listen_duration} seconds")
        else:
            logger.info("⏱️  Duration: INFINITE (Ctrl+C to stop)")
        
        logger.info(f"{'='*70}\n")
        
        try:
            # Subscribe to WebSocket events
            unsub = self.protect.subscribe_websocket(self.on_event)
            
            # Wait for specified duration
            await asyncio.sleep(self.listen_duration if self.listen_duration > 0 else 999999)
            
            unsub()
            
        except KeyboardInterrupt:
            logger.info("\n⚠️  Interrupted by user")
        except Exception as e:
            logger.error(f"Error during event loop: {e}")
        finally:
            self.print_summary()
    
    def print_summary(self):
        """Print execution summary"""
        logger.info(f"\n{'='*70}")
        logger.info("📊 SUMMARY")
        logger.info(f"{'='*70}")
        logger.info(f"Events detected:  {self.event_count['detected']}")
        logger.info(f"Events stored:    {self.event_count['stored']}")
        logger.info(f"Errors:           {self.event_count['errors']}")
        
        if self.event_count['stored'] > 0:
            logger.info(f"\n✅ Success! {self.event_count['stored']} LPR events stored in MongoDB")
        else:
            logger.info(f"\n⚠️  No LPR events detected (vehicles may not have passed cameras)")
        
        logger.info(f"{'='*70}\n")


async def main():
    """Main entry point"""
    # Get listening duration from command line argument
    duration = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    
    microservice = LPRMicroserviceV2(listen_duration=duration)
    await microservice.run()


if __name__ == '__main__':
    asyncio.run(main())
