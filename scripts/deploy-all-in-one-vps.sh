#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/zhaohe-site}"
BRANCH="${BRANCH:-main}"
DOMAIN="${DOMAIN:-zhaohe.me}"
REPO_URL="${REPO_URL:-https://github.com/monk279/personal_website.git}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_dir="$(cd "$script_dir/.." && pwd)"

run_apt() {
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "This script supports Ubuntu/Debian VPS hosts with apt-get." >&2
    exit 1
  fi
  $SUDO apt-get "$@"
}

install_docker() {
  run_apt update
  run_apt install -y ca-certificates curl git ufw

  if docker compose version >/dev/null 2>&1; then
    return
  fi

  $SUDO install -m 0755 -d /etc/apt/keyrings

  if [ -f /etc/os-release ]; then
    . /etc/os-release
  else
    echo "Missing /etc/os-release; cannot configure Docker apt repo." >&2
    exit 1
  fi

  if [ "${ID:-}" = "ubuntu" ] || [ "${ID:-}" = "debian" ]; then
    curl -fsSL "https://download.docker.com/linux/${ID}/gpg" |
      $SUDO tee /etc/apt/keyrings/docker.asc >/dev/null
    $SUDO chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" |
      $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
    run_apt update
    run_apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  else
    run_apt install -y docker.io docker-compose-v2 || run_apt install -y docker.io docker-compose-plugin
  fi

  $SUDO systemctl enable --now docker
}

set_docker_command() {
  if docker compose version >/dev/null 2>&1; then
    DOCKER="docker"
    COMPOSE_STYLE="plugin"
    return
  fi

  if $SUDO docker compose version >/dev/null 2>&1; then
    DOCKER="$SUDO docker"
    COMPOSE_STYLE="plugin"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker-compose"
    COMPOSE_STYLE="standalone"
    return
  fi

  if $SUDO docker-compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE="$SUDO docker-compose"
    COMPOSE_STYLE="standalone"
    return
  fi

  echo "Docker Compose is still not available after installation." >&2
  exit 1
}

compose() {
  if [ "$COMPOSE_STYLE" = "plugin" ]; then
    $DOCKER compose "$@"
  else
    $DOCKER_COMPOSE "$@"
  fi
}

prepare_app_dir() {
  if [ "$source_dir" = "$APP_DIR" ]; then
    return
  fi

  $SUDO mkdir -p "$APP_DIR"
  $SUDO chown -R "$(id -u):$(id -g)" "$APP_DIR"

  if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" fetch origin "$BRANCH"
    git -C "$APP_DIR" checkout "$BRANCH"
    git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
    return
  fi

  if [ -z "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 2>/dev/null)" ]; then
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
    return
  fi

  echo "$APP_DIR exists but is not a Git repo and is not empty." >&2
  echo "Move it away or set APP_DIR to a different path, then rerun." >&2
  exit 1
}

prompt_env_values() {
  if [ -z "${ADMIN_EMAIL_VALUE:-}" ]; then
    read -r -p "Website admin email: " ADMIN_EMAIL_VALUE
  fi

  if [ -z "${ADMIN_LOGIN_PASSWORD:-}" ]; then
    read -r -s -p "Website admin password: " ADMIN_LOGIN_PASSWORD
    echo
    read -r -s -p "Confirm website admin password: " ADMIN_LOGIN_PASSWORD_CONFIRM
    echo
    if [ "$ADMIN_LOGIN_PASSWORD" != "$ADMIN_LOGIN_PASSWORD_CONFIRM" ]; then
      echo "Admin passwords did not match." >&2
      exit 1
    fi
  fi

  if [ -z "$ADMIN_EMAIL_VALUE" ] || [ -z "$ADMIN_LOGIN_PASSWORD" ]; then
    echo "Admin email and password are required." >&2
    exit 1
  fi
}

write_env_file() {
  local admin_hash="$1"
  local postgres_password="$2"
  local session_secret="$3"

  cat > .env <<EOF
SITE_URL=https://${DOMAIN}
DATABASE_URL=postgres://zhaohe:${postgres_password}@postgres:5432/zhaohe
POSTGRES_PASSWORD=${postgres_password}
UPLOAD_DIR=./public/uploads
SESSION_SECRET=${session_secret}
ADMIN_EMAIL=${ADMIN_EMAIL_VALUE}
ADMIN_PASSWORD_HASH='${admin_hash}'
ALPHA_VANTAGE_API_KEY=${ALPHA_VANTAGE_API_KEY:-not-configured-yet}
TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128
PORT=3000
EOF
  chmod 600 .env
}

create_or_replace_env() {
  local regenerate="${FORCE_ENV:-0}"

  if [ -f .env ] && [ "$regenerate" != "1" ]; then
    if ./scripts/validate-production-env.sh >/dev/null 2>&1; then
      echo "Using existing valid .env."
      return
    fi
    echo "Existing .env is missing or invalid production values."
    read -r -p "Regenerate .env now? [Y/n] " answer
    case "$answer" in
      n|N|no|NO) echo "Stopped so you can fix .env manually."; exit 1 ;;
    esac
  fi

  prompt_env_values

  local postgres_password
  local session_secret
  local admin_hash
  postgres_password="$(openssl rand -hex 32)"
  session_secret="$(openssl rand -hex 32)"

  write_env_file "pbkdf2\$210000\$temporary\$temporary" "$postgres_password" "$session_secret"

  POSTGRES_PASSWORD="$postgres_password" compose build app
  admin_hash="$(compose run --rm --no-deps app bun run admin:hash -- "$ADMIN_LOGIN_PASSWORD" | tail -n 1)"
  if ! printf '%s' "$admin_hash" | grep -q '^pbkdf2\$'; then
    echo "Failed to generate admin password hash." >&2
    exit 1
  fi

  write_env_file "$admin_hash" "$postgres_password" "$session_secret"
}

main() {
  install_docker
  set_docker_command
  prepare_app_dir

  cd "$APP_DIR"
  mkdir -p public/uploads backups

  create_or_replace_env
  ./scripts/validate-production-env.sh

  compose up -d --build
  compose exec app bun run db:migrate
  compose exec app bun run db:seed
  compose ps

  if [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_ZONE_ID:-}" ] && [ -n "${VPS_IP:-}" ]; then
    CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" CLOUDFLARE_ZONE_ID="$CLOUDFLARE_ZONE_ID" VPS_IP="$VPS_IP" ./scripts/setup-cloudflare-dns.sh
  fi

  if [ -n "${VPS_IP:-}" ]; then
    EXPECTED_IP="$VPS_IP" ./scripts/verify-production.sh || true
  fi

  echo
  echo "Deployment finished."
  echo "Open: https://${DOMAIN}"
  echo "Admin: https://${DOMAIN}/admin"
  echo "If DNS is not configured yet, create DNS-only A records for ${DOMAIN} and www.${DOMAIN} pointing to this VPS IP."
}

main "$@"
