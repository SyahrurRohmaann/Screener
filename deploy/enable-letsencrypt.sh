#!/usr/bin/env bash
# Switch Screener from the self-signed IP certificate to Let's Encrypt for a domain.
#
# Run ON THE VPS as the ubuntu user:
#   bash ~/Screener/deploy/enable-letsencrypt.sh scansignal.my.id
#
# Preconditions the script checks before touching nginx:
#   1. the domain's A record resolves to this server's public IP
#   2. port 80 reaches this nginx (Let's Encrypt validates over plain HTTP)
# It refuses to continue otherwise, because a failed validation counts against
# Let's Encrypt's hourly failure limit and leaves nginx half-configured.

set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "usage: bash enable-letsencrypt.sh <domain> [extra-domain ...]" >&2
  exit 2
fi
shift
EXTRA=("$@")

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$HOME/ai-stack/docker-compose.yml}"

echo "== 1/6 checking DNS"
SERVER_IP="$(curl -fsS --max-time 10 https://ifconfig.me)"
DOMAIN_IP="$(getent hosts "$DOMAIN" | awk '{print $1; exit}' || true)"
echo "   this server : $SERVER_IP"
echo "   $DOMAIN -> ${DOMAIN_IP:-<tidak resolve>}"
if [ "$DOMAIN_IP" != "$SERVER_IP" ]; then
  cat >&2 <<EOF

REFUSING TO CONTINUE: $DOMAIN does not point at this server.

Set an A record for $DOMAIN to $SERVER_IP at your DNS provider, wait for it to
propagate, then run this script again. Let's Encrypt validates by fetching
http://$DOMAIN/.well-known/acme-challenge/... over port 80, so the record must
resolve here first.
EOF
  exit 1
fi

echo "== 2/6 checking that port 80 reaches this nginx"
sudo mkdir -p /var/www/html/.well-known/acme-challenge
TOKEN="hermes-precheck-$(date +%s)"
echo "$TOKEN" | sudo tee "/var/www/html/.well-known/acme-challenge/$TOKEN" >/dev/null
GOT="$(curl -fsS --max-time 15 "http://$DOMAIN/.well-known/acme-challenge/$TOKEN" || true)"
sudo rm -f "/var/www/html/.well-known/acme-challenge/$TOKEN"
if [ "$GOT" != "$TOKEN" ]; then
  echo "REFUSING TO CONTINUE: could not fetch the ACME test file over http://$DOMAIN." >&2
  echo "Open port 80 in the firewall/security group and make sure nginx serves it." >&2
  exit 1
fi
echo "   ACME path reachable"

echo "== 3/6 installing certbot if needed"
if ! command -v certbot >/dev/null; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx
fi
certbot --version

echo "== 4/6 requesting the certificate"
ARGS=(--nginx --non-interactive --agree-tos --redirect -d "$DOMAIN")
for d in "${EXTRA[@]}"; do ARGS+=(-d "$d"); done
if [ -n "${CERTBOT_EMAIL:-}" ]; then ARGS+=(-m "$CERTBOT_EMAIL"); else ARGS+=(--register-unsafely-without-email); fi
sudo certbot "${ARGS[@]}"

echo "== 5/6 installing the domain vhost"
sudo cp "$REPO_DIR/deploy/nginx/screener.conf" /etc/nginx/sites-available/screener
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/screener /etc/nginx/sites-enabled/screener
sudo nginx -t
sudo systemctl reload nginx

echo "== 6/6 verifying"
curl -sI "http://$DOMAIN/" | head -1
curl -sI "https://$DOMAIN/login" | head -1
echo "cert expiry:"; sudo certbot certificates 2>/dev/null | grep -A1 "$DOMAIN" | head -4
echo "renewal dry run:"; sudo certbot renew --dry-run 2>&1 | tail -3

cat <<EOF

Done. Open https://$DOMAIN

If SCREENER_COOKIE_SECURE is not yet "1" in $COMPOSE_FILE, set it now and run:
  cd \$(dirname "$COMPOSE_FILE") && docker compose up -d --force-recreate screener-dashboard
EOF
