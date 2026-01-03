# LPR Production Troubleshooting & Operation Guide

## Section 1: Pre-Deployment Verification

### 1.1 Protect API Connectivity Test

```bash
python3 << 'EOF'
import asyncio
import os
from dotenv import load_dotenv

load_dotenv()

async def test_protect():
    try:
        from uiprotect import ProtectApiClient
        
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
        
        print(f"✓ Protect API: CONNECTED")
        print(f"✓ LPR Cameras Found: {len(cameras)}")
        for cam in cameras:
            print(f"  • {cam.name} (Detection: {cam.is_license_plate_detection_on})")
        
        return True
    except Exception as e:
        print(f"✗ Protect API: FAILED - {e}")
        return False

asyncio.run(test_protect())
EOF
```

### 1.2 MongoDB Connectivity Test

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
    plates = db['license_plates']
    
    count = plates.count_documents({})
    
    print(f"✓ MongoDB: CONNECTED")
    print(f"✓ Database: {os.getenv('MONGODB_DATABASE')}")
    print(f"✓ Collection: license_plates")
    print(f"✓ Plates in database: {count}")
    
except Exception as e:
    print(f"✗ MongoDB: FAILED - {e}")
EOF
```

### 1.3 Python Dependencies Test

```bash
python3 << 'EOF'
packages = {
    'uiprotect': 'from uiprotect import ProtectApiClient',
    'pymongo': 'from pymongo import MongoClient',
    'dotenv': 'from dotenv import load_dotenv'
}

print("Checking Python packages...")
all_ok = True

for name, import_stmt in packages.items():
    try:
        exec(import_stmt)
        print(f"✓ {name}")
    except ImportError as e:
        print(f"✗ {name}: {e}")
        all_ok = False

if all_ok:
    print("\n✓ All dependencies installed")
else:
    print("\n✗ Install missing: pip install uiprotect pymongo python-dotenv")
EOF
```

---

## Section 2: Service Operation

### 2.1 Starting the Service

**Method 1: Direct (for testing)**
```bash
cd /path/to/web-portal
python3 fast_lpr_capture.py
```

Expected output:
```
2025-12-31 12:00:00,123 - INFO - ✓ Connected to UniFi Protect
2025-12-31 12:00:00,124 - INFO - ✓ Monitoring 2 LPR cameras:
2025-12-31 12:00:00,124 - INFO -   • LPR Camera Right
2025-12-31 12:00:00,124 - INFO -   • LPR Camera Left
2025-12-31 12:00:00,130 - INFO - ✓ Connected to MongoDB
2025-12-31 12:00:00,130 - INFO - 🎯 License Plate Capture Running
```

**Method 2: Background (production)**
```bash
nohup python3 fast_lpr_capture.py > lpr_capture.log 2>&1 &
echo $! > lpr_capture.pid
```

**Method 3: Systemd (recommended)**
```bash
sudo systemctl start lpr-capture
sudo systemctl status lpr-capture
```

### 2.2 Verifying Service is Running

```bash
# Check process
ps aux | grep fast_lpr_capture | grep -v grep

# Check log file
tail -20 lpr_capture.log

# Check MongoDB for recent entries
mongosh << 'EOF'
use web-portal
db.license_plates.find().sort({timestamp: -1}).limit(1)
EOF
```

### 2.3 Stopping the Service

**Method 1: Kill process**
```bash
pkill -f fast_lpr_capture.py
```

**Method 2: Using PID file**
```bash
kill $(cat lpr_capture.pid)
rm lpr_capture.pid
```

**Method 3: Systemd**
```bash
sudo systemctl stop lpr-capture
```

---

## Section 3: Common Issues & Solutions

### Issue: Service starts but captures 0 plates

**Symptoms:**
- Vehicles pass cameras but nothing appears in MongoDB
- Service logs show no "Plate:" entries

**Diagnosis:**
```bash
# Check if cameras are actually set to LPR type
python3 << 'EOF'
import asyncio, os
from dotenv import load_dotenv
from uiprotect import ProtectApiClient

load_dotenv()

