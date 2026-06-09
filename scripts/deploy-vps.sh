#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/zhaohe-site}"
BRANCH="${BRANCH:-main}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Install Docker Engine and the Compose plugin first." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is not available. Install docker compose first." >&2
  exit 1
fi

cd "$APP_DIR"

if [ ! -f ".env" ]; then
  echo "Missing $APP_DIR/.env. Create it from .env.example before deploying." >&2
  exit 1
fi

if ! grep -q "^POSTGRES_PASSWORD=.\+" .env; then
  echo "POSTGRES_PASSWORD is missing in .env." >&2
  exit 1
fi

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

mkdir -p public/uploads backups

docker compose up -d --build
docker compose exec app bun run db:migrate
docker compose exec app bun run db:seed
docker compose ps

echo
echo "Deployment finished. Verify:"
echo "  curl -I https://zhaohe.me"
echo "  curl -fsS https://zhaohe.me/api/health"
echo "  docker compose logs --tail=100 caddy"
