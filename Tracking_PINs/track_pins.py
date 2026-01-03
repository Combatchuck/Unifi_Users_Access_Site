#!/usr/bin/env python3
"""Track PIN/QR events and match to unassigned plates seen by LPR Camera Left.

Usage examples:
  # from API (simple GET)
  ./track_pins.py --mode api --api-url "https://protect.example/api/pins?start=...&end=..." --start 2026-01-01T00:00:00Z --end 2026-01-01T23:59:59Z --out report.csv

  # from API (POST with JSON body, custom headers, and skipping TLS verify like curl --insecure)
  ./track_pins.py --mode api \
    --api-url "https://${UNIFI_PROTECT_HOST}:12445/api/v1/developer/system/logs?page_size=25&page_num=1" \
    # or set UNIFI_PROTECT_HOST in .env and pass a short url like "https://$UNIFI_PROTECT_HOST:12445/..."
    --api-method POST \
    --api-headers '{"Authorization":"Bearer deN64WaTGT482FmJlb5PPQ","accept":"application/json","content-type":"application/json"}' \
    --api-data '{"topic":"door_openings"}' \
    --insecure \
    --start 2026-01-01T00:00:00Z --end 2026-01-01T23:59:59Z --out report.csv

  # Filter to specific device(s) (defaults to Kiosk) and credential providers (PIN_CODE, QR_CODE)
  # Example: only include events from device display name containing "Kiosk"
  ./track_pins.py --mode api --device-filter Kiosk --out report.csv

  # from a saved JSON file (where file contains an array of events)
  ./track_pins.py --mode file --api-json sample_events.json --start 2026-01-01T00:00:00Z --end 2026-01-01T23:59:59Z --out report.csv

Notes:
- The script expects each PIN/QR event to have at least a timestamp and an identifier (user_email or user_id).
- Does NOT modify DB; only reads and emits CSV of matches.
"""

import argparse
import os
import sys
import json
import csv
import datetime
import dateutil.parser
from pymongo import MongoClient
try:
    import requests
except Exception:
    requests = None
from dotenv import load_dotenv

load_dotenv()

DEFAULT_DELTA = int(os.getenv('TIME_DELTA_SECONDS', '60'))
MONGO_HOST = os.getenv('MONGODB_HOST') or os.getenv('MONGO_URL')
if not MONGO_HOST:
    print('Error: MONGODB_HOST or MONGO_URL must be set. See .env.example')
    sys.exit(1)
MONGO_PORT = int(os.getenv('MONGODB_PORT', '27017'))
MONGO_DB = os.getenv('MONGODB_DATABASE', 'web-portal')


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--mode', choices=['api', 'file'], required=True, help='api or file (json)')
    p.add_argument('--api-url', help='API URL to fetch PIN/QR events')
    p.add_argument('--api-method', default='GET', help='HTTP method for API requests (GET, POST, etc.)')
    p.add_argument('--api-headers', help='JSON string of headers')
    p.add_argument('--api-data', help='JSON string or @path to file to send as request body')
    p.add_argument('--insecure', action='store_true', help='Disable TLS verification (like curl --insecure)')
    p.add_argument('--api-json', help='Local JSON file with events (array)')
    p.add_argument('--device-filter', help='Comma-separated device display names or substrings to include (default: "Kiosk")', default='Kiosk')
    p.add_argument('--start', help='ISO start time (inclusive). Optional when using --mode file; will be inferred from file if omitted')
    p.add_argument('--end', help='ISO end time (inclusive). Optional when using --mode file; will be inferred from file if omitted')
    p.add_argument('--time-delta', type=int, default=DEFAULT_DELTA, help='matching window in seconds')
    p.add_argument('--out', default='tracking_report.csv', help='CSV output path')
    return p.parse_args()


def _find_first_list(obj):
    """Recursively find and return the first list inside a JSON-like structure."""
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict):
        # check common nested keys first
        for k in ('hits','results','items','events','data'):
            v = obj.get(k)
            if isinstance(v, list):
                return v
            if isinstance(v, dict):
                found = _find_first_list(v)
                if found is not None:
                    return found
        # fall back to any nested list
        for v in obj.values():
            found = _find_first_list(v)
            if found is not None:
                return found
    return None


def load_api_events_from_file(path):
    with open(path, 'r') as f:
        data = json.load(f)
    if isinstance(data, list):
        return data
    lst = _find_first_list(data)
    if lst is None:
        raise ValueError('No list of events found in JSON')
    return lst


