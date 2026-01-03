#!/bin/sh

EMAIL=$1
PLATE=$2

if [ -z "$EMAIL" ] || [ -z "$PLATE" ]; then
  echo "Usage: $0 <email> <plate>"
  exit 1
fi

if [ -z "$UNIFA_API_URL" ] || [ -z "$UNIFA_BEARER_TOKEN" ]; then
    echo "Error: UNIFA_API_URL or UNIFA_BEARER_TOKEN is not set."
    exit 1
fi

API_URL="${UNIFA_API_URL}/api/v1/developer/users"
AUTH_HEADER="Authorization: Bearer $UNIFA_BEARER_TOKEN"

ALL_USERS_AND_PLATES_DATA=$(curl -s -k --connect-timeout 10 --max-time 30 "${API_URL}?expand[]=license_plates" -H "${AUTH_HEADER}")

if ! echo "${ALL_USERS_AND_PLATES_DATA}" | jq -e '.data | type == "array"' > /dev/null; then
  echo "Error: API did not return expected user data structure (with expanded plates) for email lookup."
  echo "API Response: ${ALL_USERS_AND_PLATES_DATA}"
  exit 1
fi

USER_AND_PLATE_INFO=$(echo "${ALL_USERS_AND_PLATES_DATA}" | jq -r --arg email "$EMAIL" --arg plate "$PLATE" '
  .data[] |
  select((.email | ascii_downcase) == ($email | ascii_downcase) or (.user_email | ascii_downcase) == ($email | ascii_downcase)) |
  {
    "userId": .id,
    "licensePlateId": (.license_plates[] | select(.credential | ascii_downcase == ($plate | ascii_downcase)) | .id)
  }
')

USER_ID=$(echo "${USER_AND_PLATE_INFO}" | jq -r '.userId')
LICENSE_PLATE_ID=$(echo "${USER_AND_PLATE_INFO}" | jq -r '.licensePlateId')

if [ -z "$USER_ID" ] || [ "$USER_ID" == "null" ]; then
  echo "Error: User with email $EMAIL not found."
  exit 1
fi

if [ -z "$LICENSE_PLATE_ID" ] || [ "$LICENSE_PLATE_ID" == "null" ]; then
  echo "Error: License plate $PLATE not found for user $EMAIL."
  exit 1
fi

REMOVE_RESPONSE=$(curl -s -k --connect-timeout 10 --max-time 30 -X DELETE \
  "${API_URL}/${USER_ID}/license_plates/${LICENSE_PLATE_ID}" \
  -H "${AUTH_HEADER}")

if echo "${REMOVE_RESPONSE}" | grep -q "error"; then
  echo "Error removing license plate: ${REMOVE_RESPONSE}"
  exit 1
else
  echo "License plate ${PLATE} removed successfully for user ${EMAIL}."
  exit 0
fi
