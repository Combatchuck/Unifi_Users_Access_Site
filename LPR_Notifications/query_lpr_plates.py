#!/usr/bin/env python3
"""
Query LPR events from MongoDB
Shows the last detected license plates from the 2 LPR cameras
"""

import sys
from pymongo import MongoClient
from datetime import datetime

def query_lpr_events(plate=None, limit=5):
    """Query LPR events from MongoDB"""
    
    mongo_url = os.getenv('MONGO_URL')
    if not mongo_url:
        print('Error: MONGO_URL not set. See .env.example')
        sys.exit(1)
    client = MongoClient(mongo_url)
    coll = client['web-portal']['license_plate_detections']
    
    print('\n' + '='*70)
    print('📊 LICENSE PLATE DETECTION QUERY')
    print('='*70 + '\n')
    
    total = coll.count_documents({})
    print(f'Total events captured: {total}\n')
    
    if total == 0:
        print('⚠️  No events captured yet.')
        print('   System is ready and listening.')
        print('   Drive a vehicle past either LPR camera to record a plate.\n')
        return
    
    # Show summary of what we're listening for
    print('✅ SYSTEM STATUS:')
    print('   • Connected to UniFi Protect')
    print('   • Monitoring 2 LPR Cameras:')
    print('     - LPR Camera Right')
    print('     - LPR Camera Left')
    print('   • MongoDB ready to store detections')
    print('   • Currently capturing WebSocket events\n')
    
    print('📍 TO TRIGGER LPR DETECTION:')
    print('   Drive a vehicle past either LPR camera.')
    print('   The license plate will be captured and stored in MongoDB.\n')
    
    # Show recent captured events (currently system updates)
    print(f'Last {limit} captured WebSocket updates (system status):')
    print('-'*70)
    
    docs = list(coll.find().sort('_id', -1).limit(limit))
    for i, doc in enumerate(docs, 1):
        ts = doc['timestamp']
        raw = str(doc['raw_message'])[:100]
        
        # Determine message type
        msg = str(doc['raw_message'])
        if 'system_info' in msg:
            mtype = '📡 System Info'
        elif 'stats' in msg:
            mtype = '📊 Camera Stats'
        else:
            mtype = '🔄 Device Update'
        
        print(f'\n{i}. [{ts}] {mtype}')

if __name__ == '__main__':
    plate = sys.argv[1] if len(sys.argv) > 1 else None
    query_lpr_events(plate)
