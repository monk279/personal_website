# PRD: zhaohe.me Personal Website

Product version: 0.3.0  
PRD version: 0.3  
Last updated: 2026-05-31  
Product owner: Zhao He  
Primary domain target: zhaohe.me  
Status: Implemented revision snapshot

## Changelog

- 0.3.0 / PRD 0.3 / 2026-05-31: Reconstructed portfolio around Alpha Vantage asset search, cached quotes, normal database post URLs, comment-only moderation, and percentage-only portfolio output.
- 0.2.0 / PRD 0.2 / 2026-05-25: Added owner-visible version management, merged Archive into Blog, upgraded the owner post editor, wired portfolio editing, migrated persistence to PostgreSQL, improved comment feedback, and changed the visual direction to a clean nostalgic weblog style.
- 0.1.0 / PRD 0.1 / 2026-05-24: Initial bilingual personal site with Astro, Bun, Hono, Markdown posts, comments, admin login, and redacted portfolio output.

## Purpose

The website is a bilingual personal site with three first-class goals:

1. Introduce Zhao He.
2. Publish long-form writing and interact with readers.
3. Share a privacy-preserving investing portfolio snapshot.

Readers can browse and leave comments without accounts. The owner manages content, moderation, profile metadata, and portfolio data from `/admin`.

## Product Shape

The product uses:

- Astro for the public static site.
- Hono on Bun for API routes.
- Drizzle with PostgreSQL for persistent data.
- Markdown/MDX files for repo-authored posts.
- PostgreSQL-backed Markdown posts for web-authored content from the owner studio.
- Docker Compose for VPS deployment, including PostgreSQL, app, Caddy, and backups.
- Caddy for HTTPS and static file serving.

English is served at `/`; Chinese is served under `/zh`.

## User Types

Public readers can:

- Browse home, about, blog, tags, and portfolio pages.
- Read repo-authored MDX posts and published web-authored posts.
- Submit comments without creating an account.
- View public portfolio allocation and percentage return data.

Public readers cannot:

- Create accounts.
- Publish content.
- See pending, hidden, or spam submissions.
- See portfolio account size, quantity, cost basis, latest price, FX rate, market value, or raw cashflow amounts.

The owner can:

- Log in at `/admin`.
- Create, edit, draft, publish, delete, and restore web-authored posts.
- Upload safe local images for posts.
- Moderate comments.
- Search stocks/ETFs, add/edit/delete portfolio positions, and refresh cached quotes.
- Edit public profile metadata.

The owner model is single-user only. There is no public registration flow.

## Information Architecture

Public routes:

- `/` and `/zh` - Homepages.
- `/about` and `/zh/about` - Introduction pages.
- `/blog` and `/zh/blog` - Single writing hub with list, search, filters, and chronological archive mode.
- `/blog/[slug]` and `/zh/blog/[slug]` - Repo-authored MDX posts and published PostgreSQL-authored posts.
- `/archive` and `/zh/archive` - Compatibility alias pages that point users to Blog archive mode.
- `/tags/[tag]` and `/zh/tags/[tag]` - Tag pages.
- `/portfolio` and `/zh/portfolio` - Public redacted portfolio.
- `/admin` - Owner studio.

The main navigation intentionally removes `Archive`; Blog is the writing hub. Archive means chronological browsing, and it now lives inside Blog to avoid treating it as a separate content type.

## Owner Studio

The owner studio opens with clear login guidance. After login, the left-side management menu exposes:

- Write posts
- Post comments
- Portfolio
- Profile
- Log out

The post editor keeps Markdown as the source format and includes:

- Toolbar controls for headings, bold, italic, quote, list, code, links, emoji, and image upload.
- Split editor/preview layout.
- Sticky Save draft and Publish actions.
- Current post version.
- Revision list with restore actions.
- Public post link.

Every create, update, publish, and restore action stores a restorable post snapshot.

## Reader Interaction

Visitors do not need accounts to comment.

Comment forms collect:

- Name
- Optional email
- Optional website
- Body

Protections:

- Honeypot field.
- Per-IP rate limiting.
- Server-side validation.
- Body length limits.
- Suspicious-content classification.
- Pending moderation by default.

The browser UX must show loading, success, and error states near submit actions. Successful submissions clearly explain that the entry is awaiting moderation.

