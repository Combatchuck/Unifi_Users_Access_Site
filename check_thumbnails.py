#!/usr/bin/env python3
"""
Check thumbnail presence in `license_plates` and GridFS counts.
"""
import os
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

url = os.getenv('MONGO_URL')
if not url:
    print('Error: MONGO_URL not set. See .env.example')
    sys.exit(1)
client = MongoClient(url)
db = client.get_default_database()
plates = db['license_plates']

total = plates.count_documents({})
th_with_array = plates.count_documents({'thumbnails': {'$exists': True}})
th_nonempty = plates.count_documents({'thumbnails.0': {'$exists': True}})
th_empty = plates.count_documents({'thumbnails': {'$exists': True, '$size': 0}})
th_missing = plates.count_documents({'thumbnails': {'$exists': False}})

fs_files = db['fs.files'].count_documents({}) if 'fs.files' in db.list_collection_names() else 0

print('total_license_plates:', total)
print('thumbnails_field_exists:', th_with_array)
print('thumbnails_nonempty:', th_nonempty)
print('thumbnails_empty_array:', th_empty)
print('thumbnails_missing_field:', th_missing)
print('gridfs_files:', fs_files)

if th_nonempty>0:
    sample = plates.find({'thumbnails.0': {'$exists': True}}).sort('timestamp', -1).limit(1)
    for s in sample:
        print('\nSample doc with thumbnail:')
        print('id:', s.get('_id'))
        print('event_id:', s.get('event_id'))
        print('thumbnails:', s.get('thumbnails'))

client.close()
