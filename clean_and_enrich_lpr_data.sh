#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# Run from script directory (assume repo root)
cd "$(dirname "$0")"

# Check that python3 is available
if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 not found on PATH. Install Python 3 or adjust PATH and re-run." >&2
  exit 1
fi

echo "===== STEP 1: Cleaning LPR MongoDB collection ====="
python3 clean_lpr_mongodb.py

echo
echo "===== STEP 2: Enriching LPR records with missing information ====="
python3 enrich_lpr_records.py

echo
echo "===== COMPLETE: LPR data cleanup finished ====="