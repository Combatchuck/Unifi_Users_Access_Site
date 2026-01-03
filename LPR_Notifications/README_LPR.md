# License Plate Recognition (LPR) System Setup

## Overview

This system captures license plate detections from your 2 Ubiquiti Protect **LPR (License Plate Recognition) cameras** and stores them in MongoDB with a REST API for querying.

**Cameras being monitored:**
- LPR Camera Right
- LPR Camera Left

---

## Architecture

### 1. **Python Microservice** (`fast_lpr_capture.py`)
- Runs continuously in background
- Polls UniFi Protect API every 5 seconds for new license plate detection events
- Filters for events from the 2 LPR cameras only
- Stores detections in MongoDB `license_plates` collection
- **Status**: Production-ready

### 2. **Express.js REST API** (`index.js`)
- Provides endpoints to query captured license plates
- Real-time stats and analytics
- Search by plate number
- Aggregated camera statistics

### 3. **MongoDB Database**
- Collection: `web-portal.license_plates`
- Indexed by: `event_id` (unique), `timestamp`, `camera_id`
- Auto-stores when Python service runs

---

## Setup Instructions

### Step 1: Verify Environment Variables

Ensure your `.env` file contains:

```bash
UNIFI_PROTECT_API_KEY=VU2VgiOnHzLZOX3dTEZFUvF_hztIW3b_
UNIFI_PROTECT_USERNAME=your_protect_username
UNIFI_PROTECT_PASSWORD=asdfSD353--sd
MONGO_URL=mongodb://localhost:27017/web-portal
```

### Step 2: Start the Python LPR Service

**Option A: Run in foreground (testing)**
```bash
cd /Volumes/Docker_Mounts/st-michaels-bay-DEV/web-portal-dev
.venv/bin/python fast_lpr_capture.py
```

**Option B: Run in background (production)**
```bash
# Using nohup
nohup .venv/bin/python fast_lpr_capture.py > lpr.log 2>&1 &

# Using screen
screen -S lpr
.venv/bin/python fast_lpr_capture.py
# Press Ctrl+A then D to detach

# Using systemd (see below)
```

### Step 3: Verify API Endpoints

The Express.js server at `http://localhost:3000` provides these LPR endpoints:

#### **Get all detected plates (last 24 hours)**
```bash
curl http://localhost:3000/api/license-plates
```

#### **Get plates from specific camera**
```bash
curl "http://localhost:3000/api/license-plates?camera=67ec822c00abc103e400c1b0"
```

#### **Get plates from last 6 hours**
```bash
curl "http://localhost:3000/api/license-plates?hours=6&limit=20"
```

#### **Get LPR statistics**
```bash
curl http://localhost:3000/api/license-plates/stats
```

#### **Search for a specific plate**
```bash
curl http://localhost:3000/api/license-plates/search/ABC123
```

#### **Get LPR service status**
```bash
curl http://localhost:3000/api/license-plates/status
```

---

## API Endpoints Reference

### `GET /api/license-plates`
Returns detected license plates

**Query Parameters:**
- `limit` (int, default: 50) - Number of results
- `hours` (int, default: 24) - Look back hours
- `camera` (string) - Filter by camera ID
- `plate` (string) - Filter by partial plate match

**Response:**
```json
{
  "total": 5,
  "hours": 24,
  "plates": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "event_id": "evt123",
      "timestamp": "2025-12-30T19:54:10.000Z",
      "camera_id": "67ec822c00abc103e400c1b0",
      "camera_name": "LPR Camera Right",
      "detected_at": "2025-12-30T19:54:15.000Z"
    }
  ]
}
```

### `GET /api/license-plates/stats`
Returns statistics about captured plates

**Query Parameters:**
- `hours` (int, default: 24) - Time window

**Response:**
```json
{
  "hours": 24,
  "total_detections": 15,
  "unique_plates": 8,
  "by_camera": [
    { "_id": "LPR Camera Right", "count": 9 },
    { "_id": "LPR Camera Left", "count": 6 }
  ]
}
```

### `GET /api/license-plates/search/:plate`

Backfill helper scripts

- `backfill_protect_hours.py` — Unified backfill: backfill the last N hours (default: 1). Example: `python backfill_protect_hours.py 24` backfills the last 24 hours. To run with the capture container's virtualenv use `PYTHON=/var/lib/lpr/venv/bin/python python backfill_protect_hours.py 24`.

Container startup catchup

The container entrypoint can optionally run a catch-up backfill before starting the main services. This is controlled by the following env vars:

- `RUN_LPR_CATCHUP_ON_STARTUP` (default: `1`) — when set to `1` the entrypoint will run a catch-up before starting the capture service. Set to `0` to disable.
- `CATCHUP_HOURS` (default: `24`) — the number of hours to backfill when the entrypoint runs catchup.

Log output from the catchup runs to `/var/log/backfill_protect.log` inside the container. The entrypoint respects a lock file at `/var/run/lpr_catchup.lock` to avoid concurrent catchup runs.

