#!/usr/bin/env bash
# Monitor license_plate write errors (last 24h) and print summary
MONGO_URI="${MONGO_URI:-${MONGO_URL:-}}"
DB="${DB:-web-portal}"
if [ -z "$MONGO_URI" ]; then
  echo "Error: MONGO_URI or MONGO_URL not set. See .env.example"
  exit 1
fi

echo "Write errors in last 24 hours:"
mongosh "${MONGO_URI}/${DB}" --quiet --eval 'var since = new Date(Date.now()-24*3600*1000); printjson(db.license_plate_write_errors.countDocuments({timestamp:{$gte: since}})); printjson(db.license_plate_write_errors.find({timestamp:{$gte: since}}).sort({timestamp:-1}).limit(20).toArray());'
