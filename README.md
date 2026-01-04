# Web Portal
This repository contains the Web Portal used to simplify and centralize administration of Access and User-related tasks (PINs, Invites, License Plates, Sessions, and system health). It was created to remove the burden of manually handling repetitive administrative work and to provide clear operational visibility for site admins.

---

## Quick Overview ✅
- Purpose: Let site admins manage users, reset PINs, send Identity invites, add/remove license plates, and monitor system health from a single dashboard.
- Interfaces included:
  - **User-facing flows** (email sign-in + verification, user dashboard, visitor dashboard)
  - **Admin Dashboard** (health, security, sessions, audit log, license plate metrics)
  - **LPR (License Plate Recognition) Dashboard** for querying captured plate data

---

## Authentication Flow 🔐
1. User enters their email on the site.
2. The site sends a verification code to the email address.
3. The user enters the code to verify.

These steps produce a session and then the site shows the appropriate dashboards (User -> Visitor flows).

<p align="center">
  <img src="Pictures/Enter%20Email.png" alt="Enter Email" width="360" />
  <img src="Pictures/Enter%20Code.png" alt="Enter Code" width="360" />
</p>
*Top: Enter Email — Bottom: Enter Code — users verify via code to sign in.

---

## User & Visitor Dashboards
- **User Dashboard:** shows the user-specific controls and status. The site will display the user's profile avatar if one exists; otherwise the fallback image `Avatars/default.png` is used.

<p align="center">
  <img src="Pictures/User%20Dash.png" alt="User Dashboard" width="800" />
</p>
*User Dashboard — personal settings, plates, PINs, invites.*

- **Visitor Dashboard:** shows visitor-specific controls and added visitor plates and management.

<p align="center">
  <img src="Pictures/Visitor%20Dash.png" alt="Visitor Dashboard" width="800" />
</p>
*Visitor Dashboard — guest plates and visit details.*

**Environment customization:** You can customize certain UI elements via `.env`:
- `SITE_NAME` — set the display name for your site (defaults to "User Access Portal").
- `INVITE_SITE_COUNT` — number of invite buttons shown (1 or 2, defaults to 2).
- `INVITE_SITE1_NAME`, `INVITE_SITE2_NAME` — labels for each invite destination.
See `.env.example` for defaults and examples.

---

## Admin Dashboard 🔧
The admin UI is at `public/admin.html` and includes (screenshots below):

<p align="center">
  <img src="Pictures/Admin%201.png" alt="Admin 1" width="320" />
  <img src="Pictures/Admin%202.png" alt="Admin 2" width="320" />
  <img src="Pictures/Admin%203.png" alt="Admin 3" width="320" />
</p>
<p align="center">
  <img src="Pictures/Admin%204.png" alt="Admin 4" width="320" />
  <img src="Pictures/Admin%205.png" alt="Admin 5" width="320" />
</p>
*Admin screenshots: Overview, Metrics, Sessions, Audit Log, License Plates.*

- System status badge and manual refresh controls
- Main metrics and charts (API health, trends, error rates)
- Security & failed login monitoring (summary, anomalies, timeline)
- Performance analytics (requests, latency, P95/P99)
- System health & uptime details
- Database monitoring (DB status, active connections, query performance)
- Session management (search by email/IP, revoke individual sessions, **Revoke All Sessions**)
- User activity and top actions reporting
- License Plate metrics (total, added/removed today)
- PIN management summary (changes today)
- Visitor management (active visitors, expiring soon)
- Authentication health (failed logins, invalid email attempts)
- Invitations metrics (pending, sent, accepted)
- Top users and top actions (last 7 days)
- Audit log with filters by email/action/time range and a live list of events

Admin features are driven by `admin.js` and display interactive charts and tables with refresh buttons and tabs for different views.

---

## LPR (License Plate Recognition) Dashboard 🚗
- The LPR UI is at `public/lpr-dashboard.html` and provides a query UI for captured LPR data.

<p align="center">
  <img src="Pictures/LRP%20Query.png" alt="LPR Query" width="900" />
