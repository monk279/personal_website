import { SQL } from "bun";
import { defaultDatabaseUrl } from "./client";

const schemaSql = `
  CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT 'Zhaohe',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS comments (
    id SERIAL PRIMARY KEY,
    target_type TEXT NOT NULL DEFAULT 'blog',
    post_slug TEXT NOT NULL,
    parent_id INTEGER,
    author_name TEXT NOT NULL,
    author_email_hash TEXT,
    author_website TEXT,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    owner_reply TEXT,
    ip_hash TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL,
    approved_at TEXT
  );
  ALTER TABLE comments ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'blog';
  CREATE INDEX IF NOT EXISTS comments_post_status_idx ON comments(post_slug, status, created_at);
  CREATE INDEX IF NOT EXISTS comments_target_status_idx ON comments(target_type, post_slug, status, created_at);

  CREATE TABLE IF NOT EXISTS market_assets (
    id SERIAL PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT 'alpha_vantage',
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    asset_type TEXT NOT NULL DEFAULT 'Equity',
    region TEXT,
    currency TEXT NOT NULL DEFAULT 'USD',
    exchange TEXT,
    aliases_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  ALTER TABLE market_assets ADD COLUMN IF NOT EXISTS aliases_json TEXT NOT NULL DEFAULT '[]';
  CREATE UNIQUE INDEX IF NOT EXISTS market_assets_provider_symbol_idx ON market_assets(provider, symbol);

  CREATE TABLE IF NOT EXISTS market_quotes (
    id SERIAL PRIMARY KEY,
    asset_id INTEGER NOT NULL REFERENCES market_assets(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'alpha_vantage',
    price DOUBLE PRECISION NOT NULL,
    currency TEXT NOT NULL,
    base_currency TEXT NOT NULL DEFAULT 'USD',
    fx_rate_to_base DOUBLE PRECISION NOT NULL DEFAULT 1,
    as_of TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ok',
    error TEXT,
    raw_json TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS market_quotes_asset_idx ON market_quotes(asset_id);

  CREATE TABLE IF NOT EXISTS portfolio_positions (
    id SERIAL PRIMARY KEY,
    asset_id INTEGER REFERENCES market_assets(id) ON DELETE SET NULL,
    ticker TEXT NOT NULL,
    name TEXT NOT NULL,
    asset_class TEXT NOT NULL,
    region TEXT NOT NULL,
    currency TEXT NOT NULL,
    quantity DOUBLE PRECISION NOT NULL,
    cost_basis_cents INTEGER NOT NULL,
    market_value_cents INTEGER NOT NULL DEFAULT 0,
    as_of TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  ALTER TABLE portfolio_positions ADD COLUMN IF NOT EXISTS asset_id INTEGER REFERENCES market_assets(id) ON DELETE SET NULL;
  ALTER TABLE portfolio_positions ALTER COLUMN market_value_cents SET DEFAULT 0;
  CREATE INDEX IF NOT EXISTS portfolio_positions_status_idx ON portfolio_positions(status, as_of);

  CREATE TABLE IF NOT EXISTS portfolio_cashflows (
    id SERIAL PRIMARY KEY,
    kind TEXT NOT NULL,
    currency TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    occurred_at TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id SERIAL PRIMARY KEY,
    as_of TEXT NOT NULL,
    total_cost_basis_cents INTEGER NOT NULL,
    total_market_value_cents INTEGER NOT NULL,
    allocation_json TEXT NOT NULL,
    return_percent DOUBLE PRECISION NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id SERIAL PRIMARY KEY,
    actor_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS site_profile (
    id SERIAL PRIMARY KEY,
    display_name TEXT NOT NULL,
    headline TEXT NOT NULL,
    bio_en TEXT NOT NULL,
    bio_zh TEXT NOT NULL,
    location TEXT,
    email TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS content_posts (
    id SERIAL PRIMARY KEY,
    slug TEXT NOT NULL,
    lang TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    body_markdown TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    tags_json TEXT NOT NULL DEFAULT '[]',
    category TEXT NOT NULL DEFAULT 'Notes',
    version INTEGER NOT NULL DEFAULT 1,
    published_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  ALTER TABLE content_posts ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
  CREATE UNIQUE INDEX IF NOT EXISTS content_posts_lang_slug_idx ON content_posts(lang, slug);
  CREATE INDEX IF NOT EXISTS content_posts_public_idx ON content_posts(lang, status, published_at);

  CREATE TABLE IF NOT EXISTS content_post_revisions (
    id SERIAL PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    slug TEXT NOT NULL,
    lang TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    body_markdown TEXT NOT NULL,
    status TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    category TEXT NOT NULL,
    published_at TEXT,
    created_at TEXT NOT NULL,
    changed_at TEXT NOT NULL,
    changed_by_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS content_post_revisions_post_idx ON content_post_revisions(post_id, version DESC);

  CREATE TABLE IF NOT EXISTS uploaded_assets (
    id SERIAL PRIMARY KEY,
    owner_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    public_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;

export async function ensureSchema(databaseUrl = defaultDatabaseUrl) {
  const client = new SQL(databaseUrl);
  await client.unsafe(schemaSql);
  await client.close();
}

export async function resetSchema(databaseUrl = process.env.TEST_DATABASE_URL ?? defaultDatabaseUrl) {
  const client = new SQL(databaseUrl);
  await client.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await client.close();
  await ensureSchema(databaseUrl);
}

if (import.meta.main) {
  await ensureSchema();
  console.log("PostgreSQL schema is ready.");
}
