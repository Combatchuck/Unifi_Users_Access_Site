#!/bin/sh

# Configuration
# Use environment variables for HOST and TOKEN
if [ -z "$UNIFA_SITE2_API_URL" ] || [ -z "$UNIFA_SITE2_BEARER_TOKEN" ]; then
    echo "Error: UNIFA_SITE2_API_URL or UNIFA_SITE2_BEARER_TOKEN is not set."
    exit 1
fi

API_URL="${UNIFA_SITE2_API_URL}/api/v1/developer/users"
AUTH_HEADER="Authorization: Bearer $UNIFA_SITE2_BEARER_TOKEN"
HOST=$(echo "$UNIFA_SITE2_API_URL" | sed -E 's|https?://([^:/]+).*|\1|')

USER_ID_INPUT="$1" # Pass the User ID as the first argument
USER_EMAIL="$2" # Optional: Pass email as second argument

if [ -z "$USER_ID_INPUT" ]; then
    echo "Usage: $0 <user_id> [optional_email]"
    exit 1
fi

# If email is provided, perform a lookup to ensure we have the correct ID for this site
if [ -n "$USER_EMAIL" ]; then
    echo "Verifying User ID for $USER_EMAIL on Site 2..."
    USER_ID=$(curl -s -k --connect-timeout 10 --max-time 30 "$API_URL" -H "$AUTH_HEADER" | jq -r --arg email "$USER_EMAIL" '.data[] | select((.email | ascii_downcase) == ($email | ascii_downcase) or (.user_email | ascii_downcase) == ($email | ascii_downcase)) | .id')
fi

# Fallback to input ID if lookup fails or email wasn't provided
USER_ID="${USER_ID:-$USER_ID_INPUT}"

# Construct the payload
PAYLOAD="[{\"user_id\": \"$USER_ID\"}]"

# Send the invitation POST request
echo "Sending UniFi Identity Invitation to User ID: $USER_ID (Email: ${USER_EMAIL:-N/A}) on Site 2..."
RESPONSE=$(curl -k -s --connect-timeout 10 --max-time 30 -X POST "https://${HOST}:12445/api/v1/developer/users/identity/invitations" \
    -H "$AUTH_HEADER" \
    -H "accept: application/json" \
    -H "content-type: application/json" \
    -d "$PAYLOAD")

# Parse response
if echo "$RESPONSE" | jq -e '.code == "SUCCESS"' > /dev/null; then
    echo "Invitation successfully triggered."
    exit 0
else
    echo "Failed to send invitation. Response:"
    echo "$RESPONSE" | jq .
    exit 1
fi
