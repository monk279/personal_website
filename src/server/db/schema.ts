import { doublePrecision, integer, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";

export const admins = pgTable("admins", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default("Zhaohe"),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastLoginAt: text("last_login_at")
});

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id").notNull().references(() => admins.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  csrfToken: text("csrf_token").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull()
});

export const comments = pgTable("comments", {
  id: serial("id").primaryKey(),
  targetType: text("target_type").notNull().default("blog"),
  postSlug: text("post_slug").notNull(),
  parentId: integer("parent_id"),
  authorName: text("author_name").notNull(),
  authorEmailHash: text("author_email_hash"),
  authorWebsite: text("author_website"),
  body: text("body").notNull(),
  status: text("status").notNull().default("pending"),
  ownerReply: text("owner_reply"),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  createdAt: text("created_at").notNull(),
  approvedAt: text("approved_at")
});

export const marketAssets = pgTable(
  "market_assets",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull().default("alpha_vantage"),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    assetType: text("asset_type").notNull().default("Equity"),
    region: text("region"),
    currency: text("currency").notNull().default("USD"),
    exchange: text("exchange"),
    aliasesJson: text("aliases_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    providerSymbolIdx: uniqueIndex("market_assets_provider_symbol_idx").on(table.provider, table.symbol)
  })
);

export const marketQuotes = pgTable(
  "market_quotes",
  {
    id: serial("id").primaryKey(),
    assetId: integer("asset_id").notNull().references(() => marketAssets.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("alpha_vantage"),
    price: doublePrecision("price").notNull(),
    currency: text("currency").notNull(),
    baseCurrency: text("base_currency").notNull().default("USD"),
    fxRateToBase: doublePrecision("fx_rate_to_base").notNull().default(1),
    asOf: text("as_of").notNull(),
    fetchedAt: text("fetched_at").notNull(),
    status: text("status").notNull().default("ok"),
    error: text("error"),
    rawJson: text("raw_json")
  },
  (table) => ({
    assetIdx: uniqueIndex("market_quotes_asset_idx").on(table.assetId)
  })
);

export const portfolioPositions = pgTable("portfolio_positions", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").references(() => marketAssets.id, { onDelete: "set null" }),
  ticker: text("ticker").notNull(),
  name: text("name").notNull(),
  assetClass: text("asset_class").notNull(),
  region: text("region").notNull(),
  currency: text("currency").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  costBasisCents: integer("cost_basis_cents").notNull(),
  marketValueCents: integer("market_value_cents").notNull().default(0),
  asOf: text("as_of").notNull(),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const portfolioCashflows = pgTable("portfolio_cashflows", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  currency: text("currency").notNull(),
  amountCents: integer("amount_cents").notNull(),
  occurredAt: text("occurred_at").notNull(),
  notes: text("notes"),
  createdAt: text("created_at").notNull()
});

export const portfolioSnapshots = pgTable("portfolio_snapshots", {
  id: serial("id").primaryKey(),
  asOf: text("as_of").notNull(),
  totalCostBasisCents: integer("total_cost_basis_cents").notNull(),
  totalMarketValueCents: integer("total_market_value_cents").notNull(),
  allocationJson: text("allocation_json").notNull(),
  returnPercent: doublePrecision("return_percent").notNull(),
  createdAt: text("created_at").notNull()
});

export const auditEvents = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  actorAdminId: integer("actor_admin_id").references(() => admins.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  metadataJson: text("metadata_json"),
  createdAt: text("created_at").notNull()
});

export const siteProfile = pgTable("site_profile", {
  id: serial("id").primaryKey(),
  displayName: text("display_name").notNull(),
  headline: text("headline").notNull(),
  bioEn: text("bio_en").notNull(),
  bioZh: text("bio_zh").notNull(),
  location: text("location"),
  email: text("email"),
  updatedAt: text("updated_at").notNull()
});

export const contentPosts = pgTable("content_posts", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  lang: text("lang").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  bodyMarkdown: text("body_markdown").notNull(),
  status: text("status").notNull().default("draft"),
  tagsJson: text("tags_json").notNull().default("[]"),
  category: text("category").notNull().default("Notes"),
  version: integer("version").notNull().default(1),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const contentPostRevisions = pgTable("content_post_revisions", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull().references(() => contentPosts.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  slug: text("slug").notNull(),
  lang: text("lang").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  bodyMarkdown: text("body_markdown").notNull(),
  status: text("status").notNull(),
  tagsJson: text("tags_json").notNull(),
  category: text("category").notNull(),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull(),
  changedAt: text("changed_at").notNull(),
  changedByAdminId: integer("changed_by_admin_id").references(() => admins.id, { onDelete: "set null" })
});

export const uploadedAssets = pgTable("uploaded_assets", {
  id: serial("id").primaryKey(),
  ownerAdminId: integer("owner_admin_id").references(() => admins.id, { onDelete: "set null" }),
  originalName: text("original_name").notNull(),
  storedName: text("stored_name").notNull().unique(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  publicPath: text("public_path").notNull(),
  createdAt: text("created_at").notNull()
});
