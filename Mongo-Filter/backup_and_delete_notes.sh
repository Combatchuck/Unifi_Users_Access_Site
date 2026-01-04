#!/usr/bin/env bash
# Backup all documents with 'notes' and then delete them from the main collection.
# Usage: ./backup_and_delete_notes.sh

MONGO_URI="${MONGO_URI:-${MONGO_URL:-}}"
if [ -z "$MONGO_URI" ]; then
  echo "Error: MONGO_URI or MONGO_URL not set. See .env.example"
  exit 1
fi
DB="web-portal"
COLL="license_plates"
BACKUP_COLL="${COLL}_backups_notes_$(date +%Y%m%d)"

echo "Backing up docs with notes to ${BACKUP_COLL}..."
mongosh "${MONGO_URI}/${DB}" --quiet --eval "db.${COLL}.aggregate([ { \$match: { notes: { \$exists: true } } }, { \$out: \"${BACKUP_COLL}\" } ])"

COUNT=$(mongosh "${MONGO_URI}/${DB}" --quiet --eval "db.${BACKUP_COLL}.countDocuments()")

echo "Backup complete. ${COUNT} docs written to ${BACKUP_COLL}."

echo "Deleting original docs with notes (this is irreversible)..."
mongosh "${MONGO_URI}/${DB}" --quiet --eval "var r=db.${COLL}.deleteMany({ notes: { \$exists: true } }); printjson(r)"

echo "Deletion complete. Remaining docs in ${COLL}:"
mongosh "${MONGO_URI}/${DB}" --quiet --eval "print(db.${COLL}.countDocuments())"

echo "Backup collection retained as ${BACKUP_COLL} (delete it manually when safe)."