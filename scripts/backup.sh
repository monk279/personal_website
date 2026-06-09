#!/bin/sh
set -eu

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p /backups

if [ -n "${DATABASE_URL:-}" ]; then
  pg_dump "$DATABASE_URL" | gzip > "/backups/postgres-${stamp}.sql.gz"
fi

tar -czf "/backups/static-${stamp}.tar.gz" -C /site .
if [ -d /uploads ]; then
  tar -czf "/backups/uploads-${stamp}.tar.gz" -C /uploads .
fi
find /backups -type f -mtime +14 -delete
