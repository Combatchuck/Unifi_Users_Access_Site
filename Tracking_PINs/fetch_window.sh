#!/bin/sh
set -eu

# fetch_window.sh
# Fetch Protect logs for a provided window (START_MS/END_MS env), defaulting to last 3 hours.
# Writes combined results to /tmp/pins_window.json

TMPDIR="$(mktemp -d)"
OUT="${OUT:-$TMPDIR/pins_window.json}"
PAGE_SIZE=500
page=0

echo "Writing fetch output to: $OUT"

# Load env from /app/.env if present
if [ -f /app/.env ]; then
  # shellcheck source=/dev/null
  set -a
  . /app/.env
  set +a
fi

# accept alternate token name
if [ -z "${UNIFA_BEARER:-}" ] && [ -n "${UNIFA_BEARER_TOKEN:-}" ]; then
  UNIFA_BEARER="$UNIFA_BEARER_TOKEN"
fi

# Prefer API_URL (if set) or fall back to UNIFA_API_URL; this allows a single canonical value to be used.
PROTECT_API_URL="${API_URL:-${UNIFA_API_URL:-}}"

if [ -z "${PROTECT_API_URL:-}" ] || [ -z "${UNIFA_BEARER:-}" ]; then
  echo "ERROR: API URL (PROTECT_API_URL) or UNIFA_BEARER not set in environment or /app/.env" >&2
  exit 2
fi

# compute start and end ms (allow overrides via START_MS and END_MS env vars)
END_MS=${END_MS:-$(($(date -u +%s) * 1000))}
START_MS=${START_MS:-$((END_MS - 3*3600*1000))}

echo "Fetch window: ${START_MS} -> ${END_MS} (ms)"

# start with empty array
printf '[]' > "$OUT"

while : ; do
  echo "Requesting page $page"
  BODY=$(jq -n --argjson start $START_MS --argjson end $END_MS --argjson page $page --argjson size $PAGE_SIZE '{startTimeMs: $start, endTimeMs: $end, pageNum: $page, pageSize: $size}')

  curl -s -X POST "$UNIFA_API_URL/logs" \
    -H "Authorization: Bearer $UNIFA_BEARER" \
    -H 'Content-Type: application/json' \
    -d "$BODY" -k > "$TMPDIR/page_$page.json" || { echo "curl failed" >&2; rm -rf "$TMPDIR"; exit 3; }

  if [ ! -s "$TMPDIR/page_$page.json" ]; then
    echo "Empty response, stopping"
    break
  fi

  # extract hits list
  if jq -e '.hits' "$TMPDIR/page_$page.json" >/dev/null 2>&1; then
    count=$(jq '.hits | length' "$TMPDIR/page_$page.json")
    if [ "$count" -eq 0 ]; then
      echo "No hits on page $page, stopping"
      break
    fi
    jq '.hits' "$TMPDIR/page_$page.json" > "$TMPDIR/hits_$page.json"
  elif jq -e 'type=="array"' "$TMPDIR/page_$page.json" >/dev/null 2>&1; then
    count=$(jq 'length' "$TMPDIR/page_$page.json")
    if [ "$count" -eq 0 ]; then
      echo "No items on page $page, stopping"
      break
    fi
    jq '.' "$TMPDIR/page_$page.json" > "$TMPDIR/hits_$page.json"
  elif jq -e '.data? | arrays' "$TMPDIR/page_$page.json" >/dev/null 2>&1 || jq -e '.results? | arrays' "$TMPDIR/page_$page.json" >/dev/null 2>&1 || jq -e '.events? | arrays' "$TMPDIR/page_$page.json" >/dev/null 2>&1 || jq -e '.items? | arrays' "$TMPDIR/page_$page.json" >/dev/null 2>&1; then
    jq '(.data // .results // .events // .items)' "$TMPDIR/page_$page.json" > "$TMPDIR/hits_$page.json"
    count=$(jq 'length' "$TMPDIR/hits_$page.json")
    if [ "$count" -eq 0 ]; then break; fi
  else
    echo "No hits or array found on page $page, stopping"
    break
  fi

  echo "  adding $count hits"
  jq -s '[ .[] | (if type=="array" then .[] else . end) ]' "$OUT" "$TMPDIR/hits_$page.json" > "$TMPDIR/merged.json" && mv "$TMPDIR/merged.json" "$OUT"

  page=$((page+1))
  sleep 0.1
done

if [ -f "$OUT" ]; then
  echo "Done. Output: $OUT (contains $(jq 'length' "$OUT") items)"
else
  echo "No output produced"
fi

rm -rf "$TMPDIR"
exit 0
