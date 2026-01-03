# 🚗 License Plate Recognition - Quick Start Guide

## What's Ready

✅ **Python LPR Service**: Captures license plates from 2 LPR cameras  
✅ **Express.js API**: Query plates via REST endpoints  
✅ **MongoDB Storage**: Persistent storage in `license_plates` collection  
✅ **No Freezing**: Fast, efficient polling (no slow iterations)  
✅ **Only 2 Cameras**: Filters for LPR cameras only

---

## Quick Start (3 steps)

### 1️⃣ Start the Service
```bash
cd /Volumes/Docker_Mounts/st-michaels-bay-DEV/web-portal-dev
./start_lpr_service.sh
```

Or run directly:
```bash
.venv/bin/python fast_lpr_capture.py
```

### 2️⃣ Verify It's Running
```bash
curl http://localhost:3000/api/license-plates/status
```

Expected response:
```json
{
  "service": "LPR Event Capture",
  "status": "active",
  "cameras_monitored": 2,
  "cameras": ["LPR Camera Right", "LPR Camera Left"],
  "detections": {
    "last_hour": 0,
    "last_24_hours": 0,
    "all_time": 0
  }
}
```

### 3️⃣ Trigger a Detection
Drive a vehicle past either LPR camera and it will be captured automatically!

---

## API Commands

### Get All Plates (Last 24 Hours)
```bash
curl http://localhost:3000/api/license-plates
```

### Get Stats
```bash
curl http://localhost:3000/api/license-plates/stats
```

### Search for Specific Plate
```bash
curl "http://localhost:3000/api/license-plates/search/ABC123"
```

### Get Last 5 Detections
```bash
curl "http://localhost:3000/api/license-plates?limit=5"
```

### Get Plates from Last 6 Hours
```bash
curl "http://localhost:3000/api/license-plates?hours=6"
```

---

## Architecture

```
┌─────────────────────────────────────────┐
│  UniFi Protect Console (set UNIFI_PROTECT_HOST in your .env)     │
│  • 2 LPR Cameras (UVC AI LPR)          │
│  • License plate detection enabled     │
└──────────────────┬──────────────────────┘
                   │ Polls every 5 sec
                   ↓
┌─────────────────────────────────────────┐
│  fast_lpr_capture.py (Python Service)   │
│  • Connects to Protect API              │
│  • Filters for LPR cameras only         │
│  • Stores to MongoDB                    │
└──────────────────┬──────────────────────┘
                   │ Stores events
                   ↓
┌─────────────────────────────────────────┐
│  MongoDB (set MONGO_URL in your .env)    │
│  • Collection: license_plates           │
│  • Indexed by: timestamp, camera_id     │
└──────────────────┬──────────────────────┘
                   │ Queries
                   ↓
┌─────────────────────────────────────────┐
│  Express.js REST API (localhost:3000)   │
│  • /api/license-plates                 │
│  • /api/license-plates/stats           │
│  • /api/license-plates/search/:plate   │
│  • /api/license-plates/status          │
└─────────────────────────────────────────┘
```

---

## Key Features

🎯 **Only monitors 2 LPR cameras** - No other cameras captured  
⚡ **Fast polling** - 5 second intervals, no iteration delays  
🔒 **Unique event tracking** - No duplicate captures  
📊 **MongoDB persistence** - Searchable, queryable history  
🔍 **Flexible API** - Filter by camera, time range, plate number  
📈 **Statistics** - Real-time counts and analytics  

---

## Files Created

| File | Purpose |
|------|---------|
| `fast_lpr_capture.py` | Python microservice that captures LPR events |
| `start_lpr_service.sh` | Easy deployment script |
| `query_lpr_plates.py` | CLI tool to query plates |
| `README_LPR.md` | Comprehensive documentation |
| `index.js` | Updated with LPR API endpoints |

---

## How It Works

1. **Service Starts**: `fast_lpr_capture.py` connects to Protect API
2. **Polls Regularly**: Checks for new events every 5 seconds
3. **Filters**: Only processes events from the 2 LPR cameras
4. **Detects Plates**: When vehicles pass cameras, events are captured
5. **Stores**: Events stored in MongoDB `license_plates` collection
6. **API Access**: Query via REST endpoints

---

## Database Structure

```javascript
{
  "_id": ObjectId,
  "event_id": "evt_abc123",
  "timestamp": ISODate("2025-12-30T19:54:10Z"),
  "camera_id": "67ec822c00abc103e400c1b0",
  "camera_name": "LPR Camera Right",
  "detected_at": ISODate("2025-12-30T19:54:15Z")
}
```

---

## Troubleshooting

### Service won't start
```bash
# Check Python environment
.venv/bin/python --version

# Check Protect connectivity
ping $UNIFI_PROTECT_HOST

# Check MongoDB
mongosh "$MONGO_URL"  # set MONGO_URL in your .env
```

### No detections appearing
1. Verify LPR cameras have detection enabled in Protect UI
2. Check if vehicles are actually passing cameras
3. Wait a few seconds for polling interval

### API endpoint not responding
```bash
# Restart Express.js server
npm start

# Or
node index.js
```

---

## Next Steps

1. ✅ **Start service**: `./start_lpr_service.sh`
2. ✅ **Test API**: `curl http://localhost:3000/api/license-plates/status`
3. 📊 **Add to Dashboard**: Integrate with status.html
4. 🔔 **Set up Alerts**: Create webhook notifications
5. 📈 **Build Analytics**: Use data for reporting

---

## Support Commands

```bash
# View service logs
tail -f lpr_capture.log

# Check MongoDB data
mongo
> use web-portal
> db.license_plates.find().limit(5)
> db.license_plates.countDocuments()

# Query API directly
curl http://localhost:3000/api/license-plates/status | jq

# Stop service
kill $(cat lpr_capture.pid)
```

---

**You're all set! 🎉 The system is ready to capture license plates from your 2 LPR cameras.**
