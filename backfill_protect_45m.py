#!/usr/bin/env python3
"""
Backfill UniFi Protect events for the last N minutes (default 45)
Fetches events from Protect and inserts any missing license plate detections
into the `license_plates` Mongo collection.

Usage:
  python backfill_protect_45m.py [minutes]

Note: This script is deprecated in favor of `backfill_protect_hours.py` which accepts an hours parameter and provides the same behavior. The legacy script remains for backwards compatibility.

"""
import os
import sys
import asyncio
from datetime import datetime, timedelta, timezone
from pymongo import MongoClient
from gridfs import GridFS
from dotenv import load_dotenv
import time
from collections import defaultdict

load_dotenv()

MINUTES = int(sys.argv[1]) if len(sys.argv) > 1 else 45

# Use shared helpers for camera filters and plate sanitization
from LPR_Notifications.lpr_helpers import get_camera_filters, should_skip_camera, sanitize_plate


async def main():
    from uiprotect import ProtectApiClient

    # Compute start window
    now = datetime.now(timezone.utc)
    start = now - timedelta(minutes=MINUTES)

    print(f"Backfill window: {start.isoformat()} -> {now.isoformat()}")

    # Connect to Protect
    try:
        host = os.getenv('UNIFI_PROTECT_HOST')
        if not host:
            print('Error: UNIFI_PROTECT_HOST not set. See .env.example')
            return
        protect = ProtectApiClient(
            host=host,
            port=int(os.getenv('UNIFI_PROTECT_PORT', 443)),
            username=os.getenv('UNIFI_PROTECT_USERNAME'),
            password=os.getenv('UNIFI_PROTECT_PASSWORD', ''),
            verify_ssl=os.getenv('UNIFI_PROTECT_VERIFY_SSL', 'true').lower() in ('1','true','yes'),
            api_key=os.getenv('UNIFI_PROTECT_API_KEY', '')
        )

        await protect.update()
        print("✓ Connected to UniFi Protect")
    except Exception as e:
        print(f"Failed to connect to Protect: {e}")
        return

    # Connect to Mongo
    try:
        mongo_url = os.getenv('MONGO_URL')
        if mongo_url:
            client = MongoClient(mongo_url)
            db = client.get_database()
        else:
            mongo_host = os.getenv('MONGODB_HOST')
            if not mongo_host:
                print('Error: MONGO_URL or MONGODB_HOST must be set. See .env.example')
                return
            mongo_port = os.getenv('MONGODB_PORT','27017')
            mongo_db = os.getenv('MONGODB_DATABASE', 'web-portal')
            client = MongoClient(f"{mongo_host}:{mongo_port}")
            db = client[mongo_db]
        plates = db['license_plates']
        print("✓ Connected to MongoDB")
    except Exception as e:
        print(f"Failed to connect to Mongo: {e}")
        return

    # Fetch events since start
    try:
        events = await protect.get_events(start=start, limit=1000)
        total_events = len(events)
        print(f"Fetched {total_events} events from Protect")
    except Exception as e:
        print(f"Failed to fetch events: {e}")
        events = []
        total_events = 0

    # Progress & counters
    inserted = 0
    skipped = 0
    processed = 0
    write_errors = 0
    skipped_reasons = defaultdict(int)
    start_time = time.time()

    for event in events:
        try:
            # Only process events that have a camera id
            if not event.camera_id:
                skipped += 1
                skipped_reasons['no_camera'] += 1
                continue

            # Ensure this is an LPR camera (protect bootstrap contains camera info)
            cam_obj = None
            try:
                cam_obj = protect.bootstrap.cameras.get(event.camera_id)
            except Exception:
                cam_obj = None

            cam_name = getattr(cam_obj, 'name', None) if cam_obj else None
            cam_type = getattr(cam_obj, 'type', None) if cam_obj else None

            # If camera is not LPR typed or not named LPR Left/Right, skip (log for diagnosis)
            if not cam_type == 'UVC AI LPR' and not (cam_name and 'LPR' in cam_name and ('Right' in cam_name or 'Left' in cam_name)):
                print(f"Skipping non-LPR camera event: camera_name={cam_name} camera_type={cam_type} event={getattr(event,'id',None)}")
                skipped += 1
                skipped_reasons['non_lpr'] += 1
                continue

            if not event.smart_detect_types or 'licensePlate' not in event.smart_detect_types:
                skipped += 1
                skipped_reasons['no_licenseplate_detect'] += 1
                continue

            # Extract license plate (sanitize placeholders)
            license_plate = None
            confidence = 0
            if event.metadata and getattr(event.metadata, 'detected_thumbnails', None):
                for thumb in event.metadata.detected_thumbnails:
                    if getattr(thumb, 'type', None) == 'vehicle':
                        cand = getattr(thumb, 'name', None)
                        plate = sanitize_plate(cand)
                        if plate:
                            license_plate = plate
                            confidence = getattr(thumb, 'confidence', 0)
                            break

            if not license_plate:
                skipped += 1
                skipped_reasons['no_plate_extracted'] += 1
                continue

            # validate license_plate format and confidence
            import re
            PLATE_REGEX = re.compile(r'^[A-Z0-9-]{2,}$')
            MIN_CONF = int(os.getenv('LPR_MIN_CONF', '50'))
            if not PLATE_REGEX.match(license_plate):
                skipped += 1
                skipped_reasons['invalid_plate'] += 1
                print(f"Skipping backfill event {event.id}: invalid license_plate '{license_plate}'")
                continue
            try:
                conf_val = int(confidence) if confidence is not None else 0
            except Exception:
                conf_val = 0
            if conf_val < MIN_CONF:
                skipped += 1
                skipped_reasons['low_confidence'] += 1
                print(f"Skipping backfill event {event.id}: confidence {conf_val} < MIN_CONF {MIN_CONF}")
                continue

            # Lookup user_email similar to capture service
            user_email = 'unknown'
            try:
                users_cache = db['users_cache']
                user = users_cache.find_one({'license_plates': {'$elemMatch': {'credential': license_plate}}})
                if user:
                    user_email = user.get('user_email') or user.get('email') or 'unknown'
            except Exception:
                pass

            # attempt to extract vehicle attributes (color/type) similar to capture service
            vehicle_data = {}
            try:
                md = getattr(event, 'metadata', None)
                candidates = [
                    getattr(event, 'vehicle', None),
                    getattr(md, 'vehicle', None) if md else None,
                    getattr(md, 'vehicle_data', None) if md else None,
                    getattr(event, 'vehicle_data', None)
                ]
                for c in candidates:
                    if not c:
                        continue
                    if isinstance(c, dict):
                        vehicle_data = c
                        break
                    try:
                        d = {}
                        if hasattr(c, 'attributes'):
                            attrs = getattr(c, 'attributes')
                            try:
                                d['attributes'] = dict(attrs)
                            except Exception:
                                try:
                                    d['attributes'] = {k: getattr(attrs, k) for k in dir(attrs) if not k.startswith('_')}
                                except Exception:
                                    d['attributes'] = attrs
                        if hasattr(c, 'group'):
                            d['group'] = getattr(c, 'group')
                        for attr_name in ('make', 'model', 'color', 'vehicleType'):
                            if hasattr(c, attr_name):
                                d[attr_name] = getattr(c, attr_name)
                        try:
                            if hasattr(c, '__dict__'):
                                d.update({k: v for k, v in c.__dict__.items() if not k.startswith('_')})
                        except Exception:
                            pass
                        vehicle_data = d
                        break
                    except Exception:
                        continue
            except Exception:
                vehicle_data = {}

            def _find_nested(obj, keys):
                if not obj:
                    return None
                if isinstance(obj, dict):
                    for k, v in obj.items():
                        if k in keys:
                            if isinstance(v, dict) and 'value' in v:
                                return v.get('value')
                            return v
                        val = _find_nested(v, keys) if isinstance(v, (dict, list)) else None
                        if val:
                            return val
                elif isinstance(obj, list):
                    for item in obj:
                        val = _find_nested(item, keys)
                        if val:
                            return val
                else:
                    try:
                        for k in dir(obj):
                            if k in keys:
                                return getattr(obj, k)
                    except Exception:
                        pass
                return None

            vehicle_color = _find_nested(vehicle_data, ['color', 'colour'])
            vehicle_type = _find_nested(vehicle_data, ['vehicleType', 'vehicle_type', 'type'])

            # attempt to extract and store thumbnails as GridFS
            thumbnails_meta = []
            try:
                fs = GridFS(db)
                thumbs = getattr(event.metadata, 'detected_thumbnails', []) if getattr(event, 'metadata', None) else []
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
            except Exception:
                thumbnails_meta = []

            doc = {
                'event_id': event.id,
                'timestamp': event.start,
                'camera_id': event.camera_id,
                'camera_name': getattr(protect.bootstrap.cameras.get(event.camera_id), 'name', None) if protect.bootstrap else None,
                'license_plate': license_plate,
                'confidence': confidence,
                'user_email': user_email,
                'vehicle_data': vehicle_data,
                'vehicle_color': vehicle_color,
                'vehicle_type': vehicle_type,
                'thumbnails': thumbnails_meta,
                'detected_at': datetime.now(timezone.utc).isoformat(),
                'origin': 'backfill'
            }

            # Guard: enforce allowed camera filters before attempting DB writes
            allowed_ids, allowed_names, skip_subs = get_camera_filters()
            cam = cam_name or ''
            if allowed_ids and event.camera_id not in allowed_ids:
                print(f"Skipping backfill event {event.id}: camera_id {event.camera_id} not in LPR_CAMERA_IDS")
                skipped += 1
                continue
            if allowed_names and not any(sub in cam for sub in allowed_names):
                print(f"Skipping backfill event {event.id}: camera_name '{cam}' not matching LPR_CAMERA_NAMES")
                skipped += 1
                continue
            if not allowed_ids and not allowed_names and any(sub in cam.lower() for sub in skip_subs):
                print(f"Skipping backfill event {event.id}: camera '{cam}' matches skip substrings {skip_subs}")
                skipped += 1
                continue

            # insert or update if event already exists
            # upsert with error handling
            try:
                plates.update_one({'event_id': event.id}, {'$set': doc}, upsert=True)
                inserted += 1
                if license_plate:
                    print(f"Inserted/Updated: {license_plate} @ {event.start} (event {event.id}) | color={vehicle_color} type={vehicle_type}")
                else:
                    print(f"Inserted/Updated: UNREAD @ {event.start} (event {event.id}) | color={vehicle_color} type={vehicle_type}")
            except Exception as e:
                write_errors += 1
                skipped_reasons['write_error'] += 1
                print(f"Mongo write failed during backfill for event {event.id} (plate={license_plate}, camera={cam_name}, camera_id={event.camera_id}): {e}")
                try:
                    db.get_collection('license_plate_write_errors').insert_one({
                        'event_id': event.id,
                        'camera_id': event.camera_id,
                        'camera_name': cam_name,
                        'license_plate': license_plate,
                        'confidence': confidence,
                        'error': str(e),
                        'timestamp': datetime.now(timezone.utc)
                    })
                except Exception:
                    pass

        except Exception as e:
            print(f"Error processing event {getattr(event, 'id', '<no-id>')}: {e}")
        finally:
            processed += 1
            # Periodic progress output to give visibility into long runs
            if total_events and processed % 100 == 0:
                print(f"Progress: processed {processed}/{total_events} events | inserted={inserted} skipped={skipped} write_errors={write_errors}")

    total = plates.count_documents({})
    elapsed = time.time() - start_time if 'start_time' in globals() or 'start_time' in locals() else None
    print("\nBackfill summary:")
    print(f"  total_events_scanned: {total_events}")
    print(f"  inserted: {inserted}")
    print(f"  skipped_total: {skipped}")
    for reason, count in skipped_reasons.items():
        print(f"    {reason}: {count}")
    print(f"  write_errors: {write_errors}")
    if elapsed is not None:
        print(f"  elapsed_seconds: {elapsed:.1f}")

    print(f"\nDone. Inserted: {inserted}, Skipped: {skipped}, Total in DB: {total}")

    # Cleanup
    try:
        close_coro = getattr(protect, 'close', None)
        if close_coro:
            if asyncio.iscoroutinefunction(close_coro):
                await close_coro()
            else:
                close_coro()
    except Exception:
        pass

    # Try to explicitly close underlying session
    try:
        candidates = ['session', '_session', 'http_client', '_client', 'client', 'aiohttp_session']
        for name in candidates:
            obj = getattr(protect, name, None)
            if obj:
                try:
                    close_fn = getattr(obj, 'close', None)
                    if close_fn:
                        if asyncio.iscoroutinefunction(close_fn):
                            await close_fn()
                        else:
                            close_fn()
                        break
                except Exception:
                    pass
    except Exception:
        pass

    try:
        client.close()
    except Exception:
        pass

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('\nCancelled')
