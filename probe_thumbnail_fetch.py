#!/usr/bin/env python3
"""
Probe fetching thumbnail bytes for one recent UniFi Protect event.
Prints available fetch methods, returned value types, and lengths (if bytes).

Usage:
  python3 probe_thumbnail_fetch.py
Optional env:
  PROBE_MINUTES - minutes to look back for events (default 60)
"""
import os
import asyncio
from datetime import datetime, timedelta, timezone
from pprint import pprint


async def main():
    try:
        from uiprotect import ProtectApiClient
    except Exception as e:
        print('uiprotect library not available:', e)
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
        events = await protect.get_events(start=start, limit=500)
        print(f'Fetched {len(events)} events (since {start.isoformat()})')
    except Exception as e:
        print('Failed to fetch events:', e)
        events = []

    target_event = None
    target_thumb = None
    for ev in events:
        md = getattr(ev, 'metadata', None)
        thumbs = getattr(md, 'detected_thumbnails', None) if md else None
        if thumbs:
            for t in thumbs:
                # pick first vehicle thumbnail entry
                if getattr(t, 'type', None) == 'vehicle':
                    target_event = ev
                    target_thumb = t
                    break
        if target_event:
            break

    if not target_event:
        print('No recent event with detected_thumbnails found in window.')
        await _close_protect(protect)
        return

    print('\nSelected Event ID:', getattr(target_event, 'id', '<no-id>'))
    print('Camera ID:', getattr(target_event, 'camera_id', None))
    print('Start:', getattr(target_event, 'start', None))
    print('\nThumbnail metadata:')
    try:
        pprint(target_thumb.__dict__ if hasattr(target_thumb, '__dict__') else target_thumb)
    except Exception:
        pprint(target_thumb)

    cropped_id = getattr(target_thumb, 'cropped_id', None) or getattr(target_thumb, 'object_id', None)
    print('\ncropped_id:', cropped_id)

    fetch_methods = ['get_thumbnail', 'get_thumbnail_bytes', 'get_cropped_thumbnail', 'get_snapshot', 'get_cropped_snapshot', 'get_raw_thumbnail']

    found_any = False
    for m in fetch_methods:
        fn = getattr(protect, m, None)
        if not fn or not callable(fn):
            print(f'Method {m}: not available')
            continue

        print(f'\nTrying method: {m}()')
        try:
            # try several calling patterns
            trial_args = [ (cropped_id,), (getattr(target_event, 'id', None), cropped_id), (getattr(target_event, 'id', None),) ]
            data = None
            for args in trial_args:
                try:
                    res = fn(*[a for a in args if a is not None])
                    if asyncio.iscoroutine(res):
                        data = await res
                    else:
                        data = res
                except TypeError:
                    # wrong signature, try next pattern
                    data = None
                except Exception as e:
                    print(f'  call raised: {e}')
                    data = None
                if data:
                    break

            if data is None:
                print('  Returned: None or empty')
                continue

            found_any = True
            print('  Returned type:', type(data))

            # bytes-like
            if isinstance(data, (bytes, bytearray)):
                print('  Bytes length:', len(data))
                continue

            # aiohttp response-like
            try:
                content = None
                if hasattr(data, 'content') and isinstance(getattr(data, 'content'), (bytes, bytearray)):
                    content = data.content
                elif hasattr(data, 'read'):
                    # may be coroutine or sync
                    read = getattr(data, 'read')
                    if asyncio.iscoroutinefunction(read):
                        content = await read()
                    else:
                        try:
                            content = read()
                        except Exception:
                            pass

                if content is not None:
                    print('  Content length:', len(content))
                    continue
            except Exception as e:
                print('  Error reading response content:', e)

            # fallback: try bytes() conversion
            try:
                b = bytes(data)
                print('  bytes() length:', len(b))
                continue
            except Exception:
                pass

            print('  Could not determine length for returned object')

        except Exception as e:
            print('  Error calling method:', e)

    if not found_any:
        print('\nNo thumbnail fetch methods returned data for this thumbnail.')

    await _close_protect(protect)


async def _close_protect(protect):
    try:
        close = getattr(protect, 'close', None)
        if close:
            if asyncio.iscoroutinefunction(close):
                await close()
            else:
                close()
    except Exception:
        pass

    # attempt to close underlying sessions
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


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('\nCancelled')
