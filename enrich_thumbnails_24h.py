#!/usr/bin/env python3
"""
Enrich existing license_plate documents (last 24h) by fetching detected thumbnails
from UniFi Protect, storing images in GridFS, and updating the documents with
thumbnail metadata (`thumbnails` array with `gridfs_id`).

Usage:
  python enrich_thumbnails_24h.py

"""
import os
import asyncio
from datetime import datetime, timedelta, timezone
from pymongo import MongoClient
from gridfs import GridFS
from pprint import pprint
from dotenv import load_dotenv

load_dotenv()

async def find_event_for_doc(protect, event_id, timestamp):
    # Try to find the event by scanning events around the timestamp
    try:
        start = timestamp - timedelta(seconds=10)
        events = await protect.get_events(start=start, limit=200)
        for ev in events:
            if getattr(ev, 'id', None) == event_id:
                return ev
    except Exception:
        pass
    return None

def parse_ts(ts):
    if isinstance(ts, str):
        try:
            return datetime.fromisoformat(ts.replace('Z', '+00:00'))
        except Exception:
            pass
    if isinstance(ts, datetime):
        return ts
    return None

async def main():
    # Connect to MongoDB - prefer MONGO_URL if set
    mongo_url = os.getenv('MONGO_URL')
    if mongo_url:
        client = MongoClient(mongo_url)
    else:
        mongo_host = os.getenv('MONGODB_HOST', 'localhost')
        mongo_port = os.getenv('MONGODB_PORT', '27017')
        client = MongoClient(f"{mongo_host}:{mongo_port}")

    db = client.get_default_database()
    plates = db['license_plates']
    fs = GridFS(db)

    try:
        from uiprotect import ProtectApiClient
    except Exception as e:
        print('uiprotect not available:', e)
        return

    try:
        host = os.getenv('UNIFI_PROTECT_HOST')
        port = int(os.getenv('UNIFI_PROTECT_PORT', 443))
        username = os.getenv('UNIFI_PROTECT_USERNAME')
        password = os.getenv('UNIFI_PROTECT_PASSWORD')
        api_key = os.getenv('UNIFI_PROTECT_API_KEY')
        verify_ssl = os.getenv('UNIFI_PROTECT_VERIFY_SSL', 'true').lower() == 'true'

        if not host:
            print('UNIFI_PROTECT_HOST not set. See .env.example')
            return
        if not api_key and not (username and password):
            print('UNIFI_PROTECT_API_KEY or UNIFI_PROTECT_USERNAME+UNIFI_PROTECT_PASSWORD must be set. See .env.example')
            return

        protect = ProtectApiClient(
            host=host,
            port=port,
            username=username,
            password=password,
            verify_ssl=verify_ssl,
            api_key=api_key
        )
        await protect.update()
    except Exception as e:
        print('Failed to connect to Protect:', e)
        return

    now = datetime.now(timezone.utc)
    hours = int(os.getenv('ENRICH_HOURS', '24'))
    since = now - timedelta(hours=hours)

    query = {
        '$and': [
            {'timestamp': {'$gte': since.isoformat()}},
            {'$or': [
                {'thumbnails': {'$exists': False}},
                {'thumbnails': {'$size': 0}}
            ]}
        ]
    }

    cursor = plates.find(query)
    total = plates.count_documents(query)
    print(f'Found {total} documents to enrich (last 24h)')

    enriched = 0
    skipped = 0

    # Use blocking iteration
    for doc in plates.find(query):
        try:
            event_id = doc.get('event_id')
            ts = parse_ts(doc.get('timestamp'))
            if not ts:
                skipped += 1
                continue

            ev = None
            if event_id:
                ev = await find_event_for_doc(protect, event_id, ts)

            if not ev:
                # try fetching recent events at camera
                try:
                    events = await protect.get_events(start=ts - timedelta(seconds=30), limit=200)
                    for e in events:
                        if getattr(e, 'camera_id', None) == doc.get('camera_id'):
                            ev = e
                            break
                except Exception:
                    pass

            if not ev:
                skipped += 1
                continue

            thumbs = getattr(ev, 'metadata', None) and getattr(ev.metadata, 'detected_thumbnails', None) or []
            thumbnails_meta = []
            for thumb in thumbs:
                meta = {
                    'cropped_id': getattr(thumb, 'cropped_id', None) or getattr(thumb, 'object_id', None),
                    'type': getattr(thumb, 'type', None),
                    'confidence': getattr(thumb, 'confidence', None),
                    'coord': getattr(thumb, 'coord', None),
                    'name': getattr(thumb, 'name', None)
                }
                gridfs_id = None
                try:
                    fetch_methods = ['get_thumbnail', 'get_thumbnail_bytes', 'get_cropped_thumbnail', 'get_snapshot', 'get_cropped_snapshot', 'get_raw_thumbnail']
                    for m in fetch_methods:
                        fn = getattr(protect, m, None)
                        if fn and callable(fn):
                            try:
                                res = fn(meta['cropped_id'])
                                if asyncio.iscoroutine(res):
                                    data = await res
                                else:
                                    data = res
                                if data:
                                    if isinstance(data, bytes):
                                        gridfs_id = fs.put(data, filename=f"thumb_{meta['cropped_id']}.jpg", contentType='image/jpeg')
                                        break
                                    if hasattr(data, 'content'):
                                        gridfs_id = fs.put(data.content, filename=f"thumb_{meta['cropped_id']}.jpg", contentType='image/jpeg')
                                        break
                            except Exception:
                                continue
                except Exception:
                    gridfs_id = None
                if gridfs_id:
                    meta['gridfs_id'] = gridfs_id
                thumbnails_meta.append(meta)

            if thumbnails_meta:
                plates.update_one({'_id': doc['_id']}, {'$set': {'thumbnails': thumbnails_meta}})
                enriched += 1
                # Avoid printing potentially sensitive event ids; log only short doc id and thumb count
                print(f"Enriched doc {str(doc.get('_id'))[:8]} thumbs={len(thumbnails_meta)}")
                if os.getenv('DEBUG_API') == 'true':
                    try:
                        pprint(thumbnails_meta)
                    except Exception:
                        pass
            else:
                skipped += 1

        except Exception as e:
            print('Error enriching doc:', e)
            skipped += 1

    print(f'Done. Enriched: {enriched}, Skipped: {skipped}')

    # cleanup
    try:
        close = getattr(protect, 'close', None)
        if close:
            if asyncio.iscoroutinefunction(close):
                await close()
            else:
                close()
    except Exception:
        pass

    try:
        for name in ['session', '_session', 'http_client', '_client', 'client']:
            obj = getattr(protect, name, None)
            if obj:
                close_fn = getattr(obj, 'close', None)
                if close_fn:
                    if asyncio.iscoroutinefunction(close_fn):
                        await close_fn()
                    else:
                        close_fn()
                    break
    except Exception:
        pass

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('\nCancelled')
