Tracking_PINs
==============

Purpose
-------
Collect PIN/QR usage events (from the API query you will provide), and cross‑reference them with unassigned license plate detections seen by **LPR Camera Left** during the same time window. This folder contains scripts and documentation to fetch the PIN/QR events, query MongoDB for unassigned plates, and produce a match report (CSV) — **we do not link/attach plates to users** (this is only detection and reporting).

Quick workflow
--------------
1. Provide the API query (endpoint + headers) that returns PIN/QR usage events (JSON). Put it in `sample_query.txt` or set env vars described below.
2. Run `track_pins.py --mode api --api-url <URL> --start <ISO> --end <ISO> --time-delta 60` (see usage). The script will:
   - fetch PIN/QR events from the API
   - query `license_plates` for docs where `camera_name` = "LPR Camera Left" and `user_email` is `unknown` or missing in the given time window
   - perform a simple time-based join (match plates detected within +/- `time_delta` seconds of the PIN/QR time)
   - write results to CSV and print a summary (counts & sample)

Files
-----
- `track_pins.py` - main Python tool (supports `--mode api|file`) to fetch PIN events + query Mongo and produce CSV matches.
- Top-level `.env.example` (modify `/web-portal/.env.example`) - environment variables template (MONGO connection, API headers, default time delta).
- `sample_query.txt` - paste your API query/endpoint here.
- `PROCESS.md` - describes the process and safety/backup steps.
- `run_track.sh` - example wrapper to run a typical query (edit for your API/auth).

Security & notes
----------------
- The script supports reading API headers from env (recommended) or a small JSON file.
- Use a short `time_delta` to avoid too many false matches (default: 60 seconds). Adjust as needed.
- The script **only reads** from Mongo and the API and writes a CSV report. It does not modify DB records.

Next step
---------
Please paste the API query or endpoint + auth (in `sample_query.txt` or reply here). I'll wire it into `track_pins.py` and run a test report (dry-run) or show instructions to run it locally.

Recent run (2026-01-01) ✅
--------------------------
- **Pins processed:** 25
- **Unassigned plates scanned:** 14
- **Matches found:** 75
- **Example strong match:** PIN event at **2026-01-01T20:31:35-05:00** (Triche Guest) matched plate **GFP690** (LPR Camera Left) at **2026-01-02T01:31:49.928Z** — delta **+14.928s**
- **Report artifact (CSV):** `Tracking_PINs/tracking_report_all_5m.csv`

How to reproduce
----------------
Run from inside the app container (or locally with the appropriate env vars set) and provide your API JSON or endpoint. Example commands:

```
# from file
python3 track_pins.py --mode file --api-json /path/to/pins.json --time-delta 300 --out /path/to/report.csv

# from API (POST body)
python3 track_pins.py --mode api --api-url 'https://protect/api/logs' --api-method POST \
  --api-headers '{"Authorization":"Bearer ...","content-type":"application/json"}' \
  --api-data '@body.json' --time-delta 300 --out /path/to/report.csv
```

Notes & next actions
--------------------
- The script performs **read-only** operations against the API and MongoDB and writes a CSV report only.
- Use a smaller `--time-delta` (e.g., 60) to reduce false positives; use a larger window when clocks may be skewed.
- I can re-run with a tighter window (±60s) or extract thumbnails for matched events if you'd like — tell me which and I'll run it.