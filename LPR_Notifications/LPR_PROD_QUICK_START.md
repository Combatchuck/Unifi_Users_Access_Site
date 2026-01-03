# LPR Production Deployment - Quick Reference

## One-Page Implementation Summary

### What Gets Deployed
1. **fast_lpr_capture.py** - Python service that captures license plates from Protect cameras
2. **MongoDB Collection** - `license_plates` with plate number, timestamp, and camera info
3. **4 REST API Endpoints** - Query, search, stats, and status monitoring

### Credentials Needed
```
Protect IP/Port: YOUR_NVR_IP:443
Protect Username: your_username
Protect Password: your_password
Protect API Key: your_api_key
MongoDB: mongodb_server:27017
Database: web-portal
```

### Installation Steps (5 minutes)

1. **Create .env file** with credentials
2. **Install Python packages**: `pip install uiprotect==7.33.3 pymongo python-dotenv`
3. **Copy fast_lpr_capture.py** to web-portal root
4. **Add API endpoints** to Express.js index.js
5. **Start service**: `python3 fast_lpr_capture.py` or use systemd

### MongoDB Schema
```json
{
  "_id": ObjectId,
  "event_id": "string",
  "license_plate": "ABC1234",      ← Plate number
  "timestamp": ISODate,             ← Date/time detected
  "camera_name": "LPR Camera Right",
  "camera_id": "string",
  "confidence": 95,
  "detected_at": ISODate
}
```

### Query Examples

**Get all plates (24 hours)**
```bash
curl http://localhost:3000/api/license-plates
```

**Search for specific plate**
```bash
curl http://localhost:3000/api/license-plates/search/ABC1234
```

**Get statistics**
```bash
curl http://localhost:3000/api/license-plates/stats
```

**Direct MongoDB query**
```javascript
db.license_plates.find({ camera_name: "LPR Camera Right" })
```

### Data Storage
- **Where**: MongoDB collection `license_plates`
- **What**: Plate number, timestamp, camera, confidence
- **Size**: ~500 bytes per detection
- **Query**: Via REST API or MongoDB direct

### Service Monitoring

**Check if running**
```bash
ps aux | grep fast_lpr_capture
```

**View logs**
```bash
tail -f lpr_capture.log
```

**Test API**
```bash
curl http://localhost:3000/api/license-plates/status
```

### Production Checklist
- [ ] Credentials in .env
- [ ] Python packages installed
- [ ] fast_lpr_capture.py copied
- [ ] API endpoints added to index.js
- [ ] Service started
- [ ] API tested with curl
- [ ] Logs verified
- [ ] Systemd service setup (optional but recommended)

### Default Configuration
- Poll interval: Every 5 seconds
- Camera filter: Only UVC AI LPR type
- Detection type: License plate only
- Database: web-portal
- Collection: license_plates

### Performance
- Memory: ~50-100 MB
- CPU: <1% idle
- Latency: <100ms API response
- Storage: ~500 bytes per plate

### Troubleshooting Quick Links
See **PROD_LPR_DEPLOYMENT.md** Part 7 for:
- Service won't start
- No plates being captured
- MongoDB connection fails
- API endpoints not responding

