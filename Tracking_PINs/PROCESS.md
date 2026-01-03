Process for PIN-Plate Matching
==============================

Goal
----
Find events where a PIN or QR code was used and determine if there are unassigned license plate detections on **LPR Camera Left** within a configurable time window of each PIN/QR event.

High-level steps
----------------
1. **Fetch PIN/QR events** from API (or load from a saved JSON file). Each event must have a timestamp and an identifier (user/email).
2. **Query MongoDB** for license_plates where:
   - camera_name == "LPR Camera Left"
   - user_email is missing or equals 'unknown'
   - timestamp within `[start - delta, end + delta]` window
3. **Match** PIN events to plate events if plate.timestamp is within +/- `time_delta` seconds of pin.timestamp.
4. Output a CSV with columns: pin_timestamp, pin_user, plate_timestamp, plate_license_plate, plate_event_id, delta_seconds, notes.

Safety & verification
---------------------
- Always run the script in `--mode file` first with a saved API response for dry-run/testing.
- Back up any collections you plan to modify (we are not modifying right now).

Notes
-----
- Default `time_delta` = 60 sec; tune for your environment.
- Script can be run locally or on the server; ensure `.env` has correct MONGO connection or export the variables in the shell before running.

Contact
-------
If you want me to run this for a given API query now, paste the query (endpoint + headers) and the start/end time window and I’ll run a dry-run and share the CSV sample.