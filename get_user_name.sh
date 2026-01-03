#!/bin/sh

# API variables
if [ -z "$UNIFA_API_URL" ] || [ -z "$UNIFA_BEARER_TOKEN" ]; then
    echo "Error: UNIFA_API_URL or UNIFA_BEARER_TOKEN is not set."
    exit 1
fi

API_URL="${UNIFA_API_URL}/api/v1/developer/users"
AUTH_HEADER="Authorization: Bearer $UNIFA_BEARER_TOKEN"

# Input email
EMAIL="$1"

# Validate input
if [ -z "$EMAIL" ]; then
    echo "Usage: $0 <email>"
    exit 1
fi

# Fetch user name based on email
USER_NAME=$(curl -s -k --connect-timeout 10 --max-time 30 "$API_URL" -H "$AUTH_HEADER" | jq -r --arg email "$EMAIL" '.data[] | select((.email | ascii_downcase) == ($email | ascii_downcase) or (.user_email | ascii_downcase) == ($email | ascii_downcase)) | .name')

# Check if user was found
if [ -z "$USER_NAME" ] || [ "$USER_NAME" = "null" ]; then
    echo "User with email '$EMAIL' not found."
    exit 1
fi

# Print the user name
echo "$USER_NAME"
