#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/zhaohe-site}"
REPO_URL="${REPO_URL:-git@github.com:monk279/personal_website.git}"
BRANCH="${BRANCH:-main}"

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this script as a sudo-capable non-root user, not as root." >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This bootstrap script supports Ubuntu/Debian hosts with apt-get." >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y ca-certificates curl git ufw

if ! command -v docker >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" |
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

if ! id -nG "$USER" | grep -qw docker; then
  sudo usermod -aG docker "$USER"
  echo "Added $USER to the docker group. Log out and back in before running Docker without sudo."
fi

sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

sudo mkdir -p "$APP_DIR"
sudo chown "$USER":"$USER" "$APP_DIR"

if [ ! -d "$APP_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
fi

mkdir -p "$APP_DIR/public/uploads" "$APP_DIR/backups"

if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
fi

echo
echo "Bootstrap finished."
echo "Next steps:"
echo "  1. Edit $APP_DIR/.env with production secrets."
echo "  2. Ensure Cloudflare DNS-only A records point zhaohe.me and www to this VPS IP."
echo "  3. Run: cd $APP_DIR && ./scripts/deploy-vps.sh"