</p>
*LPR Query — search plates, filter by camera, confidence, date, and add notes to results.*<br>
<br>
**Features:**<br>
Search by plate, user name, email, camera, vehicle color, vehicle type, confidence, and date/time range<br>
Metrics panel and results table with pagination<br>
Per-result notes with save support<br>
Filters and quick actions for "identified" vs "unidentified" plates<br>
**Configuration:** `SHOW_LPR_DATA=YES|NO` in `.env` controls whether LPR functionality and links are exposed in the public UI (default: `YES`). When set to `NO`, the public site will remove LPR-specific elements (LPR tiles on Home, per-plate last-seen and counts, and the "🚗 LPR Query" nav link) and attempts to access `/lpr-dashboard.html` will return 404/not-available. Admin dashboards and LPR-related backend APIs remain accessible to authorized users. See `.env.example` for the default value.

---

## Typical Admin Actions
- Reset a user PIN
- Send a new Identity invite
- Add / remove license plates for users or visitors
- Revoke sessions or revoke all sessions for an email
- Inspect failed login anomalies and lock down suspicious IPs
- Review audit logs and export or search by action type

---

## Where to look in the codebase 🔎
- `public/admin.html` — Admin UI markup & layout
- `public/admin.js` — Admin UI client logic and API calls
- `public/lpr-dashboard.html` — LPR query UI
- `public/header.js` — Nav and LPR link logic (controlled by `SHOW_LPR_DATA`)
- `Pictures/` — UI screenshots used in this README (Enter Email, Enter Code, User Dash, Visitor Dash, Admin 1–5, LRP Query)

- `Install Instructions/` — Installation notes, Docker compose examples and templates (see `Install Instructions/README.md`, `docker-compose.yml`, `lpr-capture-compose.yml`) 📦
- `public/avatars/` — Avatar images (see avatar cache/download logic in `index.js`) 🖼️
- `public/lpr-dashboard.html` + `index.js` — LPR Dashboard UI and APIs: `GET /api/lpr/search` (advanced search + filters), `GET /api/license-plates`, `GET /api/license-plates/search/:plate` (results, pagination, and detection objects) 🚗
- `index.js` + `public/script.js` — Users & Visitors sync: `fetchAndCacheData()` (every 30 minutes) persisted to `users_cache`, and per-user visitors via `/api/visitors` cached in `visitors_cache` (client refresh behavior in `public/script.js`) ✅
- `Mongo-Filter/` — Collection validator docs and scripts to apply/modify validators to `web-portal.license_plates` (see `Mongo-Filter/README.md`, `apply_validator.sh`) 🔒

## Scripts 📜

Below are the repository scripts grouped by function — each group is separated for clarity. Use the file link to open the script for full options and flags.

### Invites & Visitor Management

| Script | Path | Quick usage / note |
|---|---|---|
| send_invite.sh | `send_invite.sh` | `./send_invite.sh "user@example.com"` (send invite via primary site script)
| send_invite_site2.sh | `send_invite_site2.sh` | `./send_invite_site2.sh "user@example.com"` (secondary site)
| get_user_name.sh | `get_user_name.sh` | `./get_user_name.sh user@example.com` (lookup user)
| get_managed_users.sh | `get_managed_users.sh` | `./get_managed_users.sh` (fetch managed users)

<br/>

### License Plate Management

| Script | Path | Quick usage / note |
|---|---|---|
| add_license_plate.sh | `add_license_plate.sh` | `./add_license_plate.sh "user@example.com" "ABC123"` (add a plate)
| add_license_plate_site2.sh | `add_license_plate_site2.sh` | same for Site2
| remove_license_plate.sh | `remove_license_plate.sh` | `./remove_license_plate.sh "user@example.com" "ABC123"` (remove plate)
| remove_license_plate_site2.sh | `remove_license_plate_site2.sh` | same for Site2
| get_license_plates.sh | `get_license_plates.sh` | `./get_license_plates.sh` (fetch upstream plates)
| force_delete_visitor.sh / force_delete_visitor_plate.sh | `force_delete_visitor.sh` | `./force_delete_visitor.sh <visitor_id>` / `./force_delete_visitor_plate.sh <visitor_id> "ABC123"`

<br/>

### Maintenance & Data Enrichment (Python)

