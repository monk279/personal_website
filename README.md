# zhaohe.me personal website

Personal website for `zhaohe.me`, built with Astro, Hono, Bun, Drizzle, and PostgreSQL.

## Local setup

```bash
bun install
cp .env.example .env
bun run admin:hash -- "your-admin-password"
# paste the generated hash into ADMIN_PASSWORD_HASH in .env
# add ALPHA_VANTAGE_API_KEY for stock/ETF search and quote refresh
```

For local database testing with Docker:

```bash
docker compose -f compose.test.yaml up -d
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:15433/zhaohe_test bun run db:migrate
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:15433/zhaohe_test bun run db:seed
```

Run the local management stack:

```bash
bun run dev
```

This starts local Postgres, prepares the local owner, starts the API, and starts the Astro site. Open `http://127.0.0.1:4321/admin` and use:

```bash
owner@example.com / local-test-password
```

For manual debugging, you can still run the API and site separately:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:15433/zhaohe_test HOST=127.0.0.1 DISABLE_MARKET_REFRESH=1 bun run dev:api
API_PROXY_TARGET=http://127.0.0.1:3000 bun run dev:site -- --host 127.0.0.1 --port 4321
```

Astro serves the public site on `http://127.0.0.1:4321` and proxies `/api/*` to Hono on `http://127.0.0.1:3000`. In production, Caddy also proxies article URLs under `/blog/*` and `/zh/blog/*` to Hono so PostgreSQL-authored posts use normal URLs.

## Owner studio

- Open `/admin` to log in as the owner.
- There is no public account creation flow.
- The owner account comes from `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH`.
- After login, use the owner studio to write posts, moderate comments, edit market-priced portfolio positions, and update profile metadata.
- Web-authored posts are Markdown stored in PostgreSQL and appear publicly when their status is `published`.
- The editor supports headings, bold, italic, quotes, lists, code, links, emoji text, image upload, live preview, and revision restore.
- The portfolio editor supports stock/ETF search through Alpha Vantage and caches quote refreshes for allocation calculations.

## Blog and Archive

`/blog` is the single writing hub. It includes ordinary post browsing plus chronological archive mode. `/archive` and `/zh/archive` remain as compatibility alias pages that point readers back to Blog.

## Deployment outline

1. Register `zhaohe.me`.
2. Add the zone to Cloudflare and set registrar nameservers to Cloudflare's assigned nameservers.
3. Create DNS-only `A` records for `zhaohe.me` and `www` pointing to the VPS IP.

With a Cloudflare API token that has DNS write access to the `zhaohe.me` zone:

```bash
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ZONE_ID=<zone-id> VPS_IP=<vps-ip> ./scripts/setup-cloudflare-dns.sh
```

The script creates or updates DNS-only `A` records for `zhaohe.me` and `www.zhaohe.me` with `proxied` disabled. This lets Caddy request HTTPS certificates directly during the first launch.

Manual equivalent in the Cloudflare dashboard:

- `A` record: `zhaohe.me` -> `<vps-ip>`, DNS-only
- `A` record: `www` -> `<vps-ip>`, DNS-only

4. On an Ubuntu/Debian VPS, install Docker Engine, the Compose plugin, Git, and UFW.

For first-time server setup, make sure the VPS has an SSH key with access to the GitHub repo, then clone the repo and run:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone git@github.com:monk279/personal_website.git /tmp/zhaohe-site-bootstrap
cd /tmp/zhaohe-site-bootstrap
./scripts/bootstrap-vps.sh
```

The bootstrap script installs dependencies, opens ports `22`, `80`, and `443`, prepares `/opt/zhaohe-site`, clones or updates the repo, and creates `.env` from `.env.example`.

Manual equivalent:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo mkdir -p /opt/zhaohe-site
sudo chown "$USER":"$USER" /opt/zhaohe-site
git clone git@github.com:monk279/personal_website.git /opt/zhaohe-site
cd /opt/zhaohe-site
mkdir -p public/uploads backups
```

5. Create production secrets:

```bash
cp .env.example .env
openssl rand -base64 32
POSTGRES_PASSWORD=temporary-build-value docker compose build app
docker compose run --rm --no-deps app bun run admin:hash -- "your-admin-password"
```

Edit `.env` so `POSTGRES_PASSWORD` is a strong generated value, `DATABASE_URL` uses the same PostgreSQL password, `SESSION_SECRET` uses the generated random value, `ADMIN_EMAIL` is your login email, and `ADMIN_PASSWORD_HASH` is the generated password hash.

6. Launch:

```bash
docker compose up -d --build
docker compose exec app bun run db:migrate
docker compose exec app bun run db:seed
```

After the first launch, repeat deployments can use:

```bash
./scripts/deploy-vps.sh
```

Caddy terminates HTTPS automatically when DNS is correct and ports `80` and `443` are open. PostgreSQL data, Caddy state, backups, and uploaded assets are stored in Docker/local volumes.

Verify production after launch:

```bash
docker compose ps
curl -I https://zhaohe.me
curl -fsS https://zhaohe.me/api/health
docker compose logs --tail=100 caddy
EXPECTED_IP=<vps-ip> ./scripts/verify-production.sh
```

## Tests

```bash
bun run build
docker compose -f compose.test.yaml up -d
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:15433/zhaohe_test bun test
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:15433/zhaohe_test bun run test:e2e
```

## Notes

- Repo-authored posts are MDX files in `src/content/blog`.
- Public web-authored posts are served at `/blog/:slug` and `/zh/blog/:slug`.
- Public portfolio output is intentionally redacted: it only returns percentages and quote freshness, never raw position size, quantity, cost basis, latest price, FX rate, or market value.
- Readers do not need accounts to comment. Comments start as `pending`; suspicious submissions are marked `spam`, and honeypot submissions are dropped.
- To import old local SQLite data, run `bun run db:import-sqlite -- ./data/site.sqlite` after configuring `DATABASE_URL`.
