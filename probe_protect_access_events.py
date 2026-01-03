#!/usr/bin/env python3
"""
Probe UniFi Protect for access-related events (PIN unlocks, QR scans, calls).

Usage: python3 probe_protect_access_events.py
Optional env:
  PROBE_MINUTES (default 60)
"""
import os
import asyncio
from datetime import datetime, timedelta, timezone
from pprint import pprint


async def main():
    try:
        from uiprotect import ProtectApiClient
    except Exception as e:
        print('uiprotect not available:', e)
        return

    minutes = int(os.getenv('PROBE_MINUTES', '60'))
    now = datetime.now(timezone.utc)
    start = now - timedelta(minutes=minutes)

    try:
        host = os.getenv('UNIFI_PROTECT_HOST')
        port = int(os.getenv('UNIFI_PROTECT_PORT', 443))
        username = os.getenv('UNIFI_PROTECT_USERNAME')
        password = os.getenv('UNIFI_PROTECT_PASSWORD')
        api_key = os.getenv('UNIFI_PROTECT_API_KEY')

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
            verify_ssl=os.getenv('UNIFI_PROTECT_VERIFY_SSL', 'true').lower() in ('1','true','yes'),
            api_key=api_key
        )
        await protect.update()
        print('Connected to UniFi Protect')
    except Exception as e:
        print('Failed to connect to Protect:', e)
        return

    try:
        events = await protect.get_events(start=start, limit=1000)
        print(f'Fetched {len(events)} events (since {start.isoformat()})')
    except Exception as e:
        print('Failed to fetch events:', e)
        return

    access_events = []
    keywords = ('pin', 'nfc', 'qr', 'call', 'doorlock', 'unlock', 'access')

    for ev in events:
        try:
            etype = getattr(ev, 'type', None)
            # EventType.ACCESS may be an Enum; compare string repr too
            is_access_type = (str(etype).lower().find('access') != -1) if etype else False

            md = getattr(ev, 'metadata', None)
            md_text = ''
            if md:
                try:
                    md_text = str(md.__dict__ if hasattr(md, '__dict__') else md)
                except Exception:
                    md_text = str(md)

            has_kw = any(kw in md_text.lower() for kw in keywords)

            if is_access_type or has_kw:
                access_events.append((ev, md_text))
        except Exception:
            continue

    print(f'Found {len(access_events)} access-related events in the window.')

    for ev, md_text in access_events[:20]:
        print('\n--- Event ---')
        print('id:', getattr(ev, 'id', None))
        print('type:', getattr(ev, 'type', None))
        print('start:', getattr(ev, 'start', None))
        print('camera_id:', getattr(ev, 'camera_id', None))
        print('smart_detect_types:', getattr(ev, 'smart_detect_types', None))
        print('metadata snippet:')
        print(md_text[:1000])

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


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('\nCancelled')