## Portfolio

Portfolio entry is manual for holdings, but public valuation uses cached Alpha Vantage market quotes. There is no broker sync in this version.

Owner-visible fields:

- Ticker/name
- Searchable market asset metadata
- Asset class
- Region
- Currency
- Quantity
- Cost basis cents
- As-of date
- Status
- Notes
- Cached quote status and timestamp

Public output exposes:

- Allocation percentages.
- Percentage returns.
- Asset class, region, and currency breakdowns.
- Redacted holding labels and weights.
- Quote freshness and stale/missing counts.
- "Not investment advice" note.

Public output never exposes account size, quantity, raw cost basis, latest price, FX rate, raw market value, or raw cashflow amounts.

## API Surface

Public APIs:

- `GET /api/comments?targetType=blog|portfolio&targetSlug=...`
- `POST /api/comments`
- `GET /api/portfolio/public`
- `GET /api/content/profile`
- `GET /api/content/posts`
- `GET /api/content/posts/:slug`

Admin APIs:

- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/me`
- `GET /api/admin/comments`
- `PATCH /api/admin/comments/:id`
- `DELETE /api/admin/comments/:id`
- `GET /api/admin/market/search?q=...`
- `POST /api/admin/market/quotes/refresh`
- `GET /api/admin/portfolio/positions`
- `POST /api/admin/portfolio/positions`
- `PATCH /api/admin/portfolio/positions/:id`
- `DELETE /api/admin/portfolio/positions/:id`
- `GET /api/admin/profile`
- `PATCH /api/admin/profile`
- `POST /api/admin/assets`
- `GET /api/admin/content/posts`
- `POST /api/admin/content/posts`
- `PATCH /api/admin/content/posts/:id`
- `DELETE /api/admin/content/posts/:id`
- `GET /api/admin/content/posts/:id/revisions`
- `POST /api/admin/content/posts/:id/revisions/:revisionId/restore`

## Database Tables

- `admins`
- `sessions`
- `comments`
- `market_assets`
- `market_quotes`
- `portfolio_positions`
- `portfolio_cashflows`
- `portfolio_snapshots`
- `site_profile`
- `content_posts`
- `content_post_revisions`
- `uploaded_assets`
- `audit_events`

## Deployment

Target deployment:

- Ubuntu or Debian VPS.
- Docker Compose.
- PostgreSQL service with persistent volume.
- Bun API container.
- Caddy for HTTPS, static Astro output, reverse proxy, and uploaded assets.
- Backup container using `pg_dump` plus uploaded/static asset archive.
- Cloudflare DNS.

Required environment variables:

- `SITE_URL`
- `DATABASE_URL`
- `POSTGRES_PASSWORD`
- `UPLOAD_DIR`
- `SESSION_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD_HASH`
- `ALPHA_VANTAGE_API_KEY`
- `TRUSTED_PROXY_CIDRS`
- `PORT`

## Acceptance Criteria

- A visitor can browse English and Chinese public pages.
- A visitor can comment without an account.
- New public submissions are not visible until approved.
- Suspicious submissions do not create public content.
- Comment submissions show clear success/error/loading feedback.
- The owner can log in at `/admin`.
- The owner can create, edit, publish, and restore a web-authored post.
- The owner can upload an image and use it in Markdown.
- The Markdown renderer supports safe images, links, lists, quotes, code, and emoji text.
- The owner can moderate comments.
- The owner can search market assets and add/edit portfolio positions manually.
- The owner can refresh cached quotes.
- The public portfolio hides raw account values and raw market prices.
- `/archive` remains available as a compatibility alias.
- The site uses a readable nostalgic personal-web visual style.

## Test Coverage

Automated checks should include:

- `bun test`
- `bun run build`
- `bun run test:e2e`

Database-backed tests use PostgreSQL. For local Docker testing, start `compose.test.yaml` and use:

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:15433/zhaohe_test bun test
```

Browser QA should cover:

- Comment submit and moderation.
- Admin login.
- Create/edit/publish post with link, image, emoji, list, quote, and code block.
- Restore previous post revision.
- Search market assets, refresh quotes, edit portfolio position, and verify public output stays redacted.
- Blog archive mode and `/archive` alias.
- Desktop and mobile responsive layout.
