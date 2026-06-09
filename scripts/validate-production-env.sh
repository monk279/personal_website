#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Create it from .env.example before deploying." >&2
  exit 1
fi

get_env() {
  local key="$1"
  awk -F= -v key="$key" '
    $0 !~ /^[[:space:]]*#/ && $1 == key {
      sub(/^[^=]*=/, "")
      if ($0 ~ /^'\''.*'\''$/ || $0 ~ /^".*"$/) {
        $0 = substr($0, 2, length($0) - 2)
      }
      print
      exit
    }
  ' "$ENV_FILE"
}

require_env() {
  local key="$1"
  local value
  value="$(get_env "$key")"
  if [ -z "$value" ]; then
    echo "$key is required in $ENV_FILE." >&2
    exit 1
  fi
  if printf '%s' "$value" | grep -Eq 'replace-with|your-|temporary-build-value'; then
    echo "$key still contains a template placeholder in $ENV_FILE." >&2
    exit 1
  fi
  printf '%s' "$value"
}

SITE_URL="$(require_env SITE_URL)"
DATABASE_URL="$(require_env DATABASE_URL)"
POSTGRES_PASSWORD="$(require_env POSTGRES_PASSWORD)"
SESSION_SECRET="$(require_env SESSION_SECRET)"
ADMIN_EMAIL="$(require_env ADMIN_EMAIL)"
ADMIN_PASSWORD_HASH="$(require_env ADMIN_PASSWORD_HASH)"
PORT="$(require_env PORT)"

if [ "$SITE_URL" != "https://zhaohe.me" ]; then
  echo "SITE_URL must be https://zhaohe.me for production." >&2
  exit 1
fi

case "$DATABASE_URL" in
  postgres://zhaohe:*@postgres:5432/zhaohe) ;;
  *)
    echo "DATABASE_URL must use postgres://zhaohe:<password>@postgres:5432/zhaohe." >&2
    exit 1
    ;;
esac

database_password="${DATABASE_URL#postgres://zhaohe:}"
database_password="${database_password%@postgres:5432/zhaohe}"

if [ "$database_password" != "$POSTGRES_PASSWORD" ]; then
  echo "DATABASE_URL password must match POSTGRES_PASSWORD." >&2
  exit 1
fi

if [ "${#POSTGRES_PASSWORD}" -lt 24 ]; then
  echo "POSTGRES_PASSWORD should be at least 24 characters." >&2
  exit 1
fi

if [ "${#SESSION_SECRET}" -lt 32 ]; then
  echo "SESSION_SECRET must be at least 32 characters." >&2
  exit 1
fi

if ! printf '%s' "$ADMIN_EMAIL" | grep -Eq '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'; then
  echo "ADMIN_EMAIL must be a valid email address." >&2
  exit 1
fi

case "$ADMIN_PASSWORD_HASH" in
  pbkdf2\$*) ;;
  *)
    echo "ADMIN_PASSWORD_HASH must be generated with bun run admin:hash." >&2
    exit 1
    ;;
esac

if [ "$PORT" != "3000" ]; then
  echo "PORT must be 3000 for the bundled Caddy reverse proxy." >&2
  exit 1
fi

echo "Production environment validation passed for $ENV_FILE."
