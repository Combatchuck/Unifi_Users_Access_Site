#!/usr/bin/env python3
"""
MongoDB LPR Collection Cleaning Script

This script cleans the MongoDB license plate collection by removing ONLY:
- Undefined entries (entries without license plate information)

IMPORTANT: This script preserves ALL entries that have license plate data,
regardless of which camera they came from.

Ideal LPR entries should contain:
- Plate number (required, will be preserved)
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
from pymongo import MongoClient
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

def clean_lpr_collection(db):
    """Remove undefined entries from the license plate collection while preserving all plate records"""
    # Get license plate collection
    lpr_collection = db['license_plates']
    
    # Count total documents before cleaning
    total_before = lpr_collection.count_documents({})
    logger.info(f"Total documents before cleaning: {total_before}")
    
    # Find all undefined entries (entries without a valid license plate)
    # CRITICAL: Only delete entries that are missing license plate information
    undefined_query = {
        '$or': [
            {'license_plate': {'$exists': False}},
            {'license_plate': None},
            {'license_plate': ''}
        ]
    }
    
    # Log what we found before deleting
    undefined_count = lpr_collection.count_documents(undefined_query)
    logger.info(f"Found {undefined_count} undefined entries (without license plate data)")
    
    # Print sample of documents to be deleted (just for verification)
    if undefined_count > 0:
        logger.info("Sample of undefined entries that will be deleted:")
        for doc in lpr_collection.find(undefined_query).limit(3):
            camera = doc.get('camera_name', 'Unknown Camera')
            event_id = doc.get('event_id', 'Unknown Event ID')
            timestamp = doc.get('timestamp', 'Unknown Time')
            logger.info(f"  • Camera: {camera}, Event ID: {event_id}, Time: {timestamp}")
    
    # Delete undefined entries
    result = lpr_collection.delete_many(undefined_query)
    logger.info(f"Deleted {result.deleted_count} undefined entries (without license plate data)")
    
    # Count how many documents we kept
    total_after = lpr_collection.count_documents({})
    logger.info(f"Kept {total_after} entries with license plate data")
    
    # Log counts by camera for verification
    pipeline = [
        {'$group': {'_id': '$camera_name', 'count': {'$sum': 1}}},
        {'$sort': {'count': -1}}
    ]
    
    camera_counts = list(lpr_collection.aggregate(pipeline))
    logger.info("Remaining documents by camera:")
    for camera in camera_counts:
        logger.info(f"  • {camera['_id'] or 'Unknown'}: {camera['count']}")
    
    # Count total documents after cleaning
    total_after = lpr_collection.count_documents({})
    logger.info(f"Total documents after cleaning: {total_after}")
    logger.info(f"Total removed: {total_before - total_after}")
    
    # Log counts by camera
    pipeline = [
        {'$group': {'_id': '$camera_name', 'count': {'$sum': 1}}},
        {'$sort': {'count': -1}}
    ]
    
    camera_counts = list(lpr_collection.aggregate(pipeline))
    logger.info("Remaining documents by camera:")
    for camera in camera_counts:
        logger.info(f"  • {camera['_id'] or 'Unknown'}: {camera['count']}")

def check_required_fields(db):
    """Check for required fields in remaining documents"""
    lpr_collection = db['license_plates']
    
    # Required fields
    required_fields = [
        'license_plate',  # Plate number
        'user_email',     # Email
        'camera_name',    # Camera
        'timestamp',      # Time
        'confidence',     # Confidence
        'vehicle_color',  # Car color
        'vehicle_type',   # Car type
    ]
    
    # Count documents missing required fields
    missing_fields_count = {}
    for field in required_fields:
        # Use $or to check for missing/empty fields or fields that don't exist
        query = {'$or': [{field: {'$exists': False}}, {field: None}, {field: ''}]}
        count = lpr_collection.count_documents(query)
        if count > 0:
            missing_fields_count[field] = count
    
    if missing_fields_count:
        logger.warning("Documents with missing required fields:")
        for field, count in missing_fields_count.items():
            logger.warning(f"  • {field}: {count} documents")
    else:
        logger.info("All documents have the required fields")

def main():
    """Main function"""
    logger.info("Starting MongoDB LPR Collection Cleaning - Removing Undefined Entries Only")
    
    # Connect to MongoDB
    mongo_client, db = connect_mongodb()
    
    try:
        # Clean license plate collection
        clean_lpr_collection(db)
        
        # Check for required fields in remaining documents
        check_required_fields(db)
        
        logger.info("MongoDB LPR Collection Cleaning completed successfully")
    
    except Exception as e:
        logger.error(f"Error during cleaning: {e}")
        sys.exit(1)
    finally:
        # Close MongoDB connection
        mongo_client.close()

if __name__ == "__main__":
    main()