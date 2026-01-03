#!/bin/bash
# force_delete_visitor_plate.sh
# Usage: ./force_delete_visitor_plate.sh <visitor_id> <plate>

VISITOR_ID="$1"
PLATE="$2"

if [ -z "$VISITOR_ID" ] || [ -z "$PLATE" ]; then
  echo "Usage: $0 <visitor_id> <plate>"
  exit 1
fi

if [ -z "$UNIFA_API_URL" ] || [ -z "$UNIFA_BEARER_TOKEN" ]; then
  echo "Error: UNIFA_API_URL or UNIFA_BEARER_TOKEN is not set. See .env.example"
  exit 1
fi

API_URL="${UNIFA_API_URL}/api/v1/developer/visitors/$VISITOR_ID/license-plates/$PLATE"
AUTH_HEADER="Authorization: Bearer $UNIFA_BEARER_TOKEN"

RESPONSE=$(curl -sS --fail -k -X DELETE "$API_URL" -H "$AUTH_HEADER" 2>&1 || true)

if echo "$RESPONSE" | grep -qi 'success'; then
  echo "Plate $PLATE removed successfully from visitor $VISITOR_ID."
  exit 0
else
  if [ "$DEBUG_API" = "true" ]; then
    echo "Failed to remove plate $PLATE from visitor $VISITOR_ID. Response: $RESPONSE"
  else
    echo "Failed to remove plate $PLATE from visitor $VISITOR_ID."
  fi
  exit 1
fi
