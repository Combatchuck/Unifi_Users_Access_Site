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

# Prefer protect/unifa settings when API_URL is not explicitly set
if [ -z "${API_URL:-}" ] && [ -n "${UNIFA_API_URL:-}" ]; then
  API_URL="$UNIFA_API_URL"
fi

# If API_HEADERS_JSON is not set, but a bearer token exists, build an Authorization header
if [ -z "${API_HEADERS_JSON:-}" ]; then
  if [ -n "${UNIFA_BEARER_TOKEN:-}" ]; then
    API_HEADERS_JSON="{\"Authorization\":\"Bearer ${UNIFA_BEARER_TOKEN}\"}"
  elif [ -n "${UNIFA_BEARER:-}" ]; then
    API_HEADERS_JSON="{\"Authorization\":\"Bearer ${UNIFA_BEARER}\"}"
  fi
fi

START="$1"
END="$2"
OUT="./Tracking_PINs/outputs/report_${START}_${END}.csv"

# Build arguments and include headers if provided
API_ARGS=(--mode api --api-url "$API_URL" --start "$START" --end "$END" --out "$OUT" --time-delta ${TIME_DELTA_SECONDS:-60})
if [ -n "${API_HEADERS_JSON:-}" ]; then
  API_ARGS+=(--api-headers "$API_HEADERS_JSON")
fi

python3 Tracking_PINs/track_pins.py "${API_ARGS[@]}"

echo "Done. See $OUT"