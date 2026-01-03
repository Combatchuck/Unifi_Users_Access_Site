#!/usr/bin/env bash
# Apply the license_plates collection validator.
# Edit MONGO_URI, DB and COLL if needed.

MONGO_URI="${MONGO_URI:-${MONGO_URL:-}}"
if [ -z "$MONGO_URI" ]; then
  echo "Error: MONGO_URI or MONGO_URL not set. See .env.example"
  exit 1
fi
DB="web-portal"
COLL="license_plates"

mongosh "${MONGO_URI}/${DB}" --quiet --eval "db.runCommand({ collMod: \"${COLL}\", validator: { $and: [ { camera_name: { $not: { $regex: \"Entry|Exit\", $options: \"i\" } } }, { license_plate: { $type: \"string\" } }, { license_plate: { $not: { $regex: \"^(\\\\s*|undefined|null|none|no-plate|unread|-+)\$\", $options: \"i\" } } } ] }, validationLevel: \"moderate\", validationAction: \"error\" })"

echo "Validator applied to ${DB}.${COLL} (modify the script to change rules)"