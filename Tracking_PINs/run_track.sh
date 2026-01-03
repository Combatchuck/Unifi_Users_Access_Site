#!/usr/bin/env bash
# Example wrapper to run track_pins.py after you set env vars.

# Load environment from the top-level `.env.example` (or `.env` if present)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -f "$ROOT_DIR/.env" ]; then
  # prefer real .env if present
  # shellcheck source=/dev/null
  . "$ROOT_DIR/.env"
elif [ -f "$ROOT_DIR/.env.example" ]; then
  # shellcheck source=/dev/null
  . "$ROOT_DIR/.env.example"
else
  echo "Warning: no $ROOT_DIR/.env or .env.example found; please create one with required variables" >&2
fi

API_URL="${API_URL:-}" # set in env or edit below
START="$1"
END="$2"
OUT="./Tracking_PINs/outputs/report_${START}_${END}.csv"

python3 Tracking_PINs/track_pins.py --mode api --api-url "$API_URL" --start "$START" --end "$END" --out "$OUT" --time-delta ${TIME_DELTA_SECONDS:-60}

echo "Done. See $OUT"