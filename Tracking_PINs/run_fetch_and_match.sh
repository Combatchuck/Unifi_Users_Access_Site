#!/bin/sh
set -eu

# run_fetch_and_match.sh
# Container-friendly worker to fetch the last N hours (default 3h) and run the matcher.
# Writes data and CSV to /app/.pins_fetch and persists last_end_ms there.

STATE_DIR="${STATE_DIR:-/app/.pins_fetch}"
# ensure state dir is writable; fall back to /tmp if /app is read-only
if ! mkdir -p "$STATE_DIR" 2>/dev/null; then
  echo "Warning: cannot create $STATE_DIR (read-only); falling back to /tmp/.pins_fetch" >&2
  STATE_DIR="/tmp/.pins_fetch"
  mkdir -p "$STATE_DIR"
fi
LOCKDIR="$STATE_DIR/.pins_fetch.lock"
LAST_FILE="$STATE_DIR/last_end_ms"
OVERLAP_MS=${OVERLAP_MS:-3600000}  # 1 hour overlap
WINDOW_MS=${WINDOW_MS:-10800000}  # 3 hours default

# simple lock via mkdir
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  echo "$(date -u) - another fetch in progress, exiting"
  exit 0
fi
trap 'rm -rf "$LOCKDIR"' EXIT

NOW_MS=$(( $(date -u +%s) * 1000 ))

if [ -f "$LAST_FILE" ]; then
  LAST_END=$(cat "$LAST_FILE")
  # start from last end minus overlap (safe overlap)
  START_MS=$(( LAST_END - OVERLAP_MS ))
  END_MS=$NOW_MS
else
  START_MS=$(( NOW_MS - WINDOW_MS ))
  END_MS=$NOW_MS
fi

export START_MS
export END_MS

# run the fetch (expects /app/Tracking_PINs/fetch_window.sh)
if [ ! -x /app/Tracking_PINs/fetch_window.sh ]; then
  echo "fetch_window.sh not found or not executable at /app/Tracking_PINs/fetch_window.sh" >&2
  exit 2
fi

# run and capture fetch output into the state dir (overrideable by setting OUT env)
FETCH_OUT="$STATE_DIR/pins_window.json"
FETCH_LOG="$STATE_DIR/fetch_window.log"
# run fetch and capture stdout/stderr to log
OUT="$FETCH_OUT" /app/Tracking_PINs/fetch_window.sh >"$FETCH_LOG" 2>&1 || { echo "fetch_window.sh failed; see $FETCH_LOG" >&2; tail -n 50 "$FETCH_LOG" >&2; exit 3; }

if [ ! -f "$FETCH_OUT" ]; then
  echo "fetch did not produce $FETCH_OUT; see $FETCH_LOG" >&2
  tail -n 50 "$FETCH_LOG" >&2
  exit 3
fi

TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT_JSON="/app/.pins_fetch/pins_${TS}.json"
OUT_JSON_GZ="${OUT_JSON}.gz"
CSV_OUT="/app/.pins_fetch/tracking_report_${TS}.csv"

mv "$FETCH_OUT" "$OUT_JSON"
gzip -9 "$OUT_JSON"

# run matcher (dry-run behavior is internal; track_pins only reads file and writes CSV)
python3 /app/Tracking_PINs/track_pins.py --mode file --api-json "$OUT_JSON_GZ" --time-delta 60 --out "$CSV_OUT"

# update last_end
echo "$END_MS" > "$LAST_FILE"

# rotate: keep last 14 json.gz and csv
ls -1t /app/.pins_fetch/pins_*.json.gz 2>/dev/null | sed -e '1,14d' | xargs -r rm --
ls -1t /app/.pins_fetch/tracking_report_*.csv 2>/dev/null | sed -e '1,14d' | xargs -r rm --

echo "Completed fetch+match: ${OUT_JSON_GZ} and ${CSV_OUT}"
exit 0
