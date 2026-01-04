#!/usr/bin/env bash
# Quick test: try inserting a placeholder plate to verify validator rejects it.

MONGO_URI="${MONGO_URI:-${MONGO_URL:-}}"
if [ -z "$MONGO_URI" ]; then
  echo "Error: MONGO_URI or MONGO_URL not set. See .env.example"
  exit 1
fi
DB="web-portal"

echo "Attempting to insert a rejected document (placeholder plate) (should error)..."
mongosh "${MONGO_URI}/${DB}" --quiet --eval 'try { db.license_plates.insertOne({ camera_name: "LPR Camera Left", license_plate: "undefined", timestamp: new Date() }); print("INSERTED") } catch (e) { print("ERROR: "+e) }'

echo "Attempting to insert a rejected document (missing license_plate) (should error)..."
mongosh "${MONGO_URI}/${DB}" --quiet --eval 'try { db.license_plates.insertOne({ camera_name: "LPR Camera Left", timestamp: new Date() }); print("INSERTED") } catch (e) { print("ERROR: "+e) }'

echo "Now try inserting a valid document (should succeed)"
mongosh "${MONGO_URI}/${DB}" --quiet --eval 'try { var r=db.license_plates.insertOne({ camera_name:"LPR Camera Left", camera_id:"67c79bf801963d03e4000402", license_plate:"EXAMPLE_PLATE", timestamp:new Date() }); printjson(r) } catch (e) { print("ERROR: "+e) }'