import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createApp } from "../src/server/app";
import { admins, comments, contentPostRevisions, marketAssets, marketQuotes } from "../src/server/db/schema";
import { resetSchema } from "../src/server/db/migrate";
import { LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD } from "../src/server/local-owner";
import { seedDatabase } from "../src/server/seed";
import { hashPassword, nowIso, verifyPassword } from "../src/server/security";
import type { MarketDataProvider } from "../src/server/market/types";

let runtime: Awaited<ReturnType<typeof createApp>>;

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:15433/zhaohe_test";
const mockMarketDataProvider: MarketDataProvider = {
  name: "mock",
  async searchAssets(query: string) {
    return [{
      provider: "alpha_vantage",
      symbol: query.toUpperCase() === "APPLE" ? "AAPL" : "VT",
      name: query.toUpperCase() === "APPLE" ? "Apple Inc." : "Vanguard Total World Stock ETF",
      assetType: "ETF",
      region: "United States",
      currency: "USD",
      exchange: "US",
      matchScore: 0.99
    }];
  },
  async getQuote(symbol: string) {
    return { provider: "mock", symbol, price: symbol === "VT" ? 125 : 50, currency: "USD", asOf: "2026-05-31", raw: { symbol } };
  },
  async getExchangeRate(fromCurrency: string, toCurrency: string) {
    return { fromCurrency, toCurrency, rate: 1, asOf: "2026-05-31", raw: {} };
  }
};

beforeEach(async () => {
  await resetSchema(databaseUrl);
  runtime = await createApp({ databaseUrl, marketDataProvider: mockMarketDataProvider });
});

afterEach(async () => {
  await runtime?.client.close();
});

describe("public interaction API", () => {
  test("comments are pending by default and hidden until approved", async () => {
    const create = await runtime.app.request("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "203.0.113.10" },
      body: JSON.stringify({
        targetType: "blog",
        targetSlug: "building-a-durable-home-online",
        name: "Reader",
        email: "reader@example.com",
        website: "https://example.com",
        body: "This is a thoughtful comment."
      })
    });

    expect(create.status).toBe(202);
    const created = await create.json();
    expect(created.status).toBe("pending");

    const hidden = await runtime.app.request("/api/comments?targetType=blog&targetSlug=building-a-durable-home-online");
    expect((await hidden.json()).comments).toHaveLength(0);

    await runtime.db
      .update(comments)
      .set({ status: "approved", approvedAt: nowIso() })
      .where(eq(comments.id, created.id));

    const visible = await runtime.app.request("/api/comments?targetType=blog&targetSlug=building-a-durable-home-online");
    const body = await visible.json();
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0].authorEmailHash).toBeUndefined();
  });

  test("honeypot submissions are accepted but not stored", async () => {
    const create = await runtime.app.request("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "203.0.113.20" },
      body: JSON.stringify({
        targetType: "portfolio",
        targetSlug: "portfolio",
        name: "Bot",
        body: "Spam",
        company: "Definitely a company"
      })
    });

    expect(create.status).toBe(202);
    const rows = await runtime.db.select().from(comments);
    expect(rows).toHaveLength(0);
  });

  test("suspicious submissions are easy for visitors but marked spam for moderation", async () => {
    const create = await runtime.app.request("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "203.0.113.21" },
      body: JSON.stringify({
        targetType: "portfolio",
        targetSlug: "portfolio",
        name: "Visitor",
        body: "Look http://a.example http://b.example http://c.example"
      })
    });

    expect(create.status).toBe(202);
    expect((await create.json()).status).toBe("pending");
    const rows = await runtime.db.select().from(comments);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("spam");
  });
});

