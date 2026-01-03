#!/usr/bin/env python3
"""
Migrate LPR data to add user_email field to old records
"""

import os
from pymongo import MongoClient

# Read from .env file if it exists
def load_env():
    try:
        with open('.env', 'r') as f:
            for line in f:
                if '=' in line and not line.startswith('#'):
                    key, value = line.strip().split('=', 1)
                    os.environ[key] = value
    except:
        pass

load_env()

def lookup_user_by_plate(db, plate):
    """Look up user by license plate number"""
    try:
        users_cache = db['users_cache']
        
        # Search for the plate in users' license_plates array
        user = users_cache.find_one({
            'license_plates': {
                '$elemMatch': {
                    'credential': plate
                }
            }
        })
        
        if user:
            return user.get('user_email') or user.get('email', 'unknown')
        
        return 'unknown'
    except Exception as e:
        print(f"Error looking up plate {plate}: {e}")
        return 'unknown'

# Connect to MongoDB
mongo_host = os.getenv('MONGODB_HOST', 'localhost')
mongo_port = os.getenv('MONGODB_PORT', '27017')
mongo_db = os.getenv('MONGODB_DATABASE', 'web-portal')

client = MongoClient(f"mongodb://{mongo_host}:{mongo_port}/{mongo_db}")
db = client[mongo_db]

plates_collection = db['license_plates']

print("=" * 70)
print("🔄 Migrating LPR Data - Adding user_email to records")
print("=" * 70)

# Find all records without user_email field
records_without_email = plates_collection.find({'user_email': {'$exists': False}})
count = 0

for record in records_without_email:
    plate = record.get('license_plate')
    user_email = lookup_user_by_plate(db, plate)
    
    # Update the record
    plates_collection.update_one(
        {'_id': record['_id']},
        {'$set': {'user_email': user_email}}
    )
    
    count += 1
    status = "✓" if user_email != 'unknown' else "?"
    print(f"{status} {plate} → {user_email}")

print("\n" + "=" * 70)
print(f"✓ Migration complete: {count} records updated")
print("=" * 70)

client.close()
