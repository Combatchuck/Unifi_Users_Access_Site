#!/bin/bash
# LPR Capture Service Deployment Script
# Starts the license plate recognition service in the background

set -e

LPR_DIR="/app/LPR_Notifications/"
VENV_PYTHON="$LPR_DIR/.venv/bin/python"
LOG_FILE="$LPR_DIR/lpr_capture.log"
PID_FILE="$LPR_DIR/lpr_capture.pid"

echo "=========================================="
echo "🚗 License Plate Recognition Service"
echo "=========================================="
echo ""

# Check if service is already running
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "✓ Service already running (PID: $OLD_PID)"
        echo ""
        echo "To stop the service:"
        echo "  kill $OLD_PID"
        exit 0
    else
        rm "$PID_FILE"
    fi
fi

# Start the service
echo "Starting LPR capture service..."
nohup "$VENV_PYTHON" "$LPR_DIR/fast_lpr_capture.py" > "$LOG_FILE" 2>&1 &
SERVICE_PID=$!

# Save PID
echo $SERVICE_PID > "$PID_FILE"

# Wait a moment for startup
sleep 2

# Check if service started successfully
if kill -0 $SERVICE_PID 2>/dev/null; then
    echo "✓ Service started successfully (PID: $SERVICE_PID)"
    echo ""
    echo "Monitoring 2 LPR Cameras:"
    echo "  • LPR Camera Right"
    echo "  • LPR Camera Left"
    echo ""
    echo "MongoDB Collection: license_plates"
    echo "Log File: $LOG_FILE"
    echo ""
    echo "API Endpoints:"
    echo "  GET  /api/license-plates"
    echo "  GET  /api/license-plates/stats"
    echo "  GET  /api/license-plates/search/:plate"
    echo "  GET  /api/license-plates/status"
    echo ""
    echo "To view logs:"
    echo "  tail -f $LOG_FILE"
    echo ""
    echo "To stop the service:"
    echo "  kill $SERVICE_PID"
else
    echo "✗ Failed to start service"
    echo "Check logs: $LOG_FILE"
    exit 1
fi