| Script | Path | Quick usage / note |
|---|---|---|
| search_protect_qr.py | `search_protect_qr.py` | `python3 search_protect_qr.py --help` (search QR/PIN events)
| probe_thumbnail_fetch.py | `probe_thumbnail_fetch.py` | `python3 probe_thumbnail_fetch.py --since 24h` (fetch missing thumbnails)
| probe_protect_access_events.py | `probe_protect_access_events.py` | `python3 probe_protect_access_events.py --help`
| migrate_lpr_data.py | `migrate_lpr_data.py` | `python3 migrate_lpr_data.py --dry-run` (migrate/transforms)
| inspect_enable_vehicle_analytics.py | `inspect_enable_vehicle_analytics.py` | `python3 inspect_enable_vehicle_analytics.py`
| enrich_thumbnails_24h.py | `enrich_thumbnails_24h.py` | `python3 enrich_thumbnails_24h.py` (24h backfill)
| enrich_lpr_records.py | `enrich_lpr_records.py` | `python3 enrich_lpr_records.py --help` (enrich LPR docs)
| dump_protect_event_metadata.py | `dump_protect_event_metadata.py` | `python3 dump_protect_event_metadata.py`
| consolidate_lpr_data.py | `consolidate_lpr_data.py` | `python3 consolidate_lpr_data.py --help`
| clear_lpr_notes.py | `clear_lpr_notes.py` | `python3 clear_lpr_notes.py --dry-run`
| clean_lpr_mongodb.py | `clean_lpr_mongodb.py` | `python3 clean_lpr_mongodb.py --help`
| check_thumbnails.py | `check_thumbnails.py` | `python3 check_thumbnails.py --path ./public/thumbnails`
| backfill_protect_hours.py / backfill_protect_45m.py | `backfill_protect_hours.py` | `python3 backfill_protect_hours.py --start 2026-01-01`
| scripts/remove_admin_code_sent_audit_logs.py | `scripts/remove_admin_code_sent_audit_logs.py` | cleanup helper
| scripts/clear_user_actions.py | `scripts/clear_user_actions.py` | cleanup helper

<br/>

### LPR Ingestion & Notifications

| Script | Path | Quick usage / note |
|---|---|---|
| LPR_Notifications/fast_lpr_capture.py | `LPR_Notifications/fast_lpr_capture.py` | `python3 LPR_Notifications/fast_lpr_capture.py` (producer)
| LPR_Notifications/lpr_event_capture.py | `LPR_Notifications/lpr_event_capture.py` | `python3 LPR_Notifications/lpr_event_capture.py`
| LPR_Notifications/lpr_microservice.py / v2 | `LPR_Notifications/lpr_microservice.py` | long-running microservice; see file for flags
| LPR_Notifications/lpr_websocket_listener.py | `LPR_Notifications/lpr_websocket_listener.py` | `python3 LPR_Notifications/lpr_websocket_listener.py`
| LPR_Notifications/query_lpr_plates.py | `LPR_Notifications/query_lpr_plates.py` | `python3 LPR_Notifications/query_lpr_plates.py --help`
| LPR_Notifications/start_lpr_service.sh | `LPR_Notifications/start_lpr_service.sh` | `./LPR_Notifications/start_lpr_service.sh`
| LPR_Notifications/test_lpr_integration.sh | `LPR_Notifications/test_lpr_integration.sh` | integration smoke tests

<br/>

### Mongo-Filter & DB validator

| Script | Path | Quick usage / note |
|---|---|---|
| Mongo-Filter/apply_validator.sh | `Mongo-Filter/apply_validator.sh` | `./Mongo-Filter/apply_validator.sh` (edit vars at top)
| Mongo-Filter/backup_and_delete_notes.sh | `Mongo-Filter/backup_and_delete_notes.sh` | `./Mongo-Filter/backup_and_delete_notes.sh`
| Mongo-Filter/test_insert.sh | `Mongo-Filter/test_insert.sh` | `./Mongo-Filter/test_insert.sh`
| Mongo-Filter/monitor_write_errors.sh + .py | `Mongo-Filter/monitor_write_errors.sh` | `./Mongo-Filter/monitor_write_errors.sh` (runs `monitor_write_errors.py`)
| Mongo-Filter/run_monitor.sh | `Mongo-Filter/run_monitor.sh` | run wrapper

<br/>

### Tracking PINs (correlation)

| Script | Path | Quick usage / note |
|---|---|---|
| Tracking_PINs/track_pins.py | `Tracking_PINs/track_pins.py` | `python3 Tracking_PINs/track_pins.py --mode api --api-url 'https://example' --start 2026-01-01 --end 2026-01-02 --time-delta 60`
| Tracking_PINs/run_track.sh | `Tracking_PINs/run_track.sh` | `./Tracking_PINs/run_track.sh`
| Tracking_PINs/run_fetch_and_match.sh / fetch_window.sh / fetch_pins_7d.sh | `Tracking_PINs/*` | Helpers for common workflows

