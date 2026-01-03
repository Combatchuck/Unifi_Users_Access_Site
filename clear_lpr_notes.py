#!/usr/bin/env python3
"""
Clear notes from LPR license plate records

This script unsets the `notes` field (and optional audit fields `notes_by`, `notes_updated_at`) from
records in the `license_plates` collection.

Usage:
  python clear_lpr_notes.py                # Dry-run: shows how many docs would be affected
  python clear_lpr_notes.py --pattern "Access code" --execute
  python clear_lpr_notes.py --all --execute  # Remove notes from ALL records

Options:
  --pattern PATTERN   Only target notes that match this regex (case-insensitive)
  --all               Target all records that have a non-null `notes` field (overrides --pattern)
  --execute           Actually perform the unset; without this the script only previews
  --limit N           Limit preview sample size (default 5)

Be cautious: this operation cannot be undone. Always run without --execute first to validate.
"""

import argparse
import re
import os
import sys
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

DEFAULT_DB = os.getenv('MONGODB_DATABASE') or os.getenv('MONGO_DB') or 'web-portal'
MONGO_URL = os.getenv('MONGO_URL') or os.getenv('MONGODB_URL')
if not MONGO_URL:
    print('Error: MONGO_URL not set. See .env.example')
    sys.exit(1)


def connect_db():
    try:
        client = MongoClient(MONGO_URL)
        db = client[DEFAULT_DB]
        return db
    except Exception as e:
        print(f"Failed to connect to MongoDB: {e}")
        sys.exit(1)


def build_filter(args):
    if args.all:
        return {'notes': {'$exists': True, '$ne': None}}
    if args.pattern:
        try:
            re.compile(args.pattern)
        except re.error as e:
            print(f"Invalid regex pattern: {e}")
            sys.exit(1)
        return {'notes': {'$regex': args.pattern, '$options': 'i'}}
    # Default: only target entries with notes
    return {'notes': {'$exists': True, '$ne': None}}


def preview(db, q, limit=5):
    coll = db['license_plates']
    cnt = coll.count_documents(q)
    print(f"Documents matching filter: {cnt}")
    if cnt == 0:
        return
    print(f"Sample documents (up to {limit}):")
    for d in coll.find(q, {'_id':1,'event_id':1,'license_plate':1,'camera_name':1,'timestamp':1,'user_email':1,'notes':1,'notes_by':1,'notes_updated_at':1}).limit(limit):
        print(d)


def execute_unset(db, q):
    coll = db['license_plates']
    update = {'$unset': {'notes': '', 'notes_by': '', 'notes_updated_at': ''}}
    result = coll.update_many(q, update)
    print(f"Modified {result.modified_count} documents (notes cleared)")


def main():
    parser = argparse.ArgumentParser(description='Clear notes from license_plates collection')
    parser.add_argument('--pattern', '-p', help='Regex pattern to match notes (case-insensitive)')
    parser.add_argument('--all', action='store_true', help='Target all records that have notes (overrides --pattern)')
    parser.add_argument('--execute', action='store_true', help='Perform deletion; without this the script only previews')
    parser.add_argument('--limit', type=int, default=5, help='Sample size for preview')

    args = parser.parse_args()

    db = connect_db()
    q = build_filter(args)

    print(f"Connected to DB: {DEFAULT_DB}")
    print(f"Filter: {q}")

    preview(db, q, limit=args.limit)

    if not args.execute:
        print('\nDry-run complete. To actually clear notes, re-run with --execute')
        return

    confirm = input('\nAre you SURE you want to clear these notes? Type YES to confirm: ')
    if confirm != 'YES':
        print('Aborting. No changes made.')
        return

    execute_unset(db, q)
    print('Done.')


if __name__ == '__main__':
    main()
