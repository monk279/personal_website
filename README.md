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
4. On an Ubuntu/Debian VPS, install Docker Engine and the Compose plugin.
5. Copy the project to `/opt/zhaohe-site`, create `.env`, then run:

```bash
docker compose up -d --build
docker compose exec app bun run db:migrate
docker compose exec app bun run db:seed
```

Caddy terminates HTTPS automatically when DNS is correct and ports `80` and `443` are open. PostgreSQL data, Caddy state, backups, and uploaded assets are stored in Docker/local volumes.

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
