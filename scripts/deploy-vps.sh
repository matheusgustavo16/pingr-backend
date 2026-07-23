#!/usr/bin/env bash
# Build TS locally, ship only dist/ + prisma/ + manifests to the VPS.
# npm ci only runs remotely when package-lock.json actually changed
# (avoids recompiling mediasoup's native worker on every deploy).
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$BACKEND_DIR/.." && pwd)"
CONFIG_FILE="$REPO_ROOT/backend-vps.txt"

VPS_PATH="/opt/pingr-backend"
SERVICE="pingr-backend"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "missing $CONFIG_FILE (expected: line1=pem path, line2=vps ip)" >&2
  exit 1
fi

PEM_KEY="$(sed -n '1p' "$CONFIG_FILE" | tr -d '\r"')"
VPS_IP="$(sed -n '2p' "$CONFIG_FILE" | tr -d '\r')"
VPS_HOST="root@${VPS_IP}"

cd "$BACKEND_DIR"

echo "==> local build"
npm run build

echo "==> packing artifacts"
TMP_TAR="$(mktemp -u).tar.gz"
tar czf "$TMP_TAR" dist package.json package-lock.json prisma prisma.config.ts
trap 'rm -f "$TMP_TAR"' EXIT

echo "==> uploading"
scp -i "$PEM_KEY" -o StrictHostKeyChecking=accept-new "$TMP_TAR" "$VPS_HOST:/tmp/pingr-deploy.tar.gz"

echo "==> remote deploy"
ssh -i "$PEM_KEY" -o StrictHostKeyChecking=accept-new "$VPS_HOST" VPS_PATH="$VPS_PATH" SERVICE="$SERVICE" bash -s <<'REMOTE'
set -euo pipefail
cd "$VPS_PATH"

OLD_HASH="$(sha256sum package-lock.json 2>/dev/null | awk '{print $1}')"

BACKUP="dist.bak.$(date +%Y%m%d%H%M%S)"
[ -d dist ] && mv dist "$BACKUP"

tar xzf /tmp/pingr-deploy.tar.gz
rm -f /tmp/pingr-deploy.tar.gz

NEW_HASH="$(sha256sum package-lock.json | awk '{print $1}')"

if [ "$OLD_HASH" != "$NEW_HASH" ]; then
  echo "lockfile changed -> npm ci"
  npm ci
else
  echo "lockfile unchanged -> skip npm ci"
fi

npx prisma migrate deploy
# npm ci only regenerates the client via postinstall when it actually runs;
# schema.prisma can change without the lockfile changing, so always regenerate.
npx prisma generate

# keep last 3 dist backups
ls -dt dist.bak.* 2>/dev/null | tail -n +4 | xargs -r rm -rf

systemctl restart "$SERVICE"
sleep 2
systemctl is-active "$SERVICE"
tail -5 /var/log/pingr-backend.log
REMOTE

echo "==> done"