<br/>

### Docker & container helpers

| Script | Path | Quick usage / note |
|---|---|---|
| docker/entrypoint.sh | `docker/entrypoint.sh` | container startup script; used by `docker-compose` |
| docker/unraid_entrypoint.sh | `docker/unraid_entrypoint.sh` | Unraid-specific entrypoint |
| scripts/lpr_control.sh | `scripts/lpr_control.sh` | `./scripts/lpr_control.sh start` |
| scripts/test_startup_catchup.sh | `scripts/test_startup_catchup.sh` | smoke tests |

(These groupings highlight the most commonly used scripts; some folders contain additional helpers and test scripts — open the file for full usage and flags.)

---
---

## Notes & Contributions ✨
If you want to add more screenshots or update the flows, drop the images into `Pictures/` and update this README with new paths. Contributions to improve documentation, fix UI copy, or add more admin automation are welcome.

---

## Additional Notes & Work-in-progress ✨
- **Users & Visitors sync** ✅
  - The server syncs users from the upstream API every **30 minutes** (see `setInterval(fetchAndCacheData, 30 * 60 * 1000)` in `index.js`). Fetched users populate the in-memory cache and are persisted to MongoDB collection `users_cache` with a `lastSync` timestamp.
  - Visitors are fetched per-user via `/api/visitors`. The server stores per-user results in the `visitors_cache` collection (with `lastSync`) and will return a **stale cached** response if the upstream API is slow or fails (the endpoint returns `cached: true/false` and `stale: true/false`). The UI refreshes visitors when the **Visitors** tab is shown and also runs a background refresh every **2 minutes** (see `public/script.js`).

- **LPR Dashboard — Returns & filters** 🚗
  - `GET /api/lpr/search` returns:
    ```json
    {
      "results": [ /* detection objects (license_plate, camera_name, timestamp, confidence, vehicle_data, user_name, user_email, etc.) */ ],
      "pagination": { "page", "limit", "total", "pages" },
      "query": { /* echoed filters */ },
      "timestamp": "..."
    }
    ```
    Supports filters: `plate`, `name`, `email`, `camera`, `start_date`, `end_date`, `min_confidence`, `status`, `color`, `vehicle_type`, `owner`, and paging (`page`,`limit`). When no filters are provided, the endpoint returns a paginated list of newest detections.
  - `GET /api/license-plates` returns `{ total, hours, plates, timestamp }` for quick metrics and `GET /api/license-plates/search/:plate` returns `{ plate, found, detections, timestamp }` for direct plate lookups.

- **Avatars** 🖼️
  - Avatar images live in `public/avatars/`. The server (`index.js`) looks for avatar cache files under the avatar cache directory and will download from the CDN asynchronously when needed — see the avatar logic around `avatarCacheDir` in `index.js`.

- **LPR Notifications** ⚙️
  - The `LPR_Notifications/` folder contains the capture & ingestion code that gets LPR events into MongoDB (examples: `lpr_microservice.py`, `lpr_event_capture.py`, `lpr_websocket_listener.py`, `query_mongodb_lpr.py`). Use README files inside that folder for deployment and troubleshooting (`LPR_Notifications/README_LPR.md`, `LPR_QUICK_START.md`).

- **Mongo Filter** 🔒
  - The `Mongo-Filter/` folder documents and provides scripts to apply a collection validator to `web-portal.license_plates` (see `Mongo-Filter/README.md`). It contains `apply_validator.sh`, `test_insert.sh` and guidance for safely backing up and deleting placeholder/entry/exit/Kiosk records.

- **Installation instructions** 📦
  - See `Install Instructions/README.md` for Docker compose examples and templates (`docker-compose.yml`, `lpr-capture-compose.yml`) and step-by-step install notes.

- **Tracking PINs** 📌
  - The `Tracking_PINs/` folder contains scripts to fetch PIN/QR events and cross-reference them with unassigned LPR detections (`track_pins.py`, `run_track.sh`, `sample_query.txt`). It produces CSV match reports and is read-only (no DB writes).

---

*Last updated: Jan 3, 2026*