def fetch_api_events(url, method='GET', headers=None, data=None, verify=True):
    method = method.upper()
    headers = headers or {}
    payload = None
    if data:
        # allow passing '@path' to load JSON from a file, or raw JSON string
        if isinstance(data, str) and data.startswith('@') and os.path.exists(data[1:]):
            with open(data[1:], 'r') as f:
                payload = json.load(f)
        else:
            try:
                payload = json.loads(data)
            except Exception:
                payload = data
    kwargs = dict(headers=headers, timeout=30, verify=verify)
    if payload is not None:
        if isinstance(payload, (dict, list)):
            kwargs['json'] = payload
        else:
            kwargs['data'] = payload
    r = requests.request(method, url, **kwargs)
    r.raise_for_status()
    data = r.json()
    # attempt to find event list
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        # common keys: data, results, events
        for k in ('data','results','events','items'):
            if k in data and isinstance(data[k], list):
                return data[k]
            # special case: data may be an object with hits
            if k in data and isinstance(data[k], dict):
                inner = data[k]
                if 'hits' in inner and isinstance(inner['hits'], list):
                    return inner['hits']
    # Fallback: recursively search for first list
    lst = _find_first_list(data)
    if lst is not None:
        return lst
    raise ValueError('Could not interpret API response as list of events')


def to_dt(s):
    # Parse ISO strings or pass-through datetimes, and normalize to UTC-aware datetime
    if isinstance(s, datetime.datetime):
        dt = s
    else:
        dt = dateutil.parser.isoparse(s)
    if dt.tzinfo is None:
        # assume UTC if no timezone info (our DB stores UTC timestamps)
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt


def connect_mongo():
    uri = f"{MONGO_HOST}:{MONGO_PORT}"
    client = MongoClient(uri)
    db = client[MONGO_DB]
    return client, db


def query_unassigned_plates(db, start, end):
    # Find plates on LPR Camera Left with no linked user (user_email missing or 'unknown') in the time window
    q = {
        'camera_name': 'LPR Camera Left',
        'timestamp': {'$gte': start, '$lte': end},
        '$or': [
            {'user_email': {'$exists': False}},
            {'user_email': None},
            {'user_email': 'unknown'}
        ]
    }
    docs = list(db['license_plates'].find(q))
    return docs


def match_events(pins, plates, delta_seconds=60):
    # pins: list of dicts, must have 'timestamp' and 'user' or similar
    # plates: list of license_plate docs with 'timestamp'
    plates_sorted = sorted(plates, key=lambda p: p['timestamp'])
    matches = []

    for pin in pins:
        # Normalize pin timestamp
        pin_ts = pin.get('timestamp') or pin.get('time') or pin.get('created_at')
        if not pin_ts:
            continue
        pin_dt = to_dt(pin_ts)
        low = pin_dt - datetime.timedelta(seconds=delta_seconds)
        high = pin_dt + datetime.timedelta(seconds=delta_seconds)
        # find plates within range
        for p in plates_sorted:
            p_ts = p.get('timestamp')
            if not p_ts:
                continue
            # Normalize plate timestamp to aware datetime
            try:
                p_dt = to_dt(p_ts)
            except Exception:
                continue
            if p_dt >= low and p_dt <= high:
                matches.append({
                    'pin_time': pin_dt.isoformat(),
                    'pin_user': pin.get('user_email') or pin.get('user') or pin.get('email') or pin.get('user_id'),
                    'plate_time': p_dt.isoformat(),
                    'plate': p.get('license_plate'),
                    'plate_event_id': p.get('event_id') or p.get('protect_event_id'),
                    'delta_seconds': (p_dt - pin_dt).total_seconds()
                })
    return matches


def write_csv(path, matches):
    with open(path, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['pin_time','pin_user','plate_time','plate','plate_event_id','delta_seconds'])
        w.writeheader()
        for m in matches:
            w.writerow(m)


def _extract_timestamp_from_event(e):
    # Try several common places for a timestamp
    # Examples in our data: '@timestamp' at top-level, '_source.event.published' (ms since epoch)
    if isinstance(e, dict):
        if '@timestamp' in e and e['@timestamp']:
            return e['@timestamp']
        # try nested _source.event.published (ms)
        src = e.get('_source') or e.get('source') or {}
        if isinstance(src, dict):
            ev = src.get('event') or {}
            if isinstance(ev, dict) and 'published' in ev and ev['published']:
                # milliseconds since epoch
                try:
                    ms = int(ev['published'])
                    return datetime.datetime.fromtimestamp(ms / 1000.0, tz=datetime.timezone.utc).isoformat()
                except Exception:
                    pass
            # also try '@timestamp' inside _source
            if '@timestamp' in src and src['@timestamp']:
                return src['@timestamp']
    return None


def _infer_time_range_from_pins(pins):
    min_dt = None
    max_dt = None
    for e in pins:
        ts = _extract_timestamp_from_event(e)
        if not ts:
            # try shallow keys
            ts = e.get('timestamp') or e.get('time') or e.get('created_at') or e.get('when') or e.get('@timestamp')
        if not ts:
            continue
        try:
            dt = to_dt(ts)
        except Exception:
            continue
        if min_dt is None or dt < min_dt:
            min_dt = dt
        if max_dt is None or dt > max_dt:
            max_dt = dt
    return min_dt, max_dt


