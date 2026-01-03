#!/usr/bin/env python3
"""
Deep search UniFi Protect events for QR/qrcode/scan and EventType.ACCESS

Usage: PROBE_MINUTES=30 python3 search_protect_qr.py
"""
import os
import asyncio
from datetime import datetime, timedelta, timezone


def contains_qr(obj):
    targ = ('qr', 'qrcode', 'qr_code', 'scan')
    try:
        if obj is None:
            return False
        if isinstance(obj, str):
            s = obj.lower()
            return any(t in s for t in targ)
        if isinstance(obj, (int, float, bool)):
            return False
        if isinstance(obj, dict):
            for k, v in obj.items():
                if contains_qr(k) or contains_qr(v):
                    return True
            return False
        if isinstance(obj, (list, tuple, set)):
            for item in obj:
                if contains_qr(item):
                    return True
            return False
        # fallback: convert to str
        try:
            return contains_qr(str(obj))
        except Exception:
            return False
    except Exception:
        return False


async def main():
    try:
        from uiprotect import ProtectApiClient
    except Exception as e:
        print('uiprotect not available:', e)
        return

    minutes = int(os.getenv('PROBE_MINUTES', '30'))
    now = datetime.now(timezone.utc)
    start = now - timedelta(minutes=minutes)

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
    except Exception as e:
        print('Failed to connect to Protect:', e)
        return

    events = []
    try:
        events = await protect.get_events(start=start, limit=1000)
        print(f'Fetched {len(events)} events')
    except Exception as e:
        print('Failed to fetch events:', e)

    matches = []
    for ev in events:
        try:
            etype = getattr(ev, 'type', None)
            is_access = False
            try:
                if etype and ('access' in str(etype).lower() or 'access' in getattr(etype, 'name', '').lower()):
                    is_access = True
            except Exception:
                pass

            md = getattr(ev, 'metadata', None)
            md_obj = None
            if md:
                try:
                    md_obj = md.__dict__ if hasattr(md, '__dict__') else dict(md)
                except Exception:
                    md_obj = str(md)

            if is_access or contains_qr(md_obj):
                matches.append((ev, md_obj))
        except Exception:
            continue

    print(f'Found {len(matches)} matching events (access or QR-like)')
    for ev, md in matches:
        print('\n---')
        print('id:', getattr(ev, 'id', None))
        print('type:', getattr(ev, 'type', None))
        print('start:', getattr(ev, 'start', None))
        print('camera_id:', getattr(ev, 'camera_id', None))
        print('metadata snippet:')
        try:
            print(str(md)[:1000])
        except Exception:
            print(md)

    try:
        close = getattr(protect, 'close', None)
        if close:
            if asyncio.iscoroutinefunction(close):
                await close()
            else:
                close()
    except Exception:
        pass


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('\nCancelled')
