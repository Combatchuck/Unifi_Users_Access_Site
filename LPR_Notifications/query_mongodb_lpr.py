#!/usr/bin/env python3
"""
Query MongoDB for License Plate Detections
"""

import os
from dotenv import load_dotenv
from pymongo import MongoClient
from datetime import datetime, timedelta

load_dotenv()

mongo_url = os.getenv('MONGO_URL')
if not mongo_url:
    print('Error: MONGO_URL not set. See .env.example')
    sys.exit(1)

print(f"\n{'='*70}")
print("MongoDB License Plate Detection Query")
print(f"{'='*70}\n")

try:
    mongo_client = MongoClient(mongo_url)
    db = mongo_client.get_database()
    lpr_collection = db['license_plate_detections']
    
    # Count total records
    total_count = lpr_collection.count_documents({})
    print(f"Total LPR events in MongoDB: {total_count}\n")
    
    if total_count == 0:
        print("No license plate detections recorded yet.")
        print("\nTo generate test data:")
        print("  1. Run the WebSocket listener: python lpr_websocket_listener.py")
        print("  2. Drive a vehicle past an LPR camera")
        print("  3. The detection will be captured and stored\n")
    else:
        # Show recent events
        print("Recent License Plate Detections:\n")
        
        for doc in lpr_collection.find().sort('timestamp', -1).limit(10):
            print(f"ID: {doc['_id']}")
            print(f"Timestamp: {doc.get('timestamp', 'N/A')}")
            
            # Show other relevant fields
            for key, val in doc.items():
                if key not in ['_id', 'timestamp']:
                    print(f"  {key}: {val}")
            print()
        
        # Query by license plate if provided
        import sys
        if len(sys.argv) > 1:
            plate = sys.argv[1].upper()
            print(f"\nSearching for license plate: {plate}\n")
            
            count = 0
            for doc in lpr_collection.find():
                if plate in str(doc).upper():
                    print(f"Found: {doc}")
                    count += 1
            
            if count == 0:
                print(f"No records found for plate: {plate}")
    
    mongo_client.close()
    
except Exception as e:
    print(f"Error connecting to MongoDB: {e}")
    print(f"Connection string: {mongo_url}\n")

print(f"\n{'='*70}\n")
