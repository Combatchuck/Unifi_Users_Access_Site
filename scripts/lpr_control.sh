#!/bin/sh
# Simple LPR control helper
# Usage: lpr_control.sh start|stop|restart|status

set -eu

ACTION="$1" || ACTION="status"
PIDFILE="/var/run/lpr_capture.pid"
LOGFILE="/var/log/lpr_capture.log"
SCRIPT="/mnt/user/Docker_Mounts/neighborhood_app/Dev/web-portal-dev/LPR_Notifications/lpr_capture_v3.py"

# If a docker container with lpr in the name exists, prefer docker control
DOCKER_NAME=$(docker ps -a --format '{{.Names}}' | egrep -i 'lpr|lpr_capture|lpr_micro' | head -n1 || true)

status_container() {
  if [ -n "$DOCKER_NAME" ]; then
    docker ps --filter "name=$DOCKER_NAME" --format 'Name={{.Names}} Status={{.Status}}' || true
  else
    if [ -f "$PIDFILE" ]; then
      PID=$(cat "$PIDFILE")
      if kill -0 "$PID" 2>/dev/null; then
        echo "Name=local_lpr Status=running PID=$PID"
      else
        echo "Name=local_lpr Status=stopped"
      fi
    else
      echo "Name=local_lpr Status=stopped"
    fi
  fi
}

case "$ACTION" in
  start)
    if [ -n "$DOCKER_NAME" ]; then
      docker start "$DOCKER_NAME"
      exit $?
    fi
    if [ -f "$PIDFILE" ]; then
      PID=$(cat "$PIDFILE") || true
      if kill -0 "$PID" 2>/dev/null; then
        echo "Already running (PID=$PID)" && exit 0
      fi
    fi
    nohup python3 "$SCRIPT" > "$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
    echo "Started local LPR service, PID=$(cat $PIDFILE)"
    ;;
  stop)
    if [ -n "$DOCKER_NAME" ]; then
      docker stop "$DOCKER_NAME"
      exit $?
    fi
    if [ -f "$PIDFILE" ]; then
      PID=$(cat "$PIDFILE")
      kill "$PID" || true
      rm -f "$PIDFILE"
      echo "Stopped local LPR service (killed PID $PID)"
    else
      echo "No PIDFILE; not running"
    fi
    ;;
  restart)
    $0 stop || true
    sleep 1
    $0 start
    ;;
  status)
    status_container
    ;;
  *)
    echo "Usage: $0 start|stop|restart|status"
    exit 2
    ;;
esac
