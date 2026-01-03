#!/usr/bin/env python3
"""
Enrich LPR Records

This script updates existing license plate records in MongoDB to ensure they have
all the required fields. It attempts to fill in missing information for records
that have license plates but may be missing other fields.

Required LPR camera entries should contain:
- Plate number
- User name/guest
- Email
- Camera
- Time
- Confidence
- Car color
- Car type
- Owner
"""

import os
import sys
import logging
from datetime import datetime
from pymongo import MongoClient, UpdateOne
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO, 
                    format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def connect_mongodb():
    """Connect to MongoDB"""
    try:
        # Get MongoDB connection details from environment variables
        mongo_host = os.getenv('MONGODB_HOST', 'localhost')
        mongo_port = os.getenv('MONGODB_PORT', '27017')
        mongo_db = os.getenv('MONGODB_DATABASE', 'web-portal')
        
        # Connect to MongoDB
        mongo = MongoClient(f"{mongo_host}:{mongo_port}")
        db = mongo[mongo_db]
        return mongo, db
    except Exception as e:
        logger.error(f"Failed to connect to MongoDB: {e}")
        sys.exit(1)

def look_up_user_info(db, license_plate):
    """Look up user info by license plate"""
    try:
        users_cache = db['users_cache']
        
        # Search for the plate in users' license_plates array
        user = users_cache.find_one({
            'license_plates': {
                '$elemMatch': {
                    'credential': license_plate
                }
            }
        })
        
        if user:
            return {
                'user_email': user.get('user_email') or user.get('email') or 'unknown',
                'user_name': user.get('name') or user.get('user_name') or 'Unknown',
                'user_type': user.get('user_type') or 'resident',
                'owner': user.get('owner') or 'Unknown'
            }
        else:
            return {
                'user_email': 'unknown',
                'user_name': 'Unknown',
                'user_type': 'unknown',
                'owner': 'Unknown'
            }
    except Exception as e:
        logger.debug(f"User lookup error for plate {license_plate}: {e}")
        return {
            'user_email': 'unknown',
            'user_name': 'Unknown',
            'user_type': 'unknown',
            'owner': 'Unknown'
        }

def enrich_lpr_records(db):
    """Enrich LPR records with missing information"""
    lpr_collection = db['license_plates']
    
    # Fields to update if missing
    fields_to_check = [
        'user_email',     # Email
        'user_name',      # Name
        'vehicle_color',  # Car color
        'vehicle_type',   # Car type
        'owner',          # Owner
        'user_type',      # Type of user
    ]
    
    # Count total documents
    total = lpr_collection.count_documents({'license_plate': {'$exists': True, '$ne': None, '$ne': ''}})
    logger.info(f"Processing {total} LPR records for enrichment")
    
    # Get all license plate records
    records = lpr_collection.find({'license_plate': {'$exists': True, '$ne': None, '$ne': ''}})
    
    # Prepare bulk operations
    bulk_ops = []
    processed = 0
    enriched = 0
    
    # Process records
    for record in records:
        update_needed = False
        update_fields = {}
        
        # Check for missing fields
        for field in fields_to_check:
            if field not in record or record[field] is None or record[field] == '':
                update_needed = True
                break
        
        # If updates needed, enrich the record
        if update_needed:
            # Look up user info
            user_info = look_up_user_info(db, record['license_plate'])
            
            # Prepare update
            for field, value in user_info.items():
                if field not in record or record[field] is None or record[field] == '':
                    update_fields[field] = value
            
            # Add vehicle info if missing
            if ('vehicle_color' not in record or record['vehicle_color'] is None or record['vehicle_color'] == '') and 'vehicle_data' in record:
                # Try to extract color from vehicle_data
                try:
                    vehicle_data = record['vehicle_data']
                    if isinstance(vehicle_data, dict):
                        color = vehicle_data.get('color')
                        if color:
                            update_fields['vehicle_color'] = color
                except:
                    pass
            
            if ('vehicle_type' not in record or record['vehicle_type'] is None or record['vehicle_type'] == '') and 'vehicle_data' in record:
                # Try to extract vehicle type from vehicle_data
                try:
                    vehicle_data = record['vehicle_data']
                    if isinstance(vehicle_data, dict):
                        vehicle_type = vehicle_data.get('vehicleType') or vehicle_data.get('vehicle_type') or vehicle_data.get('type')
                        if vehicle_type:
                            update_fields['vehicle_type'] = vehicle_type
                except:
                    pass
            
            # If we have updates, add to bulk operations
            if update_fields:
                bulk_ops.append(
                    UpdateOne(
                        {'_id': record['_id']},
                        {'$set': update_fields}
                    )
                )
                enriched += 1
        
        processed += 1
        
        # Execute bulk operations in batches
        if len(bulk_ops) >= 100:
            if bulk_ops:
                result = lpr_collection.bulk_write(bulk_ops)
                logger.info(f"Batch update: {result.modified_count} records updated")
            bulk_ops = []
    
    # Execute remaining bulk operations
    if bulk_ops:
        result = lpr_collection.bulk_write(bulk_ops)
        logger.info(f"Final batch update: {result.modified_count} records updated")
    
    logger.info(f"Processed {processed} records, enriched {enriched} records")

def main():
    """Main function"""
    logger.info("Starting LPR Records Enrichment")
    
    # Connect to MongoDB
    mongo_client, db = connect_mongodb()
    
    try:
        # Enrich LPR records
        enrich_lpr_records(db)
        
        logger.info("LPR Records Enrichment completed successfully")
    
    except Exception as e:
        logger.error(f"Error during enrichment: {e}")
        sys.exit(1)
    finally:
        # Close MongoDB connection
        mongo_client.close()

if __name__ == "__main__":
    main()