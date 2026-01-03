# LPR Notification Implementation Checklist

## Overview
This document is a deployment checklist for implementing the License Plate Recognition (LPR) system in production. Follow each step sequentially and verify completion before moving to the next.

---

## Phase 1: Pre-Deployment (30 minutes)

### Step 1.1: Gather Credentials
Required from client:
- [ ] UniFi Protect NVR IP address
- [ ] UniFi Protect username
- [ ] UniFi Protect password
- [ ] UniFi Protect API key
- [ ] MongoDB host and port
- [ ] MongoDB database name (usually `web-portal`)
- [ ] Web portal root directory path

**Format needed:**
```
UNIFI_PROTECT_HOST=xxx.xxx.xxx.xxx
UNIFI_PROTECT_USERNAME=username
UNIFI_PROTECT_PASSWORD=password
UNIFI_PROTECT_API_KEY=key_string
MONGODB_HOST=mongodb_ip
MONGODB_PORT=27017
MONGODB_DATABASE=web-portal
```

### Step 1.2: Verify System Access
Execute these commands to verify access to each system:

```bash
# Test Protect access
curl -k https://<UNIFI_PROTECT_HOST>:443/api/

# Test MongoDB access
mongosh --host <MONGODB_HOST>:27017 --eval "db.version()"

# Verify Node.js is running
ps aux | grep "node index.js"

# Check Python 3 is installed
python3 --version
```

All three should succeed before proceeding.

### Step 1.3: Verify Environment
- [ ] Production server has Python 3.10+
- [ ] pip is installed: `pip --version`
- [ ] Node.js is running (at least one of the above checks passed)
- [ ] MongoDB is accessible
- [ ] UniFi Protect is accessible
- [ ] Internet connectivity for pip package installation

---

## Phase 2: Installation (15 minutes)

### Step 2.1: Create .env File

Create `/path/to/web-portal/.env` with all credentials from Step 1.1:

```bash
cat > /path/to/web-portal/.env << 'EOF'
UNIFI_PROTECT_HOST=<IP_ADDRESS>
UNIFI_PROTECT_PORT=443
UNIFI_PROTECT_USERNAME=<USERNAME>
UNIFI_PROTECT_PASSWORD=<PASSWORD>
UNIFI_PROTECT_API_KEY=<API_KEY>
MONGODB_HOST=<MONGODB_IP>
MONGODB_PORT=27017
MONGODB_DATABASE=web-portal
EOF
```

**Verification:**
```bash
grep UNIFI /path/to/web-portal/.env | wc -l  # Should be 5
grep MONGODB /path/to/web-portal/.env | wc -l  # Should be 3
```

### Step 2.2: Install Python Dependencies

```bash
python3 -m pip install --upgrade pip
python3 -m pip install uiprotect==7.33.3
python3 -m pip install pymongo
python3 -m pip install python-dotenv
```

**Verification:**
```bash
python3 << 'EOF'
try:
    from uiprotect import ProtectApiClient
    from pymongo import MongoClient
    from dotenv import load_dotenv
    print("✓ All packages installed successfully")
except ImportError as e:
    print(f"✗ Missing package: {e}")
    exit(1)
EOF
```

### Step 2.3: Copy fast_lpr_capture.py

Copy the complete `fast_lpr_capture.py` script to `/path/to/web-portal/`

**Content to include:**
- Must import: asyncio, os, sys, logging, datetime, MongoClient, dotenv
- Main class: `FastLPRCapture`
- Methods: `start()`, `capture_plates()`, `run()`
- Must filter for: `c.type == 'UVC AI LPR'` cameras only
- Must extract: license plate from `event.metadata.detected_thumbnails`

**Verification:**
```bash
python3 -m py_compile /path/to/web-portal/fast_lpr_capture.py
# Should produce no errors
```

---

## Phase 3: Testing (20 minutes)

### Step 3.1: Test Protect Connection

Run:
```bash
cd /path/to/web-portal
python3 << 'EOF'
import asyncio, os
from dotenv import load_dotenv
from uiprotect import ProtectApiClient

load_dotenv()

async def test():
    try:
        protect = ProtectApiClient(
            host=os.getenv('UNIFI_PROTECT_HOST'),
            port=int(os.getenv('UNIFI_PROTECT_PORT')),
            username=os.getenv('UNIFI_PROTECT_USERNAME'),
            password=os.getenv('UNIFI_PROTECT_PASSWORD'),
            verify_ssl=False,
            api_key=os.getenv('UNIFI_PROTECT_API_KEY')
        )
        await protect.update()
        cameras = [c for c in protect.bootstrap.cameras.values() if c.type == 'UVC AI LPR']
        print(f"✓ Protect connected")
        print(f"✓ LPR cameras found: {len(cameras)}")
        for cam in cameras:
            print(f"  • {cam.name}")
    except Exception as e:
        print(f"✗ Failed: {e}")

asyncio.run(test())
EOF
```