describe("admin API", () => {
  test("local seed replaces stale test owners and displayed credentials log in", async () => {
    const now = nowIso();
    await runtime.db.insert(admins).values({
      email: "stale@example.com",
      name: "Stale Owner",
      passwordHash: await hashPassword("old-password"),
      createdAt: now,
      updatedAt: now
    });

    await seedDatabase(databaseUrl, { NODE_ENV: "test" });

    const rows = await runtime.db.select().from(admins);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(LOCAL_OWNER_EMAIL);
    expect(await verifyPassword(LOCAL_OWNER_PASSWORD, rows[0].passwordHash)).toBe(true);

    const status = await runtime.app.request("/api/admin/owner-status");
    const owner = await status.json();
    expect(owner.local).toBe(true);
    expect(owner.email).toBe(LOCAL_OWNER_EMAIL);
    expect(owner.passwordHint).toBe(LOCAL_OWNER_PASSWORD);

    const login = await runtime.app.request("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: owner.email, password: owner.passwordHint })
    });
    expect(login.status).toBe(200);
  });

  test("login reports when the database has no owner account", async () => {
    const login = await runtime.app.request("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: LOCAL_OWNER_EMAIL, password: LOCAL_OWNER_PASSWORD })
    });
    expect(login.status).toBe(503);
    expect((await login.json()).code).toBe("OWNER_MISSING");
  });

  test("login returns csrf token and admin endpoints require it for writes", async () => {
    const now = nowIso();
    await runtime.db.insert(admins).values({
      email: "owner@example.com",
      name: "Owner",
      passwordHash: await hashPassword("correct horse battery staple"),
      createdAt: now,
      updatedAt: now
    });

    const login = await runtime.app.request("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@example.com", password: "correct horse battery staple" })
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") ?? "";
    const csrfToken = (await login.json()).csrfToken;
    expect(csrfToken).toBeTruthy();

    const blocked = await runtime.app.request("/api/admin/portfolio/positions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({})
    });
    expect(blocked.status).toBe(403);

    const created = await runtime.app.request("/api/admin/portfolio/positions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        ticker: "VT",
        name: "Global equities",
        assetClass: "Equity",
        region: "Global",
        currency: "USD",
        quantity: 10,
        costBasisCents: 100000,
        asOf: "2026-05-23",
        status: "active"
      })
    });
    expect(created.status).toBe(201);
  });

  test("owner can search market assets and refresh cached quotes", async () => {
    const now = nowIso();
    await runtime.db.insert(admins).values({
      email: "market@example.com",
      name: "Market Owner",
      passwordHash: await hashPassword("correct horse battery staple"),
      createdAt: now,
      updatedAt: now
    });
    const login = await runtime.app.request("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "market@example.com", password: "correct horse battery staple" })
    });
    const cookie = login.headers.get("set-cookie") ?? "";
    const csrfToken = (await login.json()).csrfToken;

	    const search = await runtime.app.request("/api/admin/market/search?q=VT", { headers: { cookie } });
	    expect(search.status).toBe(200);
	    const searchBody = await search.json();
	    expect(searchBody.providerStatus.ok).toBe(true);
	    const asset = searchBody.assets[0];
	    expect(asset.symbol).toBe("VT");

    const created = await runtime.app.request("/api/admin/portfolio/positions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        assetId: asset.id,
        ticker: asset.symbol,
        name: asset.name,
        assetClass: "Equity",
        region: "Global",
        currency: "USD",
        quantity: 10,
        costBasisCents: 100000,
        asOf: "2026-05-31",
        status: "active"
      })
    });
    expect(created.status).toBe(201);

    const refresh = await runtime.app.request("/api/admin/market/quotes/refresh", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({})
    });
    expect(refresh.status).toBe(200);
    const quotes = await runtime.db.select().from(marketQuotes);
    expect(quotes).toHaveLength(1);
	    expect(quotes[0].price).toBe(125);
	  });

	  test("market search falls back to cached bilingual aliases when provider is unavailable", async () => {
	    await runtime.client.close();
	    await resetSchema(databaseUrl);
	    runtime = await createApp({
	      databaseUrl,
	      marketDataProvider: {
	        ...mockMarketDataProvider,
	        async searchAssets() {
	          throw new Error("Provider offline");
	        }
	      }
	    });
	    const now = nowIso();
	    await runtime.db.insert(admins).values({
	      email: "alias@example.com",
	      name: "Alias Owner",
	      passwordHash: await hashPassword("correct horse battery staple"),
	      createdAt: now,
	      updatedAt: now
	    });
	    await runtime.db.insert(marketAssets).values({
	      provider: "manual",
	      symbol: "VT",
	      name: "Vanguard Total World Stock ETF",
	      assetType: "ETF",
	      region: "Global",
	      currency: "USD",
	      exchange: "Manual",
	      aliasesJson: JSON.stringify(["全球股票", "全球 ETF"]),
	      createdAt: now,
	      updatedAt: now
	    });
	    const login = await runtime.app.request("/api/admin/login", {
	      method: "POST",
	      headers: { "content-type": "application/json" },
	      body: JSON.stringify({ email: "alias@example.com", password: "correct horse battery staple" })
	    });
	    const cookie = login.headers.get("set-cookie") ?? "";
	    await login.json();

	    const search = await runtime.app.request("/api/admin/market/search?q=%E5%85%A8%E7%90%83%E8%82%A1%E7%A5%A8&lang=zh", { headers: { cookie } });
	    expect(search.status).toBe(200);
	    const body = await search.json();
	    expect(body.providerStatus.ok).toBe(false);
	    expect(body.assets[0].symbol).toBe("VT");
	    expect(body.assets[0].source).toBe("cache");
	  });

  test("owner can publish web-edited posts without visitor accounts", async () => {
    const now = nowIso();
    await runtime.db.insert(admins).values({
      email: "writer@example.com",
      name: "Writer",
      passwordHash: await hashPassword("correct horse battery staple"),
      createdAt: now,
      updatedAt: now
    });

    const login = await runtime.app.request("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "writer@example.com", password: "correct horse battery staple" })
    });
    const cookie = login.headers.get("set-cookie") ?? "";
    const csrfToken = (await login.json()).csrfToken;

    const preview = await runtime.app.request("/api/admin/content/preview", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        bodyMarkdown: "# Preview\n\nA [safe link](https://example.com), [bad link](javascript:alert(1)), and ![image](/uploads/test.png).\n\n<script>alert('x')</script>"
      })
    });
    expect(preview.status).toBe(200);
    const previewHtml = (await preview.json()).html;
    expect(previewHtml).toContain("<h1>Preview</h1>");
    expect(previewHtml).toContain("<a href=\"https://example.com\"");
    expect(previewHtml).toContain("<img");
    expect(previewHtml).not.toContain("javascript:");
    expect(previewHtml).not.toContain("<script>");

    const create = await runtime.app.request("/api/admin/content/posts", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        slug: "web-edited-post",
        lang: "en",
        title: "Web edited post",
        description: "Published from the owner admin UI.",
        bodyMarkdown: "# Hello\n\nThis was **edited** on the website. 😀\n\n![Alt](/uploads/test.png)\n\n<script>alert('x')</script>",
        status: "published",
        tags: ["admin", "content"],
        category: "Notes"
      })
    });
    expect(create.status).toBe(201);

    const list = await runtime.app.request("/api/content/posts?lang=en");
    expect((await list.json()).posts[0].slug).toBe("web-edited-post");

    const publicPost = await runtime.app.request("/api/content/posts/web-edited-post?lang=en");
    const post = (await publicPost.json()).post;
    expect(post.bodyHtml).toContain("<strong>edited</strong>");
    expect(post.bodyHtml).not.toContain("<script>");
    expect(post.bodyHtml).not.toContain("alert");
    expect(post.bodyHtml).toContain("😀");
    const htmlPost = await runtime.app.request("/blog/web-edited-post");
    expect(htmlPost.status).toBe(200);
    expect(await htmlPost.text()).toContain("Web edited post");
    const revisions = await runtime.db.select().from(contentPostRevisions);
    expect(revisions).toHaveLength(1);
  });

  test("owner can restore content revisions", async () => {
    const now = nowIso();
    await runtime.db.insert(admins).values({
      email: "revision@example.com",
      name: "Revision Owner",
      passwordHash: await hashPassword("correct horse battery staple"),
      createdAt: now,
      updatedAt: now
    });
    const login = await runtime.app.request("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "revision@example.com", password: "correct horse battery staple" })
    });
    const cookie = login.headers.get("set-cookie") ?? "";
    const csrfToken = (await login.json()).csrfToken;
    const created = await runtime.app.request("/api/admin/content/posts", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        slug: "revision-post",
        lang: "en",
        title: "First title",
        description: "First description.",
        bodyMarkdown: "First body",
        status: "draft",
        tags: ["revision"],
        category: "Notes"
      })
    });
    const post = (await created.json()).post;
    await runtime.app.request(`/api/admin/content/posts/${post.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        slug: "revision-post",
        lang: "en",
        title: "Second title",
        description: "Second description.",
        bodyMarkdown: "Second body",
        status: "draft",
        tags: ["revision"],
        category: "Notes"
      })
    });
    const revisionsResponse = await runtime.app.request(`/api/admin/content/posts/${post.id}/revisions`, { headers: { cookie } });
    const revisions = (await revisionsResponse.json()).revisions;
    const firstRevision = revisions.find((revision: any) => revision.version === 1);
    const restored = await runtime.app.request(`/api/admin/content/posts/${post.id}/revisions/${firstRevision.id}/restore`, {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken }
    });
    expect(restored.status).toBe(200);
    expect((await restored.json()).post.title).toBe("First title");
  });
});