async def check():
    protect = ProtectApiClient(
        host=os.getenv('UNIFI_PROTECT_HOST'),
        port=int(os.getenv('UNIFI_PROTECT_PORT')),
        username=os.getenv('UNIFI_PROTECT_USERNAME'),
        password=os.getenv('UNIFI_PROTECT_PASSWORD'),
        verify_ssl=False,
        api_key=os.getenv('UNIFI_PROTECT_API_KEY')
    )
    await protect.update()
    
    for cam in protect.bootstrap.cameras.values():
        print(f"Camera: {cam.name}")
        print(f"  Type: {cam.type}")
        print(f"  LPR Detection: {cam.is_license_plate_detection_on}")
        print(f"  Can Detect Plate: {cam.can_detect_license_plate}")

asyncio.run(check())
EOF
```

**Solutions:**
1. Verify camera type in Protect UI is "UVC AI LPR"
2. Enable "License Plate Detection" in Protect settings
3. Ensure vehicles are actually passing in camera view
4. Check camera isn't blocked or disabled

### Issue: "Connection refused" to MongoDB

**Symptoms:**
```
pymongo.errors.ServerSelectionTimeoutError: [Errno 111] Connection refused
```

**Solutions:**
1. Verify MongoDB is running:
   ```bash
   mongosh --eval "db.version()"
   ```

2. Check connection string in .env:
   ```bash
   echo $MONGODB_HOST:$MONGODB_PORT
   ```

3. Check firewall allows 27017:
   ```bash
   telnet $MONGODB_HOST 27017
   ```

4. If MongoDB is on different server, verify network connectivity:
   ```bash
   ping $MONGODB_HOST
   ```

### Issue: "Failed to connect" to Protect API

**Symptoms:**
```
aiohttp.client_exceptions.ClientSSLError
or
aiohttp.ClientConnectorError
```

**Solutions:**
1. Verify Protect IP and port in .env:
   ```bash
   ping $UNIFI_PROTECT_HOST
   curl -k https://$UNIFI_PROTECT_HOST:443/
   ```

2. Verify credentials are correct:
   - Check username/password login in Protect UI manually
   - Regenerate API key if unsure

3. Check .env file doesn't have trailing spaces:
   ```bash
   cat .env | od -c | grep -A 2 API_KEY
   ```

### Issue: Service runs but crashes with "Event loop closed"

**Symptoms:**
- Service starts then immediately shows SSL/connection errors
- `RuntimeError: Event loop is closed`

**Solution:**
This is a known warning from the uiprotect library and is harmless. The service continues running despite the warning. Check if plates are being captured despite the error message.

### Issue: API endpoints return "Database error"

**Symptoms:**
```json
{"error": "Database error", "details": "..."}
```

**Solutions:**
1. Verify MongoDB connection string in Node.js
2. Check MongoDB is accessible from Node.js server
3. Verify `web-portal` database exists:
   ```bash
   mongosh << 'EOF'
   show dbs
   use web-portal
   show collections
   EOF
   ```

### Issue: High memory usage by Python service

**Symptoms:**
- Service uses >500MB RAM
- CPU usage spikes

**Solutions:**
1. Restart service: `pkill -f fast_lpr_capture`
2. Check for memory leaks in logs
3. Reduce `limit` parameter in `get_events()` call (currently 100)
4. Increase poll interval in `asyncio.sleep()` (currently 5 seconds)

---

## Section 4: Performance Monitoring

### 4.1 Service Health Check

Run daily:
```bash
#!/bin/bash

echo "=== LPR Service Health Check ==="
echo ""

# 1. Is service running?
if pgrep -f fast_lpr_capture > /dev/null; then
    echo "✓ Service: RUNNING"
else
    echo "✗ Service: STOPPED"
    exit 1
fi

# 2. Recent captures?
RECENT=$(mongosh --quiet << 'EOF'
use web-portal
db.license_plates.countDocuments({
    timestamp: { $gte: new Date(Date.now() - 3600000) }
})
EOF
)
echo "✓ Plates captured (last hour): $RECENT"

# 3. Database size
SIZE=$(mongosh --quiet << 'EOF'
use web-portal
db.license_plates.stats().avgObjSize * db.license_plates.count()
EOF
)
echo "✓ Database size: ${SIZE} bytes"

# 4. Latest plate
LATEST=$(mongosh --quiet << 'EOF'
use web-portal
db.license_plates.findOne({}, {sort: {timestamp: -1}}).license_plate
EOF
)
echo "✓ Latest plate captured: $LATEST"

echo ""
echo "=== Health Check Complete ==="
```

### 4.2 Resource Monitoring

```bash
# Memory usage
ps aux | grep fast_lpr_capture | grep -v grep | awk '{print "Memory: " $6 " KB"}'