CI / Integration tests

We added a GitHub Actions workflow (`.github/workflows/lpr-ci.yml`) that runs quick guard tests on push/PR and offers an optional `workflow_dispatch` integration job that runs `scripts/test_startup_catchup.sh` on a **self-hosted runner** with network access to your Protect and Mongo hosts. The integration job requires repository secrets (set these in your repo settings): `UNIFI_PROTECT_HOST`, `MONGODB_HOST`, and any credentials you need (`UNIFI_PROTECT_USERNAME`, `UNIFI_PROTECT_PASSWORD`, `UNIFI_PROTECT_API_KEY`, `MONGODB_PORT`).

To run the integration test from the Actions UI, choose **Run workflow** and set the `run_integration` input to `true`.


Ensure vehicle color and type are included in backfill: `backfill_protect_hours.py` extracts `vehicle_color` and `vehicle_type` when available and stores them on inserted docs.

### `GET /api/license-plates/search/:plate`
Search for a specific license plate

**Query Parameters:**
- `days` (int, default: 30) - Look back days

**Example:**
```bash
GET /api/license-plates/search/EBB212?days=7
```

**Response:**
```json
{
  "plate": "EBB212",
  "days": 7,
  "found": 3,
  "detections": [
    {
      "timestamp": "2025-12-30T15:00:00.000Z",
      "camera_name": "LPR Camera Right"
    }
  ]
}
```

### `GET /api/license-plates/status`
Get service health status

**Response:**
```json
{
  "service": "LPR Event Capture",
  "status": "active",
  "cameras_monitored": 2,
  "cameras": ["LPR Camera Right", "LPR Camera Left"],
  "detections": {
    "last_hour": 3,
    "last_24_hours": 47,
    "all_time": 523
  },
  "last_detection": {
    "timestamp": "2025-12-30T19:54:10.000Z",
    "camera": "LPR Camera Right"
  }
}
```

---

## Running as a System Service (Systemd)

Create `/etc/systemd/system/lpr-capture.service`:

```ini
[Unit]
Description=License Plate Recognition Capture Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/Volumes/Docker_Mounts/st-michaels-bay-DEV/web-portal-dev
ExecStart=/Volumes/Docker_Mounts/st-michaels-bay-DEV/web-portal-dev/.venv/bin/python fast_lpr_capture.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Enable and start:**
```bash
sudo systemctl enable lpr-capture
sudo systemctl start lpr-capture
sudo systemctl status lpr-capture
```

**View logs:**
```bash
sudo journalctl -u lpr-capture -f
```

---

## Database Schema

### Collection: `license_plates`

```javascript
{
  "_id": ObjectId,
  "event_id": "evt_unique_id",        // Unique per Protect event
  "timestamp": ISODate,                // When detected
  "camera_id": "67ec822c00abc103e400c1b0",
  "camera_name": "LPR Camera Right",
  "detected_at": ISODate              // When stored
}
```

**Indexes:**
- `event_id` (unique) - Prevents duplicate captures
- `timestamp` - For time-range queries
- `camera_id` - For camera filtering

---

## Testing the Integration

### 1. Check Service Running
```bash
curl http://localhost:3000/api/license-plates/status
```

### 2. Trigger a Detection
Drive a vehicle past either LPR camera. You should see:
```bash
# Check the logs
tail -f lpr.log

# Or query the API
curl http://localhost:3000/api/license-plates?limit=1
```

### 3. Search Historical Data
```bash
curl "http://localhost:3000/api/license-plates/search/ABC123"
```

---

## Troubleshooting

### Service Not Starting
```bash
# Check logs
.venv/bin/python fast_lpr_capture.py

# Verify connectivity
ping $UNIFI_PROTECT_HOST
```

### No Detections
1. Verify LPR cameras have detection enabled in Protect UI
2. Check if vehicles are actually passing cameras
3. Verify MongoDB connection: `mongosh "$MONGO_URL"` (set `MONGO_URL` in `.env`)

### API Endpoint Not Found
1. Restart Express.js server
2. Verify index.js has LPR endpoints

---

## Files Included

- `fast_lpr_capture.py` - Main LPR capture service
- `query_lpr_plates.py` - CLI tool to query plates
- `index.js` - Express.js with LPR API endpoints
- `.env` - Environment configuration
- `README_LPR.md` - This file

---

## Next Steps

1. ✅ **Start the service:** `python fast_lpr_capture.py`
2. ✅ **Test an endpoint:** `curl http://localhost:3000/api/license-plates/status`
3. **Integrate with frontend:** Add LPR display to status.html
4. **Set up dashboards:** Use the API to build analytics
5. **Configure alerts:** Send notifications on specific plate matches

---

## Support

For issues or questions, check:
- Service logs: `lpr.log`
- MongoDB: Verify `license_plates` collection exists
- Protect UI: Confirm LPR detection is enabled on cameras
