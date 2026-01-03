#!/bin/sh
set -eu

# Simple container entrypoint to run multiple services and manage their lifecycle
# Starts:
#  - ./query_and_delete_completed_visitors.sh (background)
#  - python3 fast_lpr_capture.py (background)
#  - node index.js (foreground)

if [ -d /app ]; then
  SCRIPTDIR=/app
else
  SCRIPTDIR="$(pwd)"
fi
cd "$SCRIPTDIR"

# Ensure helper script is executable
if [ -f ./query_and_delete_completed_visitors.sh ]; then
  chmod +x ./query_and_delete_completed_visitors.sh
fi

PIDS=""

# Forward signals to children
term_handler() {
  echo "Entrypoint received termination, forwarding to children..."
  for pid in $PIDS; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  # give them a moment
  sleep 2
  exit 0
}
trap term_handler TERM INT

# Start the query/cleanup script in background (safe; it's short-lived)
Q_SCRIPT=""
if [ -f ./query_and_delete_completed_visitors.sh ]; then
  Q_SCRIPT="./query_and_delete_completed_visitors.sh"
elif [ -f ./scripts/query_and_delete_completed_visitors.sh ]; then
  Q_SCRIPT="./scripts/query_and_delete_completed_visitors.sh"
fi

if [ -n "$Q_SCRIPT" ]; then
  echo "Starting $Q_SCRIPT in background"
  nohup sh "$Q_SCRIPT" > /var/log/query_delete_completed_visitors.log 2>&1 &
  P1=$!
  PIDS="$PIDS $P1"
else
  echo "No query_and_delete_completed_visitors.sh found in either ./ or ./scripts/"
fi

# Optionally run a backfill catch-up before starting the main LPR capture service
CATCHUP_HOURS=${CATCHUP_HOURS:-24}
RUN_LPR_CATCHUP_ON_STARTUP=${RUN_LPR_CATCHUP_ON_STARTUP:-1}
CATCHUP_LOCK="/var/run/lpr_catchup.lock"

if [ -f ./backfill_protect_hours.py ] && [ "${RUN_LPR_CATCHUP_ON_STARTUP}" != "0" ]; then
  if [ -e "$CATCHUP_LOCK" ]; then
    echo "Catchup already in progress (lock $CATCHUP_LOCK), skipping"
  else
    echo "[entrypoint] Running ${CATCHUP_HOURS}-hour catch-up before starting main service..."
    touch "$CATCHUP_LOCK"
    # Run catchup synchronously and capture logs
    nohup python3 ./backfill_protect_hours.py "${CATCHUP_HOURS}" > /var/log/backfill_protect.log 2>&1 || echo "Catchup finished with non-zero exit (check /var/log/backfill_protect.log)"
    rm -f "$CATCHUP_LOCK"
  fi
fi

# Start the Python LPR capture service in background
if [ -f ./fast_lpr_capture.py ]; then
  echo "Starting fast_lpr_capture.py in background"
  python3 ./fast_lpr_capture.py >> /var/log/fast_lpr_capture.log 2>&1 &
  P2=$!
  PIDS="$PIDS $P2"
else
  echo "No fast_lpr_capture.py found"
fi

# Finally start Node in foreground (the main process)
if [ -f ./index.js ]; then
  echo "Starting node index.js (foreground)"
  # exec replaces shell with node process so it becomes PID 1
  exec node index.js
else
  echo "No index.js found; waiting on children"
  # Wait for any child to exit and then exit
  wait -n
  EXIT_STATUS=$?
  echo "Child exited with $EXIT_STATUS; bringing down remaining processes"
  for pid in $PIDS; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  exit $EXIT_STATUS
fi