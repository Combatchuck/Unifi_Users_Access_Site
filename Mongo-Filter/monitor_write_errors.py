#!/usr/bin/env python3
"""Monitor license_plate_write_errors and email admins if any errors found.

Usage:
  ./monitor_write_errors.py --minutes 60
"""
import os
import sys
import json
import argparse
import smtplib
from email.message import EmailMessage
from datetime import datetime, timedelta
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

MONGO_URL = os.getenv('MONGO_URL')
if not MONGO_URL:
    mongodb_host = os.getenv('MONGODB_HOST')
    mongodb_port = os.getenv('MONGODB_PORT','27017')
    if not mongodb_host:
        print('Error: MONGO_URL or MONGODB_HOST must be set. See .env.example')
        sys.exit(1)
    MONGO_URL = f"{mongodb_host}:{mongodb_port}"
DB = os.getenv('MONGODB_DATABASE','web-portal')
ADMIN_EMAILS = [e.strip() for e in (os.getenv('ADMIN_EMAILS') or '').split(',') if e.strip()]
EMAIL_HOST = os.getenv('EMAIL_HOST')
EMAIL_PORT = int(os.getenv('EMAIL_PORT') or 587)
EMAIL_USER = os.getenv('EMAIL_USER')
EMAIL_PASS = (os.getenv('EMAIL_PASS') or '').strip('"\'')
EMAIL_FROM = os.getenv('EMAIL_FROM') or EMAIL_USER

parser = argparse.ArgumentParser()
parser.add_argument('--minutes', type=int, default=15, help='Time window in minutes to look back')
parser.add_argument('--threshold', type=int, default=1, help='Minimum number of errors to trigger alert')
args = parser.parse_args()

since = datetime.utcnow() - timedelta(minutes=args.minutes)

client = MongoClient(MONGO_URL)
db = client[DB]
col = db.get_collection('license_plate_write_errors')
count = col.count_documents({'timestamp': {'$gte': since}})
print(f"Write errors in last {args.minutes} minutes: {count}")

if count >= args.threshold and ADMIN_EMAILS and EMAIL_HOST and EMAIL_USER and EMAIL_PASS:
    samples = list(col.find({'timestamp': {'$gte': since}}).sort('timestamp', -1).limit(20))
    body = []
    body.append(f"Found {count} license_plate write errors in the last {args.minutes} minutes (since {since.isoformat()} UTC)\n")
    body.append('\nRecent samples (up to 20):\n')
    for s in samples:
        s.pop('_id', None)
        # stringify timestamp
        if 'timestamp' in s and hasattr(s['timestamp'], 'isoformat'):
            s['timestamp'] = s['timestamp'].isoformat()
        body.append(json.dumps(s, default=str))
    body_text = '\n'.join(body)

    msg = EmailMessage()
    msg['Subject'] = f"[ALERT] LPR write errors: {count} in last {args.minutes}m"
    msg['From'] = EMAIL_FROM
    msg['To'] = ','.join(ADMIN_EMAILS)
    msg.set_content(body_text)

    try:
        with smtplib.SMTP(EMAIL_HOST, EMAIL_PORT, timeout=30) as smtp:
            smtp.ehlo()
            if EMAIL_PORT != 25 and EMAIL_PORT != 465:
                smtp.starttls()
            smtp.login(EMAIL_USER, EMAIL_PASS)
            smtp.send_message(msg)
        print(f"Alert emailed to: {', '.join(ADMIN_EMAILS)}")
    except Exception as e:
        print(f"Failed to send alert email: {e}")
else:
    if count >= args.threshold:
        print('Cannot send email: missing ADMIN_EMAILS or email configuration.')

client.close()
