#!/bin/sh
# unraid_entrypoint.sh - wrapper for Unraid template command
# Ensures dependencies then runs provided command (default: --catchup)

set -eu

# Run dependency installer (idempotent)
if [ -x /app/docker/ensure_deps.sh ]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) - unraid_entrypoint: running ensure_deps" >&2
  /app/docker/ensure_deps.sh || echo "ensure_deps failed; continuing" >&2
else
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) - unraid_entrypoint: /app/docker/ensure_deps.sh not found or not executable" >&2
fi

# Execute passed command or default to --catchup behavior
CONTAINER_CMD=${CONTAINER_CMD:---catchup}

# If user provided a command string, eval it; otherwise run default service
if [ "${1:-}" = "--" ]; then
  shift
fi

if [ "$#" -gt 0 ]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) - unraid_entrypoint: executing user cmd: $*" >&2
  exec "$@"
else
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) - unraid_entrypoint: executing default: $CONTAINER_CMD" >&2
  # default behavior: exec container command
  # allow simple flags like --catchup
  case "$CONTAINER_CMD" in
    --catchup)
      # run the household startup (existing logic may vary) - fallback to original entrypoint if present
      if [ -x /app/docker/entrypoint.sh ]; then
        exec /app/docker/entrypoint.sh --catchup
      else
        echo "No /app/docker/entrypoint.sh found; nothing to start" >&2
        exec sh
      fi
      ;;
    *)
      # execute as shell words
      set -- $CONTAINER_CMD
      exec "$@"
      ;;
  esac
fi
