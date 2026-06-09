#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-zhaohe.me}"
EXPECTED_IP="${EXPECTED_IP:-}"

if [ -z "$EXPECTED_IP" ]; then
  echo "Usage: EXPECTED_IP=<vps-ip> $0" >&2
  exit 1
fi

resolve_host() {
  local host="$1"
  if command -v dig >/dev/null 2>&1; then
    dig +short A "$host" | tail -n 1
    return
  fi
  if command -v getent >/dev/null 2>&1; then
    getent ahostsv4 "$host" | awk 'NR == 1 { print $1 }'
    return
  fi
  echo "Install dig or getent to verify DNS." >&2
  exit 1
}

check_dns() {
  local host="$1"
  local resolved_ip
  resolved_ip="$(resolve_host "$host")"
  if [ "$resolved_ip" != "$EXPECTED_IP" ]; then
    echo "DNS mismatch for $host: got '${resolved_ip:-none}', expected '$EXPECTED_IP'." >&2
    exit 1
  fi
  echo "DNS ok: $host -> $resolved_ip"
}

check_url() {
  local url="$1"
  local code
  code="$(curl -L -sS -o /dev/null -w "%{http_code}" "$url")"
  case "$code" in
    2*|3*) echo "HTTP ok: $url -> $code" ;;
    *)
      echo "HTTP failed: $url -> $code" >&2
      exit 1
      ;;
  esac
}

check_dns "$DOMAIN"
check_dns "www.$DOMAIN"

check_url "https://$DOMAIN/"
check_url "https://www.$DOMAIN/"
check_url "https://$DOMAIN/blog/"
check_url "https://$DOMAIN/portfolio/"
check_url "https://$DOMAIN/admin/"
check_url "https://$DOMAIN/api/health"

echo
echo "Production verification passed for $DOMAIN."
