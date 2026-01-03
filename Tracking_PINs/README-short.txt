Short usage:
1) Paste API query with endpoint & headers in `sample_query.txt` or set `API_URL` and `API_HEADERS_JSON` in `.env`.
2) Run example: ./Tracking_PINs/track_pins.py --mode api --api-url "<URL>" --start 2026-01-01T00:00:00Z --end 2026-01-01T23:59:59Z --out ./Tracking_PINs/outputs/report.csv
3) Inspect CSV for any plate events near the PIN usage times (we only report, do not link).