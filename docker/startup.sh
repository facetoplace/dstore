#!/bin/sh

# Check if required environment variables are set
if [ -z "$DOMAIN" ]; then
    echo "The DOMAIN environment variable must be set"
    exit 1
fi

# Write environment variables to the .env file
echo "DOMAIN=$DOMAIN" > /app/.env

# Check and create initial certificates if needed
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    certbot certonly --standalone -d "$DOMAIN" --email dstore@f2p.me --agree-tos --non-interactive --expand
fi

# Start the server
node /app/server.js
