FROM node:alpine

WORKDIR /app

COPY package*.json ./
RUN npm install
COPY . .

# Installing certbot for certificate management
RUN apk add --no-cache certbot

COPY update_certificates.sh /usr/local/bin/update_certificates.sh
RUN chmod +x /usr/local/bin/update_certificates.sh

COPY startup.sh /usr/local/bin/startup.sh
RUN chmod +x /usr/local/bin/startup.sh

RUN mkdir -p /dstore && touch /dstore/domains.txt

EXPOSE 80 443

# Startup will be handled via our initialization script
CMD ["sh", "/usr/local/bin/startup.sh"]
