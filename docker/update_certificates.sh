#!/bin/sh

CERT_DOMAINS_FILE="/dstore/domains.txt"
RELOAD_NEEDED=0

if [ -z "$1" ]; then
    echo "Domain name not provided"
    exit 1
fi

REQUESTING_DOMAIN=$(echo "$1" | awk '{print tolower($0)}')

if ! grep -q "$REQUESTING_DOMAIN" $CERT_DOMAINS_FILE; then
    echo "$REQUESTING_DOMAIN" >> $CERT_DOMAINS_FILE
    echo "Adding $REQUESTING_DOMAIN to the certificate."

    # Gather all domains for renewal
    DOMAINS=$(paste -sd "," $CERT_DOMAINS_FILE)

    # Use certbot to renew certificates
    certbot certonly --standalone -d "$DOMAINS" --email dstore@f2p.li --agree-tos --non-interactive --expand
    RELOAD_NEEDED=1
fi

# COPY EVERYTHING TO /dstore/cert/
LIVE_PATH="/etc/letsencrypt/live"
DST_PATH="/dstore/cert"

for DOMAIN in $(cat $CERT_DOMAINS_FILE); do
    mkdir -p "$DST_PATH/$DOMAIN"
    for FILE in privkey.pem cert.pem chain.pem; do
        if [ -f "$LIVE_PATH/$DOMAIN/$FILE" ]; then
            cp "$LIVE_PATH/$DOMAIN/$FILE" "$DST_PATH/$DOMAIN/$FILE"
        fi
    done
done

if [ $RELOAD_NEEDED -eq 1 ]; then
    echo "Certificates updated. Restarting application to apply changes."
    # Add code here to restart your server if needed
fi
