#!/usr/bin/env bash
# Run monitor with sensible defaults
PYTHON=${PYTHON:-python3}
SCRIPT="$(dirname "$0")/monitor_write_errors.py"
$PYTHON "$SCRIPT" --minutes ${MINUTES:-15} --threshold ${THRESHOLD:-1}