def _pin_matches_device_and_provider(e, device_filters, providers=('PIN_CODE','QR_CODE')):
    """Return True if event `e` appears to be from one of device_filters and uses an allowed provider.

    device_filters: list of substrings (case-insensitive) to match against target.display_name or target.type or target.id
    providers: tuple of allowed credential providers; if None, skip provider filtering
    """
    # check provider
    if providers is not None:
        auth = None
        if isinstance(e, dict):
            src = e.get('_source') or e.get('source') or e
            if isinstance(src, dict):
                auth = src.get('authentication') or {}
        if isinstance(auth, dict):
            provider = auth.get('credential_provider')
            if not provider or provider not in providers:
                return False
        else:
            # If no authentication info, be conservative and reject
            return False

    # check targets for device
    targs = []
    if isinstance(e, dict):
        src = e.get('_source') or e.get('source') or e
        if isinstance(src, dict):
            targs = src.get('target') or []
    if not isinstance(targs, list):
        targs = []
    for t in targs:
        if not isinstance(t, dict):
            continue
        display = t.get('display_name','') or ''
        ttype = t.get('type','') or ''
        tid = t.get('id') or ''
        s_display = display.lower()
        for f in device_filters:
            if f.lower() in s_display or f.lower() == ttype.lower() or f.lower() == str(tid).lower():
                return True
    return False


def main():
    args = parse_args()

    # fetch pins
    if args.mode == 'file':
        if not args.api_json:
            print('When using --mode file you must pass --api-json <file>')
            sys.exit(1)
        pins = load_api_events_from_file(args.api_json)
        # infer time range when missing
        start_arg = args.start
        end_arg = args.end
        if not start_arg or not end_arg:
            min_dt, max_dt = _infer_time_range_from_pins(pins)
            if not min_dt or not max_dt:
                print('Could not infer start/end from the JSON file. Please pass --start and --end explicitly.')
                sys.exit(1)
            # only fill missing ones; user-supplied ones still respected
            if not start_arg:
                start_arg = min_dt.isoformat()
            if not end_arg:
                end_arg = max_dt.isoformat()
    else:
        if not args.api_url:
            print('When using --mode api you must pass --api-url <url>')
            sys.exit(1)
        headers = json.loads(args.api_headers) if args.api_headers else None
        pins = fetch_api_events(args.api_url, method=args.api_method, headers=headers, data=args.api_data, verify=(not args.insecure))
        start_arg = args.start
        end_arg = args.end

    # parse start/end into datetimes
    try:
        start = to_dt(start_arg)
        end = to_dt(end_arg)
    except Exception as exc:
        print('Error parsing --start/--end. Provide ISO timestamps like 2026-01-01T00:00:00Z or let the script infer them from a file with --mode file.')
        print('Parsing error:', exc)
        sys.exit(1)

    # normalize pins to have timestamp and user fields
    norm_pins = []
    raw_pins_with_times = []
    for e in pins:
        # try common shallow keys first
        ts = e.get('timestamp') or e.get('time') or e.get('created_at') or e.get('when') or e.get('@timestamp')
        if not ts:
            ts = _extract_timestamp_from_event(e)
        if not ts:
            continue
        # try common user fields, or fall back to nested _source.actor or authentication issuer
        user = e.get('user_email') or e.get('email') or e.get('user') or e.get('user_id')
        if not user:
            src = e.get('_source') or e.get('source') or {}
            if isinstance(src, dict):
                actor = src.get('actor') or {}
                if isinstance(actor, dict):
                    user = actor.get('display_name') or actor.get('id')
                auth = src.get('authentication') or {}
                if not user and isinstance(auth, dict):
                    user = auth.get('issuer') or auth.get('credential_provider')
        norm = {
            'timestamp': ts,
            'user_email': user,
            'raw': e
        }
        raw_pins_with_times.append((e, norm))

    # apply device/provider filter if provided
    device_filters = [f.strip() for f in args.device_filter.split(',')] if args.device_filter else []
    filtered_pins = []
    for raw_e, norm in raw_pins_with_times:
        if device_filters:
            if not _pin_matches_device_and_provider(raw_e, device_filters):
                continue
        filtered_pins.append(norm)

    norm_pins = filtered_pins

    client, db = connect_mongo()
    # enlarge window for plates to include delta
    delta = datetime.timedelta(seconds=args.time_delta)
    plates = query_unassigned_plates(db, start - delta, end + delta)

    matches = match_events(norm_pins, plates, delta_seconds=args.time_delta)
    if not os.path.isdir(os.path.dirname(args.out)) and os.path.dirname(args.out):
        os.makedirs(os.path.dirname(args.out), exist_ok=True)
    write_csv(args.out, matches)

    print(f"Pins processed: {len(norm_pins)}")
    print(f"Unassigned plates scanned: {len(plates)}")
    print(f"Matches found: {len(matches)}")
    if len(matches) > 0:
        print(f"Results written to: {args.out}")
    # helpful debug output when using device filters
    if args.device_filter:
        print(f"Device filter used: {args.device_filter}")

    client.close()


if __name__ == '__main__':
    main()
