#!/usr/bin/env python3
"""Remove or list audit log entries with action 'CODE_SENT' for admin emails.

Usage:
  # Dry-run: list matching documents and count
  python scripts/remove_admin_code_sent_audit_logs.py --dry-run

  # Actually delete (requires --delete and confirmation or FORCE=1)
  python scripts/remove_admin_code_sent_audit_logs.py --delete

Notes:
- Reads ADMIN_EMAILS from environment (comma-separated).
- Connects to MongoDB using MONGODB_HOST, MONGODB_PORT, MONGODB_DATABASE (defaults used if missing).
"""

import os
import sys
import argparse
from pymongo import MongoClient
from pprint import pprint
import re


def parse_args():
    p = argparse.ArgumentParser(description='List or delete CODE_SENT audit logs for admin emails')
    p.add_argument('--dry-run', action='store_true', help='Only list matching documents, do not delete')
    p.add_argument('--delete', action='store_true', help='Delete matching documents (requires FORCE=1 or interactive confirmation)')
    p.add_argument('--limit', type=int, default=20, help='Number of sample documents to print')
    return p.parse_args()


def get_admin_emails():
    raw = os.getenv('ADMIN_EMAILS', '')
    emails = [e.strip() for e in raw.split(',') if e.strip()]
    return emails


def make_filter(admin_emails):
    # Build a case-insensitive anchored regex for each admin email
    or_clauses = []
    for email in admin_emails:
        regex = re.compile(r'^' + re.escape(email) + r'$', re.IGNORECASE)
        or_clauses.append({'email': {'$regex': regex}})
    if not or_clauses:
        # match nothing
        return {'_id': {'$exists': False}}
    return {'$and': [{'action': 'CODE_SENT'}, {'$or': or_clauses}]}


def main():
    args = parse_args()
    admin_emails = get_admin_emails()
    if not admin_emails:
        print('No ADMIN_EMAILS configured in environment; nothing to do.')
        sys.exit(0)

    # Prefer a full MONGO_URL. If absent, require MONGODB_HOST and optional MONGODB_PORT.
    mongo_url = os.getenv('MONGO_URL')
    mongo_db = os.getenv('MONGODB_DATABASE', 'web-portal')
    if mongo_url:
        client = MongoClient(mongo_url)
        db = client[mongo_db]
    else:
        mongo_host = os.getenv('MONGODB_HOST')
        if not mongo_host:
            print('Error: MONGO_URL or MONGODB_HOST must be set. See .env.example')
            sys.exit(1)
        mongo_port = os.getenv('MONGODB_PORT', '27017')
        client = MongoClient(f"{mongo_host}:{mongo_port}")
        db = client[mongo_db]
    audit = db['audit_logs']

    filter_q = make_filter(admin_emails)

    count = audit.count_documents(filter_q)
    print(f"Found {count} audit log(s) with action 'CODE_SENT' for admin emails: {', '.join(admin_emails)}")

    if count > 0:
        print('\nSample documents:')
        for doc in audit.find(filter_q).limit(args.limit):
            # Print concise summary
            print(f"- _id: {doc.get('_id')} timestamp: {doc.get('timestamp')} email: {doc.get('email')} action: {doc.get('action')}")

    if args.dry_run or count == 0:
        print('\nDry-run mode; no deletions performed.')
        return

    if args.delete:
        force = os.getenv('FORCE', '0') == '1'
        if not force:
            ans = input(f"Are you sure you want to DELETE these {count} documents? Type 'yes' to confirm: ")
            if ans.strip().lower() != 'yes':
                print('Aborted by user; no deletions performed.')
                return
        res = audit.delete_many(filter_q)
        print(f"Deleted {res.deleted_count} documents from audit_logs")
    else:
        print('\nNo --delete flag provided; no deletions performed.')


if __name__ == '__main__':
    main()
