#!/usr/bin/env python3
"""Shared helpers for LPR producers: camera filters and plate sanitization"""

import os
import re


def get_camera_filters():
    """Return (allowed_ids_set, allowed_names_list, skip_subs_list) based on env vars."""
    allowed_ids = {s.strip() for s in os.getenv('LPR_CAMERA_IDS', '').split(',') if s.strip()}
    allowed_names = [s.strip() for s in os.getenv('LPR_CAMERA_NAMES', '').split(',') if s.strip()]
    skip_subs = [s.strip().lower() for s in os.getenv('LPR_SKIP_CAMERA_SUBSTRINGS', 'Entry,Exit,Kiosk').split(',') if s.strip()]
    return allowed_ids, allowed_names, skip_subs


def should_skip_camera(camera_name, camera_id):
    """Return (skip:bool, reason:str).

    Logic mirrors other producers: if allowed IDs are set, only those IDs are allowed;
    if allowed names are set, camera_name must contain one of them; otherwise, skip
    when camera_name matches common non-LPR substrings (entry/exit/kiosk).
    """
    allowed_ids, allowed_names, skip_subs = get_camera_filters()
    cam = (camera_name or '')

    if allowed_ids and camera_id and camera_id not in allowed_ids:
        return True, f"camera_id {camera_id} not in LPR_CAMERA_IDS"
    if allowed_names and not any(sub in cam for sub in allowed_names):
        return True, f"camera_name '{cam}' not matching LPR_CAMERA_NAMES"
    if not allowed_ids and not allowed_names and any(sub in cam.lower() for sub in skip_subs):
        return True, f"camera_name '{cam}' matches skip substrings {skip_subs}"
    return False, ''


def sanitize_plate(p):
    """Return normalized plate string (uppercase, stripped non-alnum/-), or None if placeholder/invalid."""
    if not p:
        return None
    s = str(p).strip().upper()
    if not s or s.lower() in ('undefined', 'none', 'null', 'no-plate', 'unread'):
        return None
    s = re.sub(r'[^A-Z0-9-]', '', s)
    return s if len(s) >= 2 else None


__all__ = ['get_camera_filters', 'should_skip_camera', 'sanitize_plate']