**Expected output:**
```
✓ Protect connected
✓ LPR cameras found: 2
  • LPR Camera Right
  • LPR Camera Left
```

**If fails:**
- Check credentials in .env
- Verify network access to Protect IP
- Verify API key is valid

### Step 3.2: Test MongoDB Connection

Run:
```bash
python3 << 'EOF'
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

try:
    client = MongoClient(
        f"{os.getenv('MONGODB_HOST')}:{os.getenv('MONGODB_PORT')}"
    )
    db = client[os.getenv('MONGODB_DATABASE')]
    count = db['license_plates'].count_documents({})
    print(f"✓ MongoDB connected")
    print(f"✓ Database: {os.getenv('MONGODB_DATABASE')}")
    print(f"✓ Current plates in DB: {count}")
except Exception as e:
    print(f"✗ Failed: {e}")
EOF
```

**Expected output:**
```
✓ MongoDB connected
✓ Database: web-portal
✓ Current plates in DB: 0
```

(Or some number if there are existing records)

**If fails:**
- Check MongoDB is running
- Verify connection string in .env
- Check firewall allows 27017

### Step 3.3: Test Service Startup

Run the service for 30 seconds:

```bash
cd /path/to/web-portal
python3 fast_lpr_capture.py 30
```

**Expected output:**
```
2025-12-31 12:00:00,123 - INFO - ✓ Connected to UniFi Protect
2025-12-31 12:00:00,124 - INFO - ✓ Monitoring 2 LPR cameras:
2025-12-31 12:00:00,125 - INFO - ✓ Connected to MongoDB
2025-12-31 12:00:00,126 - INFO - 🎯 License Plate Capture Running
```

**If fails:**
- Check .env has all required variables
- Verify Python 3 version >= 3.10
- Check logs for specific error messages

---

## Phase 4: API Integration (20 minutes)

### Step 4.1: Locate Express.js Configuration

Find the file: `/path/to/web-portal/index.js`

Locate the section where other `/api/` routes are defined. Look for:
- `app.get('/'...`
- `app.post('/api/...`
- Or similar Express route definitions

### Step 4.2: Add LPR API Endpoints

Before the final `app.listen()` statement, add these 4 endpoint handlers:

**Endpoint 1: GET /api/license-plates**
- Returns: Array of license plates with filters
- Query params: `?limit=100&hours=24&camera=NAME&plate=ABC`
- Required: Access to MongoDB `license_plates` collection

**Endpoint 2: GET /api/license-plates/stats**
- Returns: Statistics (total, unique, by_camera)
- No params needed
- Required: Access to MongoDB aggregation

**Endpoint 3: GET /api/license-plates/search/:plate**
- Returns: All detections of specific plate
- Params: Plate number in URL path
- Required: Case-insensitive search

**Endpoint 4: GET /api/license-plates/status**
- Returns: Service health status
- No params needed
- Required: Count documents in collection

Code template available in: `PROD_LPR_DEPLOYMENT.md` Part 3

### Step 4.3: Verify API Code Syntax

```bash
node -c /path/to/web-portal/index.js
```

Should output nothing if syntax is valid.

**If syntax error:**
- Check for missing braces, semicolons
- Verify MongoDB client variable name matches (usually `client` or `db`)
- Check all route names are unique

### Step 4.4: Test API Endpoints

Start Node.js server if not running:
```bash
cd /path/to/web-portal
npm start
```

Wait 5 seconds for server to fully start, then test:

```bash
# Test 1: Get plates
curl -s http://localhost:3000/api/license-plates | head -50

# Test 2: Get stats
curl -s http://localhost:3000/api/license-plates/stats

# Test 3: Search
curl -s http://localhost:3000/api/license-plates/search/TEST

# Test 4: Status
curl -s http://localhost:3000/api/license-plates/status
```

**Expected responses:**
- Should return JSON (not HTML error)
- Should have `total`, `plates`, or similar fields
- Should not have 404 or 500 errors

**If API returns 404:**
- Verify routes were added to index.js
- Check server was restarted after adding routes
- Verify route paths match exactly

**If API returns 500:**
- Check server logs for MongoDB errors
- Verify MongoDB connection string in code
- Check database and collection names are correct

---

## Phase 5: Service Deployment (10 minutes)

### Step 5.1: Start Service

**Option A: Direct (for testing)**
```bash
cd /path/to/web-portal
python3 fast_lpr_capture.py &
```

