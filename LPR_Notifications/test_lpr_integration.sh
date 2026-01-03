#!/bin/bash

echo "🔍 LPR Integration Test"
echo "======================"
echo ""

# Test 1: Python service connectivity
echo "1. Testing Python service connectivity..."
.venv/bin/python << 'PYTHON'
import asyncio, os
os.environ['UNIFI_PROTECT_API_KEY'] = 'VU2VgiOnHzLZOX3dTEZFUvF_hztIW3b_'
os.environ['UNIFI_PROTECT_USERNAME'] = 'protect_test_user'
os.environ['UNIFI_PROTECT_PASSWORD'] = 'asdfSD353--sd'

async def test():
    from uiprotect import ProtectApiClient
    protect = ProtectApiClient(host=os.getenv('UNIFI_PROTECT_HOST'), port=int(os.getenv('UNIFI_PROTECT_PORT', 443)), username=os.getenv('UNIFI_PROTECT_USERNAME'), password=os.getenv('UNIFI_PROTECT_PASSWORD'), verify_ssl=os.getenv('UNIFI_PROTECT_VERIFY_SSL','true'), api_key=os.getenv('UNIFI_PROTECT_API_KEY'))
    await protect.update()
    lpr = [c for c in protect.bootstrap.cameras.values() if c.type == 'UVC AI LPR']
    print(f"   ✓ Found {len(lpr)} LPR cameras")
    for c in lpr:
        print(f"     • {c.name}: detection={'enabled' if c.is_license_plate_detection_on else 'disabled'}")

asyncio.run(test())
PYTHON

# Test 2: MongoDB connectivity
echo ""
echo "2. Testing MongoDB connectivity..."
.venv/bin/python << 'PYTHON'
from pymongo import MongoClient
try:
    mongo_url = os.getenv('MONGO_URL')
    if not mongo_url:
        echo "Error: MONGO_URL not set. See .env.example"
        exit 1
    client = MongoClient(mongo_url)
    db = client['web-portal']
    count = db['license_plates'].count_documents({})
    print(f"   ✓ MongoDB connected")
    print(f"     • License plates stored: {count}")
except Exception as e:
    print(f"   ✗ MongoDB error: {e}")
PYTHON

# Test 3: API endpoints
echo ""
echo "3. Testing API endpoints..."
if curl -s http://localhost:3000/api/license-plates/status > /dev/null 2>&1; then
    echo "   ✓ API endpoints responding"
    TOTAL=$(curl -s http://localhost:3000/api/license-plates/status | grep -o '"all_time":[0-9]*' | cut -d: -f2)
    echo "     • Total detections in database: $TOTAL"
else
    echo "   ✗ API endpoints not responding (start Node.js server)"
fi

echo ""
echo "✅ LPR Integration test complete!"
echo ""
echo "To start the LPR service:"
echo "  ./start_lpr_service.sh"
echo ""
echo "To test capturing a plate:"
echo "  1. Start the service: ./start_lpr_service.sh"
echo "  2. Drive a vehicle past an LPR camera"
echo "  3. Query API: curl http://localhost:3000/api/license-plates"
