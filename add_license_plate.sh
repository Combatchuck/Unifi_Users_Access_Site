#!/bin/sh

EMAIL="$1"
NEW_PLATE="$2"

if [ -z "$EMAIL" ] || [ -z "$NEW_PLATE" ]; then
  echo "Usage: $0 <email> <new_license_plate>"
  exit 1
fi

if [ -z "$UNIFA_API_URL" ] || [ -z "$UNIFA_BEARER_TOKEN" ]; then
    echo "Error: UNIFA_API_URL or UNIFA_BEARER_TOKEN is not set."
    exit 1
fi

API_URL="${UNIFA_API_URL}/api/v1/developer/users"
AUTH_HEADER="Authorization: Bearer $UNIFA_BEARER_TOKEN"
CONTENT_TYPE_HEADER="Content-Type: application/json"

USER_ID=$(curl -s -k --connect-timeout 10 --max-time 30 "${API_URL}" -H "${AUTH_HEADER}" | jq -r --arg email "$EMAIL" '.data[] | select((.email | ascii_downcase) == ($email | ascii_downcase) or (.user_email | ascii_downcase) == ($email | ascii_downcase)) | .id')

if [ -z "$USER_ID" ] || [ "$USER_ID" == "null" ]; then
  echo "Error: User with email ${EMAIL} not found."
  exit 1
fi

UPDATED_PLATES_ARRAY="[\"${NEW_PLATE}\"]"

PUT_RESPONSE=$(curl -s -k --connect-timeout 10 --max-time 30 -X PUT "${API_URL}/${USER_ID}/license_plates" \
  -H "${AUTH_HEADER}" \
  -H "${CONTENT_TYPE_HEADER}" \
  --data-raw "${UPDATED_PLATES_ARRAY}")

if echo "${PUT_RESPONSE}" | grep -q '"code":"SUCCESS"'; then
  echo "License plate ${NEW_PLATE} added successfully for user ${EMAIL}."
  exit 0
elif echo "${PUT_RESPONSE}" | grep -q '"code":"CODE_CREDS_LICENSE_PLATE_ALREADY_EXIST"'; then
  echo "Error: License plate ${NEW_PLATE} already exists in the system. Please enter a different one."
  exit 1
else
  echo "Error updating license plates. Response: ${PUT_RESPONSE}"
  exit 1
fi
