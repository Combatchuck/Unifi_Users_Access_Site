#!/usr/bin/env python3
"""
Consolidate and link all LPR user/visitor/plate data in MongoDB.
Ensures every plate detection has proper user_name and user_email fields.
"""

from pymongo import MongoClient
from dotenv import load_dotenv
import os
import sys

load_dotenv()

MONGO_URI = os.getenv('MONGODB_URI') or os.getenv('MONGO_URL')
if not MONGO_URI:
    print('Error: MONGO_URI or MONGO_URL not set. See .env.example')
    sys.exit(1)
DB_NAME = os.getenv('DB_NAME', 'web-portal')

client = MongoClient(MONGO_URI)
db = client[DB_NAME]

print("🔗 Consolidating LPR data...")
print(f"Connected to {DB_NAME} at {MONGO_URI}")

# Collections
users = db['users_cache']
visitors = db['visitors']
plates = db['license_plates']

# Get all users and visitors with their plates
all_user_data = {}
updates_made = 0

# Process users_cache
print("\n👥 Processing users_cache...")
user_count = 0
for user in users.find():
    if user.get('license_plates') and isinstance(user['license_plates'], list):
        for plate_obj in user['license_plates']:
            plate_num = plate_obj.get('credential', '').upper()
            if plate_num:
                all_user_data[plate_num] = {
                    'user_name': user.get('name') or user.get('user_name') or user.get('first_name') or 'Unknown',
                    'user_email': user.get('user_email') or user.get('email') or 'unknown',
                    'source': 'users_cache'
                }
                user_count += 1

print(f"Found {user_count} registered plates from {users.count_documents({})} users")

# Process visitors
print("\n👤 Processing visitors...")
visitor_count = 0
for visitor in visitors.find():
    if visitor.get('license_plates') and isinstance(visitor['license_plates'], list):
        for plate_obj in visitor['license_plates']:
            plate_num = plate_obj.get('credential', '').upper()
            if plate_num:
                if plate_num not in all_user_data:  # Don't overwrite users_cache
                    all_user_data[plate_num] = {
                        'user_name': visitor.get('name') or visitor.get('user_name') or visitor.get('first_name') or 'Unknown',
                        'user_email': visitor.get('user_email') or visitor.get('email') or 'unknown',
                        'source': 'visitors'
                    }
                visitor_count += 1

print(f"Found {visitor_count} registered plates from {visitors.count_documents({})} visitors")

# Update all plate detections with user information
print(f"\n🔄 Updating {plates.count_documents({})} plate detections...")

for plate_num, user_info in all_user_data.items():
    # Update all detections for this plate
    result = plates.update_many(
        {'license_plate': plate_num},
        {
            '$set': {
                'user_name': user_info['user_name'],
                'user_email': user_info['user_email'],
                'user_source': user_info['source']
            }
        }
    )
    if result.modified_count > 0:
        updates_made += result.modified_count
        print(f"  {plate_num}: {user_info['user_name']} ({user_info['user_email']}) - {result.modified_count} detections updated")

# Fix any plates that are still marked as "unknown" email
print("\n⚠️  Checking for unlinked plates...")
unlinked = plates.find({'user_email': 'unknown'})
unlinked_count = plates.count_documents({'user_email': 'unknown'})

if unlinked_count > 0:
    print(f"Found {unlinked_count} unlinked plate detections:")
    for detection in unlinked:
        print(f"  {detection['license_plate']} - {detection['timestamp']}")

print(f"\n✅ Data consolidation complete!")
print(f"Total updates made: {updates_made}")
print(f"Unique plates tracked: {len(all_user_data)}")
print(f"Users processed: {users.count_documents({})}")
print(f"Visitors processed: {visitors.count_documents({})}")
print(f"Total detections: {plates.count_documents({})}")

# Summary of linked vs unlinked
linked = plates.count_documents({'user_email': {'$ne': 'unknown'}})
unlinked = plates.count_documents({'user_email': 'unknown'})
print(f"\n📊 Statistics:")
print(f"  Linked detections: {linked}")
print(f"  Unlinked detections: {unlinked}")
