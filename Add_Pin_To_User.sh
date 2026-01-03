#!/bin/sh

# API variables
if [ -z "$UNIFA_API_URL" ] || [ -z "$UNIFA_BEARER_TOKEN" ]; then
    echo "Error: UNIFA_API_URL or UNIFA_BEARER_TOKEN is not set."
    exit 1
fi

API_URL="${UNIFA_API_URL}/api/v1/developer/users"
AUTH_HEADER="Authorization: Bearer $UNIFA_BEARER_TOKEN"

# Input variables
EMAIL="$1"
NEW_PIN="$2"

# Validate input
if [ -z "$EMAIL" ] || [ -z "$NEW_PIN" ]; then
    echo "Usage: $0 <email> <new_pin>"
    exit 1
fi

# Fetch user ID based on email
USER_ID=$(curl -s -k --connect-timeout 10 --max-time 30 "$API_URL" -H "$AUTH_HEADER" | jq -r --arg email "$EMAIL" '.data[] | select((.email | ascii_downcase) == ($email | ascii_downcase) or (.user_email | ascii_downcase) == ($email | ascii_downcase)) | .id')

# Check if user was found
if [ -z "$USER_ID" ] || [ "$USER_ID" = "null" ]; then
    echo "User with email '$EMAIL' not found."
    exit 1
fi

echo "Found User ID: $USER_ID"

# Update user's PIN
UPDATE_RESPONSE=$(curl -k -s --connect-timeout 10 --max-time 30 -X PUT "$API_URL/$USER_ID" -H "$AUTH_HEADER" -H "Content-Type: application/json" --data-raw "{ \"pin_code\": \"$NEW_PIN\" }")

# Print response
echo "$UPDATE_RESPONSE"

# Check for success
if echo "$UPDATE_RESPONSE" | jq -e '.code == "SUCCESS"' > /dev/null; then
    echo "PIN successfully updated."
    exit 0
else
    echo "Failed to update PIN."
    exit 1
fi