# CPU usage
top -l 1 | grep fast_lpr_capture | head -1

# Open connections
lsof -p $(pgrep -f fast_lpr_capture)
```

---

## Section 5: Maintenance Tasks

### 5.1 Log Rotation (if using nohup)

```bash
# Create logrotate config
cat > /etc/logrotate.d/lpr-capture << 'EOF'
/path/to/web-portal/lpr_capture.log {
    daily
    rotate 7
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
}
EOF

# Test
logrotate -d /etc/logrotate.d/lpr-capture
```

### 5.2 Database Cleanup

```bash
# Delete plates older than 90 days
mongosh << 'EOF'
use web-portal
db.license_plates.deleteMany({
    timestamp: { $lt: new Date(Date.now() - 90*24*3600*1000) }
})
EOF

# Or auto-delete with TTL index
mongosh << 'EOF'
use web-portal
db.license_plates.createIndex(
    { detected_at: 1 },
    { expireAfterSeconds: 7776000 }
)
EOF
```

### 5.3 Backup MongoDB Collection

```bash
# Export to JSON
mongoexport --db web-portal --collection license_plates \
    --out license_plates_backup.json

# Import from JSON
mongoimport --db web-portal --collection license_plates \
    --file license_plates_backup.json
```

---

## Section 6: Testing Queries

### 6.1 Test All API Endpoints

```bash
#!/bin/bash

BASE_URL="http://localhost:3000"

echo "Testing LPR API Endpoints..."
echo ""

echo "1. Get all plates:"
curl -s "$BASE_URL/api/license-plates" | jq '.total'
echo ""

echo "2. Get statistics:"
curl -s "$BASE_URL/api/license-plates/stats" | jq '.unique_plates'
echo ""

echo "3. Search for plate ABC123:"
curl -s "$BASE_URL/api/license-plates/search/ABC123" | jq '.found'
echo ""

echo "4. Service status:"
curl -s "$BASE_URL/api/license-plates/status" | jq '.status'
echo ""

echo "Test complete!"
```

### 6.2 MongoDB Direct Queries

```javascript
// Count total plates
db.license_plates.countDocuments({})

// Average confidence
db.license_plates.aggregate([
    { $group: { _id: null, avg: { $avg: "$confidence" } } }
])

// Plates by camera
db.license_plates.aggregate([
    { $group: { _id: "$camera_name", count: { $sum: 1 } } }
])

// High-confidence detections
db.license_plates.find({ confidence: { $gte: 95 } }).count()

// Search by date range
db.license_plates.find({
    timestamp: {
        $gte: new Date("2025-12-31"),
        $lt: new Date("2026-01-01")
    }
})
```

---

## Section 7: Emergency Recovery

### 7.1 Service Crashed - Recovery Steps

```bash
# 1. Check what happened
tail -50 lpr_capture.log

# 2. Verify dependencies still installed
pip list | grep -E "uiprotect|pymongo"

# 3. Test Protect connectivity
python3 << 'EOF'
# Run the connectivity test from Section 1.1
EOF

# 4. Restart service
pkill -f fast_lpr_capture
nohup python3 fast_lpr_capture.py > lpr_capture.log 2>&1 &

# 5. Verify it's running
sleep 5
tail lpr_capture.log
```

### 7.2 Database Corrupted - Recovery Steps

```bash
# 1. Create backup first
mongoexport --db web-portal --collection license_plates \
    --out license_plates_backup.json

# 2. Recreate collection
mongosh << 'EOF'
use web-portal
db.license_plates.drop()
EOF

# 3. Restore from backup if needed
mongoimport --db web-portal --collection license_plates \
    --file license_plates_backup.json

# 4. Verify
mongosh << 'EOF'
use web-portal
db.license_plates.countDocuments({})
EOF
```

---

## Section 8: Escalation Checklist

If issues persist after troubleshooting:

1. Collect logs: `tar czf lpr_logs.tar.gz lpr_capture.log server.log`
2. Export database: `mongoexport --db web-portal --collection license_plates`
3. Document environment:
   - OS version
   - Python version: `python3 --version`
   - Package versions: `pip list | grep -E "uiprotect|pymongo"`
   - Protect version (from Protect UI)
   - MongoDB version: `mongosh --eval "db.version()"`
4. Provide: Logs, error messages, hardware specs, environment details

