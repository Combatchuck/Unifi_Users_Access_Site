#!/usr/bin/env python3
"""
Inspect UniFi Protect cameras for vehicle analytics settings and optionally enable them.

Usage:
  python inspect_enable_vehicle_analytics.py         # just inspect
  AUTO_ENABLE=yes python inspect_enable_vehicle_analytics.py   # attempt to enable

This script is conservative: it will only attempt to enable settings when AUTO_ENABLE is
set to 'yes'. It will print current camera info and any fields that look related to
vehicle analytics.
"""
import os
import asyncio
from pprint import pprint

async def main():
    try:
        from uiprotect import ProtectApiClient
    except Exception as e:
        print('uiprotect library not available:', e)
        return

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
    except Exception as e:
        print('Failed to connect to Protect:', e)
        return

    cams = getattr(protect, 'bootstrap', None) and getattr(protect.bootstrap, 'cameras', {}) or {}
    if not cams:
        print('No cameras discovered.')
        return

    print(f'Found {len(cams)} cameras')
    auto = os.getenv('AUTO_ENABLE', '').lower() == 'yes'

    for cid, cam in cams.items():
        print('\n--- Camera ---')
        print('id:', cid)
        try:
            name = getattr(cam, 'name', None)
            print('name:', name)
            # Print some candidate properties
            keys = ['lpr_settings', 'analytics', 'ai_settings', 'vehicle_detection', 'object_detection', 'smart_detect', 'model']
            info = {}
            for k in keys:
                val = getattr(cam, k, None)
                if val is not None:
                    info[k] = val
            pprint(info)

            # If AUTO_ENABLE, try to set common property names if present
            if auto:
                attempted = False
                # common property patterns and desired values
                candidates = [
                    ('lpr_settings', {'detect_vehicle_attributes': True}),
                    ('analytics', {'vehicle_attributes': True}),
                    ('ai_settings', {'vehicle_attributes_enabled': True}),
                    ('smart_detect', {'vehicleAttributes': True}),
                ]
                for attr, payload in candidates:
                    if hasattr(cam, attr):
                        print(f'Attempting to enable {attr} on camera {name}...')
                        try:
                            # Try cam.update or cam.save if available
                            updater = getattr(cam, 'update', None) or getattr(cam, 'save', None) or getattr(cam, 'set', None)
                            if updater:
                                # call updater with payload if it accepts dict
                                try:
                                    res = updater(payload)
                                    if asyncio.iscoroutine(res):
                                        await res
                                except TypeError:
                                    # fallback: try attribute assignment
                                    for k, v in payload.items():
                                        try:
                                            setattr(getattr(cam, attr), k, v)
                                        except Exception:
                                            pass
                                attempted = True
                                print('Attempted enabling', attr)
                                break
                        except Exception as e:
                            print('Enable attempt failed:', e)
                if not attempted:
                    print('No supported enable method found for camera', name)
        except Exception as e:
            print('Camera inspect error:', e)

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

    # close underlying session if any
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
