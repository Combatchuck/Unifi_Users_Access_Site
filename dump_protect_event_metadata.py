#!/usr/bin/env python3
"""
Dump a recent UniFi Protect event's raw metadata for inspection.
Prints the first event in the last N minutes that has metadata or detected_thumbnails.
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

    minutes = int(os.getenv('DUMP_MINUTES', '60'))
    now = datetime.now(timezone.utc)
    start = now - timedelta(minutes=minutes)

    try:
        # Load local .env if present
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

    found = False
    for ev in events:
        try:
            md = getattr(ev, 'metadata', None)
            thumbs = getattr(md, 'detected_thumbnails', None) if md else None
            vehicle = getattr(ev, 'vehicle', None) or (md and getattr(md, 'vehicle', None)) or getattr(ev, 'vehicle_data', None)
            if md or thumbs or vehicle:
                print('\n--- Event ID:', getattr(ev, 'id', '<no-id>'))
                print('camera_id:', getattr(ev, 'camera_id', None))
                print('start:', getattr(ev, 'start', None))
                print('\n--- metadata (repr) ---')
                try:
                    pprint(md.__dict__ if hasattr(md, '__dict__') else md)
                except Exception:
                    pprint(md)

                print('\n--- detected_thumbnails ---')
                try:
                    if thumbs:
                        for t in thumbs:
                            try:
                                pprint(t.__dict__ if hasattr(t, '__dict__') else t)
                            except Exception:
                                pprint(t)
                    else:
                        print('None')
                except Exception as e:
                    print('Error printing thumbnails:', e)

                print('\n--- vehicle / vehicle_data ---')
                try:
                    pprint(vehicle.__dict__ if hasattr(vehicle, '__dict__') else vehicle)
                except Exception:
                    pprint(vehicle)

                found = True
                break
        except Exception as e:
            print('Error inspecting event:', e)

    if not found:
        print('No events with metadata/vehicle info found in the window.')

    try:
        close = getattr(protect, 'close', None)
        if close:
            if asyncio.iscoroutinefunction(close):
                await close()
            else:
                close()
    except Exception:
        pass

    # Explicitly close underlying aiohttp session if present
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
