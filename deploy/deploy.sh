#!/usr/bin/env bash
# Deploy Screener on the host that runs nginx.
#
# Run this ON THE VM (not inside the Hermes container). It clones or updates the repo,
# builds the image, recreates the container on 8643, and verifies the auth gate.
#
# Usage:
#   ./deploy/deploy.sh                       # clone/update + build + up + verify
#   REPO_DIR=/srv/Screener ./deploy/deploy.sh
#
# TLS: install deploy/nginx/screener.conf, get a certificate, confirm https works,
# and only then set SCREENER_COOKIE_SECURE=1 in the compose environment. Enabling it
# while the site is still plain HTTP makes login loop forever.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/SyahrurRohmaann/Screener.git}"
REPO_DIR="${REPO_DIR:-$HOME/Screener}"
PORT="${PORT:-8643}"
CONTAINER="${CONTAINER:-screener_dashboard}"
VOLUME="${VOLUME:-screener_data}"
IMAGE="${IMAGE:-screener-dashboard:latest}"

say() { printf '\n== %s\n' "$1"; }

say "Repo"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" fetch origin main
  git -C "$REPO_DIR" checkout main
  git -C "$REPO_DIR" reset --hard origin/main
else
  git clone "$REPO_URL" "$REPO_DIR"
fi
git -C "$REPO_DIR" --no-pager log -1 --oneline

say "Snapshot token"
# The snapshot endpoint fails closed without a token. Generate one once and keep it.
TOKEN_FILE="$REPO_DIR/.snapshot-token"
if [ ! -s "$TOKEN_FILE" ]; then
  head -c 32 /dev/urandom | base64 | tr -d '\n=/+' > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  echo "generated $TOKEN_FILE"
else
  echo "reusing $TOKEN_FILE"
fi
SNAPSHOT_TOKEN="$(cat "$TOKEN_FILE")"

say "Build"
docker build -t "$IMAGE" "$REPO_DIR"

say "Volume"
docker volume create "$VOLUME" >/dev/null
echo "$VOLUME ready"

say "Recreate container"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -p "127.0.0.1:${PORT}:3000" \
  -v "${VOLUME}:/data" \
  -e NODE_ENV=production \
  -e SCREENER_DATA_DIR=/data \
  -e SCREENER_MIN_SCORE=4 \
  -e SCREENER_FEE_PCT=0.1 \
  -e RANKING_SNAPSHOT_TOKEN="$SNAPSHOT_TOKEN" \
  "$IMAGE" >/dev/null
docker ps --filter "name=$CONTAINER" --format '{{.Names}} {{.Status}} {{.Ports}}'

say "Wait for readiness"
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/login"; then echo "up after ${i}s"; break; fi
  sleep 1
  [ "$i" = 30 ] && { echo "did not become ready"; docker logs --tail 40 "$CONTAINER"; exit 1; }
done

say "Verify the auth gate"
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
printf 'login page      %s (expect 200)\n' "$(code "http://127.0.0.1:${PORT}/login")"
printf 'root redirect   %s (expect 307)\n' "$(code "http://127.0.0.1:${PORT}/")"
printf 'api anonymous   %s (expect 401)\n' "$(code "http://127.0.0.1:${PORT}/api/market")"
printf 'ranking api     %s (expect 401)\n' "$(code "http://127.0.0.1:${PORT}/api/ranking/preview")"

say "Done"
cat <<EOF
Container listens on 127.0.0.1:${PORT} only, so it is not reachable from the internet
until nginx proxies it. Next steps:

  1. sudo cp $REPO_DIR/deploy/nginx/screener.conf /etc/nginx/sites-available/screener
     (edit server_name and certificate paths first)
  2. sudo ln -s /etc/nginx/sites-available/screener /etc/nginx/sites-enabled/screener
  3. sudo nginx -t && sudo systemctl reload nginx
  4. sudo certbot --nginx -d your.domain
  5. confirm https loads, THEN add -e SCREENER_COOKIE_SECURE=1 and re-run this script

Initial password: 098123plm  — change it from the AKUN panel after first login.
Snapshot token stored at $TOKEN_FILE
EOF
