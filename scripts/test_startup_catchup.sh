#!/usr/bin/env bash
set -eu

# Simple integration test: run a short catchup then start fast capture briefly and check logs for Mongo validation errors.
# Usage: ./scripts/test_startup_catchup.sh [CATCHUP_HOURS] (default: 1)

CATCHUP_HOURS=${1:-1}
LOGDIR=${LOGDIR:-/tmp/lpr_startup_test}
mkdir -p "$LOGDIR"
BACKFILL_LOG="$LOGDIR/backfill.log"
CAPTURE_LOG="$LOGDIR/fast_capture.log"

echo "Running backfill for ${CATCHUP_HOURS} hour(s) (this uses real Protect/Mongo). Output -> $BACKFILL_LOG"
python3 ./backfill_protect_hours.py "$CATCHUP_HOURS" > "$BACKFILL_LOG" 2>&1 || true

# Start fast capture for a short duration (20s)
echo "Starting fast capture for 20s. Output -> $CAPTURE_LOG"
python3 ./fast_lpr_capture.py 20 > "$CAPTURE_LOG" 2>&1 || true

# Inspect logs for validation or write errors
if grep -E "Document failed validation|Mongo write failed|Write error for event|license_plate write errors" "$BACKFILL_LOG" "$CAPTURE_LOG" 2>/dev/null; then
  echo "FOUND validation/write errors in logs"
  echo "--- tail of $BACKFILL_LOG ---"
  tail -n 200 "$BACKFILL_LOG" || true
  echo "--- tail of $CAPTURE_LOG ---"
  tail -n 200 "$CAPTURE_LOG" || true
  exit 1
else
  echo "OK: No validation/write errors found in logs"
  exit 0
fi
