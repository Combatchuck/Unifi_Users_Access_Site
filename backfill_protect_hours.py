#!/usr/bin/env python3
"""Backfill UniFi Protect events for the last N hours (default 1)
Fetches events from Protect and inserts any missing license plate detections
into the `license_plates` Mongo collection.

Usage:
  python backfill_protect_hours.py            # backfill last 1 hour
  python backfill_protect_hours.py --hours 24 # backfill last 24 hours
  python backfill_protect_hours.py 72        # backfill last 72 hours (positional)

This is a replacement for the older `backfill_protect_45m.py` and supports arbitrary hour windows.
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
import argparse

load_dotenv()

# Use shared helpers for camera filters and plate sanitization
from LPR_Notifications.lpr_helpers import get_camera_filters, should_skip_camera, sanitize_plate


def parse_args():
    p = argparse.ArgumentParser(description='Backfill Protect events for the last N hours')
    p.add_argument('hours', nargs='?', type=int, help='Number of hours to backfill (positional)', default=None)
    p.add_argument('--hours', dest='hours_opt', type=int, help='Number of hours to backfill (flag)')
    p.add_argument('--min-confidence', type=int, default=os.getenv('LPR_MIN_CONF', 50), help='Minimum plate confidence to accept')
    return p.parse_args()


async def main():
    args = parse_args()
    hours = args.hours if args.hours is not None else args.hours_opt if args.hours_opt is not None else 1
    if hours < 0:
        print('Error: hours must be >= 0')
        return

    minutes = hours * 60

    from uiprotect import ProtectApiClient

    # Compute start window
    now = datetime.now(timezone.utc)
    start = now - timedelta(minutes=minutes)

    print(f"Backfill window: {start.isoformat()} -> {now.isoformat()} (hours={hours})")

    # Connect to Protect
    try:
        # Load .env if present (already called at module load, but safe to ensure)
        try:
            from dotenv import load_dotenv
            load_dotenv()
        except Exception:
            pass

        host = os.getenv('UNIFI_PROTECT_HOST')
        if not host:
            print('Error: UNIFI_PROTECT_HOST not set. See .env.example')
            return

        port = int(os.getenv('UNIFI_PROTECT_PORT', '443'))
        username = os.getenv('UNIFI_PROTECT_USERNAME')
        password = os.getenv('UNIFI_PROTECT_PASSWORD', '')
        api_key = os.getenv('UNIFI_PROTECT_API_KEY', '')
        verify_ssl = os.getenv('UNIFI_PROTECT_VERIFY_SSL', 'true').lower() == 'true'

        if not api_key and not username:
            print('Error: UNIFI_PROTECT_API_KEY or UNIFI_PROTECT_USERNAME must be set. See .env.example')
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
        print("✓ Connected to UniFi Protect")
    except Exception as e:
        print(f"Failed to connect to Protect: {e}")
        return

    # Connect to Mongo
    try:
        mongo_url = os.getenv('MONGO_URL')
        if mongo_url:
            client = MongoClient(mongo_url)
            # Use either default DB from URI or override with MONGODB_DATABASE
            mongo_db = os.getenv('MONGODB_DATABASE')
            if mongo_db:
                db = client[mongo_db]
            else:
                db = client.get_default_database()
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

    # Fetch events since start. Note: Protect may ignore the start/end filters in some versions and iterate.
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

            # Ensure this is an LPR camera
            cam_obj = None
            try:
                cam_obj = protect.bootstrap.cameras.get(event.camera_id)
            except Exception:
                cam_obj = None

            cam_name = getattr(cam_obj, 'name', None) if cam_obj else None
            cam_type = getattr(cam_obj, 'type', None) if cam_obj else None

            if not cam_type == 'UVC AI LPR' and not (cam_name and 'LPR' in cam_name and ('Right' in cam_name or 'Left' in cam_name)):
                print(f"Skipping non-LPR camera event: camera_name={cam_name} camera_type={cam_type} event={getattr(event,'id',None)}")
                skipped += 1
                skipped_reasons['non_lpr'] += 1
                continue

            if not event.smart_detect_types or 'licensePlate' not in event.smart_detect_types:
                skipped += 1
                skipped_reasons['no_licenseplate_detect'] += 1
                continue

            # Extract license plate (sanitize)
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
            MIN_CONF = int(args.hours_opt or os.getenv('LPR_MIN_CONF', 50)) if False else int(os.getenv('LPR_MIN_CONF', '50'))
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

            # Lookup user_email
            user_email = 'unknown'
            try:
                users_cache = db['users_cache']
                user = users_cache.find_one({'license_plates': {'$elemMatch': {'credential': license_plate}}})
                if user:
                    user_email = user.get('user_email') or user.get('email') or 'unknown'
            except Exception:
                pass

            # Extract vehicle data
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

            # thumbnails -> GridFS (best effort)
            thumbnails_meta = []
            try:
                fs = GridFS(db)
            except Exception:
                fs = None

            thumbs = getattr(event.metadata, 'detected_thumbnails', []) if getattr(event, 'metadata', None) else []
            fetch_methods = ['get_thumbnail', 'get_thumbnail_bytes', 'get_cropped_thumbnail', 'get_snapshot', 'get_cropped_snapshot', 'get_raw_thumbnail']

            for thumb in thumbs:
                meta = {
                    'cropped_id': getattr(thumb, 'cropped_id', None) or getattr(thumb, 'object_id', None),
                    'type': getattr(thumb, 'type', None),
                    'confidence': getattr(thumb, 'confidence', None),
                    'coord': getattr(thumb, 'coord', None),
                    'name': getattr(thumb, 'name', None)
                }
                gridfs_id = None
                cropped_id = meta.get('cropped_id')
                if not fs or not cropped_id:
                    thumbnails_meta.append(meta)
                    continue

                for m in fetch_methods:
                    fn = getattr(protect, m, None)
                    if not fn or not callable(fn):
                        continue
                    try:
                        res = fn(cropped_id)
                        if asyncio.iscoroutine(res):
                            data = await res
                        else:
                            data = res
                        if not data:
                            continue
                        if isinstance(data, bytes):
                            gridfs_id = fs.put(data, filename=f"thumb_{cropped_id}.jpg", contentType='image/jpeg')
                            break
                        if hasattr(data, 'content') and data.content:
                            gridfs_id = fs.put(data.content, filename=f"thumb_{cropped_id}.jpg", contentType='image/jpeg')
                            break
                    except Exception:
                        # ignore errors fetching thumbnails
                        continue

                if gridfs_id:
                    meta['gridfs_id'] = gridfs_id
                thumbnails_meta.append(meta)

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

            # Upsert into Mongo (event_id dedupe)
            try:
                res = plates.update_one({'event_id': doc['event_id']}, {'$set': doc}, upsert=True)
                # We treat upsert as an insert/update; count as inserted for visibility
                inserted += 1
                print(f"Inserted/Updated: {doc['license_plate']} event={doc['event_id']}")
            except Exception as e:
                write_errors += 1
                print(f"Write error for event {getattr(event,'id', None)}: {e}")

            processed += 1
            # Periodic progress
            if processed % 100 == 0:
                elapsed = time.time() - start_time
                print(f"Progress: processed={processed} inserted={inserted} skipped={skipped} write_errors={write_errors} elapsed={int(elapsed)}s")

        except Exception as e:
            skipped += 1
            skipped_reasons['exception'] += 1
            print(f"Exception processing event {getattr(event,'id', None)}: {e}")
            continue

    # Final summary
    elapsed = time.time() - start_time
    print("\n--- Backfill Summary ---")
    print(f"Window: {start.isoformat()} -> {now.isoformat()} (hours={hours})")
    print(f"Processed: {processed}")
    print(f"Inserted/Updated: {inserted}")
    print(f"Skipped: {skipped}")
    print(f"Write errors: {write_errors}")
    print(f"Elapsed: {int(elapsed)} seconds")
    if skipped_reasons:
        print("Skipped reasons:")
        for k, v in sorted(skipped_reasons.items(), key=lambda x: x[1], reverse=True):
            print(f"  {k}: {v}")

    # Clean up Protect client to avoid unclosed aiohttp sessions/connectors
    try:
        close = getattr(protect, 'close', None)
        if close:
            if asyncio.iscoroutinefunction(close):
                await close()
            else:
                close()
    except Exception:
        pass

    # Cancel any remaining pending asyncio tasks (prevents background aiohttp writes after loop closes)
    try:
        current = asyncio.current_task()
        pending = [t for t in asyncio.all_tasks() if t is not current]
        if pending:
            for t in pending:
                t.cancel()
            # Wait for cancelled tasks to finish
            await asyncio.gather(*pending, return_exceptions=True)
    except Exception:
        pass

    # Some versions of Protect client may hold an aiohttp ClientSession under different attribute names.
    # Attempt to find and close it directly to avoid 'Unclosed client session' warnings.
    try:
        for attr in ('session', '_session', 'client_session', 'client', '_client', 'http'):
            sess = getattr(protect, attr, None)
            if sess:
                try:
                    close_fn = getattr(sess, 'close', None)
                    if close_fn:
                        if asyncio.iscoroutinefunction(close_fn):
                            await close_fn()
                        else:
                            close_fn()
                except Exception:
                    pass

        # Also inspect nested attributes
        for name in dir(protect):
            try:
                val = getattr(protect, name)
            except Exception:
                continue
            if not val:
                continue
            # close aiohttp ClientSession
            try:
                if hasattr(val, 'close'):
                    close_fn = getattr(val, 'close')
                    if close_fn and close_fn != getattr(protect, 'close', None):
                        if asyncio.iscoroutinefunction(close_fn):
                            await close_fn()
                        else:
                            close_fn()
            except Exception:
                pass
    except Exception:
        pass

    # Give the loop a moment to process cancellations
    try:
        await asyncio.sleep(0)
    except Exception:
        pass


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('\nInterrupted by user')