**Option B: Production (nohup)**
```bash
cd /path/to/web-portal
nohup python3 fast_lpr_capture.py > lpr_capture.log 2>&1 &
echo $! > lpr_capture.pid
```

**Option C: Systemd (recommended)**
Create `/etc/systemd/system/lpr-capture.service`:
```ini
[Unit]
Description=License Plate Recognition Capture Service
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/web-portal
ExecStart=/usr/bin/python3 /path/to/web-portal/fast_lpr_capture.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable lpr-capture
sudo systemctl start lpr-capture
sudo systemctl status lpr-capture
```

### Step 5.2: Verify Service is Running

```bash
ps aux | grep fast_lpr_capture | grep -v grep
```

Should show the Python process running. If empty, service failed to start.

**Troubleshoot:**
```bash
# Check logs
tail lpr_capture.log

# Re-run to see errors
python3 fast_lpr_capture.py
```

### Step 5.3: Monitor Initial Operation

Let service run for 2-5 minutes:

```bash
# Check logs continuously
tail -f lpr_capture.log

# Or check MongoDB for new entries
mongosh << 'EOF'
use web-portal
db.license_plates.find().sort({timestamp: -1}).limit(5)
EOF
```

**Expected behavior:**
- Service logs show "Connected to Protect" and "Connected to MongoDB"
- Service logs show "License Plate Capture Running"
- No error messages in logs

**If no plates captured:**
- This is OK - service needs vehicles to pass cameras
- Verify cameras are enabled in Protect UI
- Check camera type is "UVC AI LPR"
- Service will capture automatically when vehicles detected

---

## Phase 6: Verification (10 minutes)

### Step 6.1: Run Health Check

```bash
python3 << 'EOF'
import os
import asyncio
from dotenv import load_dotenv
from uiprotect import ProtectApiClient
from pymongo import MongoClient

load_dotenv()

print("=== LPR System Health Check ===\n")

# Check 1: Protect
try:
    async def check_protect():
        protect = ProtectApiClient(
            host=os.getenv('UNIFI_PROTECT_HOST'),
            port=int(os.getenv('UNIFI_PROTECT_PORT')),
            username=os.getenv('UNIFI_PROTECT_USERNAME'),
            password=os.getenv('UNIFI_PROTECT_PASSWORD'),
            verify_ssl=False,
            api_key=os.getenv('UNIFI_PROTECT_API_KEY')
        )
        await protect.update()
        cameras = [c for c in protect.bootstrap.cameras.values() if c.type == 'UVC AI LPR']
        return len(cameras)
    
    num_cameras = asyncio.run(check_protect())
    print(f"✓ Protect API: Connected ({num_cameras} LPR cameras)")
except Exception as e:
    print(f"✗ Protect API: Failed ({e})")

# Check 2: MongoDB
try:
    client = MongoClient(f"{os.getenv('MONGODB_HOST')}:{os.getenv('MONGODB_PORT')}")
    db = client[os.getenv('MONGODB_DATABASE')]
    count = db['license_plates'].count_documents({})
    print(f"✓ MongoDB: Connected ({count} plates in DB)")
except Exception as e:
    print(f"✗ MongoDB: Failed ({e})")

# Check 3: Service
import subprocess
result = subprocess.run(['ps', 'aux'], capture_output=True, text=True)
if 'fast_lpr_capture.py' in result.stdout:
    print(f"✓ Service: Running")
else:
    print(f"✗ Service: Not running")

# Check 4: API
try:
    import urllib.request
    response = urllib.request.urlopen('http://localhost:3000/api/license-plates/status')
    print(f"✓ API: Responding")
except:
    print(f"✗ API: Not responding")

print("\n=== Health Check Complete ===")
EOF
```

All four checks should show ✓ before proceeding to production.

### Step 6.2: Document Results

Create a file `/path/to/web-portal/DEPLOYMENT_RECORD.txt`:

```
LPR Production Deployment Record
=================================
Deployment Date: [DATE]
Deployed By: User
Environment: Production

System Status:
- Protect API: ✓ Connected
- MongoDB: ✓ Connected
- Service: ✓ Running
- API Endpoints: ✓ Responding

Cameras Monitored: [NUMBER]
- [Camera 1 Name]
- [Camera 2 Name]

Database: web-portal
Collection: license_plates

Initial Plate Count: [NUMBER]

Notes:
[Any issues encountered and resolved]
```

---

## Phase 7: Client Handoff

### Step 7.1: Document How to Query Data

Provide client with this query example:

**Get all plates from last 24 hours:**
```bash
curl http://localhost:3000/api/license-plates
```

