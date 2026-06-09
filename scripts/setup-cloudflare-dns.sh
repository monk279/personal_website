#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-zhaohe.me}"
VPS_IP="${VPS_IP:-}"
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
CLOUDFLARE_ZONE_ID="${CLOUDFLARE_ZONE_ID:-}"
API_BASE="https://api.cloudflare.com/client/v4"

if [ -z "$VPS_IP" ] || [ -z "$CLOUDFLARE_API_TOKEN" ] || [ -z "$CLOUDFLARE_ZONE_ID" ]; then
  echo "Usage: CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ZONE_ID=<zone-id> VPS_IP=<vps-ip> $0" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required for JSON parsing." >&2
  exit 1
fi

json_field() {
  local field="$1"
  python3 -c "import json,sys; data=json.load(sys.stdin); print(data${field})"
}

cf_request() {
  local method="$1"
  local path="$2"
  local payload="${3:-}"

  if [ -n "$payload" ]; then
    curl -fsS -X "$method" "$API_BASE$path" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json" \
      --data "$payload"
  else
    curl -fsS -X "$method" "$API_BASE$path" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json"
  fi
}

record_payload() {
  local name="$1"
  python3 -c 'import json,os,sys
name = sys.argv[1]
print(json.dumps({
  "type": "A",
  "name": name,
  "content": os.environ["VPS_IP"],
  "ttl": 300,
  "proxied": False
}))' "$name"
}

ensure_success() {
  local response="$1"
  local action="$2"
  local success
  success="$(printf '%s' "$response" | json_field '["success"]')"
  if [ "$success" != "True" ]; then
    echo "Cloudflare API failed while trying to $action:" >&2
    printf '%s\n' "$response" >&2
    exit 1
  fi
}

ensure_a_record() {
  local name="$1"
  local lookup_response
  local record_id
  local payload
  local response

  lookup_response="$(curl -fsS -G "$API_BASE/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    --data-urlencode "type=A" \
    --data-urlencode "name=$name")"
  ensure_success "$lookup_response" "look up $name"

  record_id="$(printf '%s' "$lookup_response" | python3 -c 'import json,sys
data = json.load(sys.stdin)
records = data.get("result", [])
print(records[0].get("id", "") if records else "")')"

  payload="$(record_payload "$name")"

  if [ -n "$record_id" ]; then
    response="$(cf_request PATCH "/zones/$CLOUDFLARE_ZONE_ID/dns_records/$record_id" "$payload")"
    ensure_success "$response" "update $name"
    echo "Updated DNS-only A record: $name -> $VPS_IP"
  else
    response="$(cf_request POST "/zones/$CLOUDFLARE_ZONE_ID/dns_records" "$payload")"
    ensure_success "$response" "create $name"
    echo "Created DNS-only A record: $name -> $VPS_IP"
  fi
}

ensure_a_record "$DOMAIN"
ensure_a_record "www.$DOMAIN"

echo
echo "Cloudflare DNS setup finished."
echo "Verify propagation with:"
echo "  EXPECTED_IP=$VPS_IP ./scripts/verify-production.sh"