**Search for specific plate:**
```bash
curl http://localhost:3000/api/license-plates/search/ABC1234
```

**Get statistics:**
```bash
curl http://localhost:3000/api/license-plates/stats
```

**Using MongoDB directly:**
```javascript
db.license_plates.find({ camera_name: "LPR Camera Right" })
```

### Step 7.2: Provide Documentation Files

Ensure these files are in `/path/to/web-portal/`:
- [ ] `PROD_LPR_DEPLOYMENT.md` - Full reference guide
- [ ] `LPR_PROD_QUICK_START.md` - Quick reference
- [ ] `LPR_PROD_OPERATIONS.md` - Operations & troubleshooting
- [ ] `DEPLOYMENT_RECORD.txt` - This deployment's record
- [ ] `.env` - Configuration (DO NOT share credentials publicly)

### Step 7.3: Provide Contact Information

Document:
- Support contact for UniFi Protect issues
- Support contact for MongoDB issues
- Support contact for Node.js/Web portal issues
- Any custom modifications made

---

## Phase 6: Monitoring & Maintenance

### Step 6.1: Configure Logging & Rotation
- [ ] Ensure `lpr_capture.log` is rotated (logrotate or systemd journald) and archived weekly
- [ ] Set log retention policy (e.g., 30 days) and ensure logs are shipped to centralized logging if available
- [ ] Ensure logs include correlation IDs and sufficient context for debugging

### Step 6.2: Alerts & Health Checks
- [ ] Configure alerts for: repeated errors, high error rate, MongoDB disconnects, Protect connectivity drops
- [ ] Add a simple health check script `check_lpr_health.sh` that verifies service status and API endpoints
- [ ] Add uptime/availability monitoring (e.g., external probe hitting `/admin/status` or similar)

### Step 6.3: Scheduled Maintenance
- [ ] Schedule periodic checks (daily) for disk usage, DB growth, and log anomalies
- [ ] Document expected daily/weekly chores and assign owners

---

## Phase 7: Security, Backup & Secrets

### Step 7.1: Secrets Management
- [ ] Ensure `.env` is never committed to git and is listed in `.gitignore`
- [ ] Move production secrets to a secure secret store when practical (Vault, SSM, etc.)
- [ ] Rotate `UNIFI_PROTECT_API_KEY` and `EMAIL_PASS` periodically and document the rotation process

### Step 7.2: Backups
- [ ] Schedule regular backups of `license_plates` (daily snapshot) and keep at least 7 days of backups
- [ ] Test restore procedure monthly and document steps
- [ ] Store backups in a location separate from the production DB (e.g., different host or cloud storage)

### Step 7.3: Network & Access Controls
- [ ] Limit MongoDB access to internal network and use authentication
- [ ] Restrict access to Protect API to only required hosts/IPs
- [ ] Ensure proper firewall rules and IAM policies for servers

---

## Phase 8: Post-Deployment (24 hours)

### Step 8.1: Monitor Overnight

Check these after system has run for 24 hours:

```bash
# Check log file size
ls -lh lpr_capture.log

# Check MongoDB growth
mongosh << 'EOF'
use web-portal
db.license_plates.stats().avgObjSize * db.license_plates.count()
EOF

# Check for any errors in log
grep -i "error\|exception\|failed" lpr_capture.log
```

**Expected results:**
- Log file: < 10 MB
- Plates captured: > 0 (if vehicles passed cameras)
- Errors: None or only harmless SSL warnings

### Step 8.2: Test Edge Cases

```bash
# Large query (many plates)
curl "http://localhost:3000/api/license-plates?limit=1000"

# Search for non-existent plate
curl "http://localhost:3000/api/license-plates/search/NOTFOUND"

# Query with various filters
curl "http://localhost:3000/api/license-plates?hours=1"
curl "http://localhost:3000/api/license-plates?hours=168"
```

All should return valid JSON without errors.

### Step 8.3: Final Sign-Off

Complete this checklist:

- [ ] All 4 API endpoints responding
- [ ] Service running continuously
- [ ] No errors in logs
- [ ] MongoDB storing data correctly
- [ ] Documentation provided to client
- [ ] Client trained on query methods
- [ ] Backup procedures documented

**If all checked:** Deployment complete ✓

---

## Emergency Contacts

If issues arise:

1. **Service crashes:** Restart with `python3 fast_lpr_capture.py`
2. **API not responding:** Restart Node.js server
3. **MongoDB connection fails:** Check if MongoDB service is running
4. **No plates captured:** Verify cameras are enabled in Protect UI

See `LPR_PROD_OPERATIONS.md` for detailed troubleshooting.

