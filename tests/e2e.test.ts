import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app";
import { admins, comments } from "../src/server/db/schema";
import { resetSchema } from "../src/server/db/migrate";
import { hashPassword, nowIso } from "../src/server/security";
import type { MarketDataProvider } from "../src/server/market/types";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:15433/zhaohe_test";
const mockMarketDataProvider: MarketDataProvider = {
  name: "mock",
  async searchAssets() {
    return [{
      provider: "alpha_vantage",
      symbol: "VT",
      name: "Vanguard Total World Stock ETF",
      assetType: "ETF",
      region: "Global",
      currency: "USD",
      exchange: "US",
      matchScore: 0.99
    }];
  },
  async getQuote(symbol: string) {
    return { provider: "mock", symbol, price: 125, currency: "USD", asOf: "2026-05-31", raw: {} };
  },
  async getExchangeRate(fromCurrency: string, toCurrency: string) {
    return { fromCurrency, toCurrency, rate: 1, asOf: "2026-05-31", raw: {} };
  }
};

let runtime: Awaited<ReturnType<typeof createApp>>;

beforeEach(async () => {
  process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), "zhaohe-upload-test-"));
  await resetSchema(databaseUrl);
  runtime = await createApp({ databaseUrl, marketDataProvider: mockMarketDataProvider });
});

afterEach(async () => {
  await runtime?.client.close();
});

async function loginOwner() {
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
  return {
    cookie: login.headers.get("set-cookie") ?? "",
    csrfToken: (await login.json()).csrfToken as string
  };
}

describe("owner and reader flows", () => {
  test("visitors cannot post blogs through the admin content API", async () => {
    const create = await runtime.app.request("/api/admin/content/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "visitor-post",
        lang: "en",
        title: "Visitor post",
        description: "This should not be accepted.",
        bodyMarkdown: "Visitor body",
        status: "published",
        tags: [],
        category: "Notes"
      })
    });

    expect(create.status).toBe(401);
  });

  test("comment submit and moderation approval work without visitor accounts", async () => {
    const owner = await loginOwner();
    const submit = await runtime.app.request("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "203.0.113.32" },
      body: JSON.stringify({
        targetType: "blog",
        targetSlug: "building-a-durable-home-online",
        name: "Commenter",
        email: "commenter@example.com",
        body: "This post was useful."
      })
    });
    expect(submit.status).toBe(202);
    expect((await (await runtime.app.request("/api/comments?targetType=blog&targetSlug=building-a-durable-home-online")).json()).comments).toHaveLength(0);

    const [row] = await runtime.db.select().from(comments);
    const approved = await runtime.app.request(`/api/admin/comments/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: owner.cookie, "x-csrf-token": owner.csrfToken },
      body: JSON.stringify({ status: "approved" })
    });
    expect(approved.status).toBe(200);

    const publicComments = await runtime.app.request("/api/comments?targetType=blog&targetSlug=building-a-durable-home-online");
    const body = await publicComments.json();
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0].authorEmailHash).toBeUndefined();
  });

  test("portfolio comments can be submitted by visitors and published after moderation", async () => {
    const owner = await loginOwner();
    const submit = await runtime.app.request("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "203.0.113.45" },
      body: JSON.stringify({
        targetType: "portfolio",
        targetSlug: "portfolio",
        name: "Portfolio Reader",
        email: "reader@example.com",
        body: "The allocation notes are clear."
      })
    });
    expect(submit.status).toBe(202);

    const hidden = await runtime.app.request("/api/comments?targetType=portfolio&targetSlug=portfolio");
    expect((await hidden.json()).comments).toHaveLength(0);

    const [row] = await runtime.db.select().from(comments);
    const approved = await runtime.app.request(`/api/admin/comments/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: owner.cookie, "x-csrf-token": owner.csrfToken },
      body: JSON.stringify({ status: "approved" })
    });
    expect(approved.status).toBe(200);

    const publicComments = await runtime.app.request("/api/comments?targetType=portfolio&targetSlug=portfolio");
    const body = await publicComments.json();
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0]).toMatchObject({
      targetType: "portfolio",
      targetSlug: "portfolio",
      authorName: "Portfolio Reader",
      body: "The allocation notes are clear."
    });
    expect(body.comments[0].authorEmailHash).toBeUndefined();
  });

  test("owner can publish rich Markdown, restore revisions, upload images, and edit portfolio privately", async () => {
    const owner = await loginOwner();
    const form = new FormData();
    form.append("file", new File([new Uint8Array([137, 80, 78, 71])], "chart.png", { type: "image/png" }));
    const upload = await runtime.app.request("/api/admin/assets", {
      method: "POST",
      headers: { cookie: owner.cookie, "x-csrf-token": owner.csrfToken },
      body: form
    });
    expect(upload.status).toBe(201);
    const assetPath = (await upload.json()).asset.publicPath;

    const createdPost = await runtime.app.request("/api/admin/content/posts", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie, "x-csrf-token": owner.csrfToken },
      body: JSON.stringify({
        slug: "rich-markdown-post",
        lang: "en",
        title: "Rich Markdown post",
        description: "Images, links, emoji, lists, quotes, and code.",
        bodyMarkdown: `# Rich post\n\nA [safe link](https://example.com) and emoji 😀.\n\n![Chart](${assetPath})\n\n- first\n- second\n\n> quoted\n\n\`inline code\``,
        status: "published",
        tags: ["editor"],
        category: "Notes"
      })
    });
    expect(createdPost.status).toBe(201);
    const post = (await createdPost.json()).post;

    const update = await runtime.app.request(`/api/admin/content/posts/${post.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: owner.cookie, "x-csrf-token": owner.csrfToken },
      body: JSON.stringify({ title: "Changed title", bodyMarkdown: "Changed body" })
    });
    expect(update.status).toBe(200);

    const revisions = (await (await runtime.app.request(`/api/admin/content/posts/${post.id}/revisions`, { headers: { cookie: owner.cookie } })).json()).revisions;
    const firstRevision = revisions.find((revision: any) => revision.version === 1);
    const restored = await runtime.app.request(`/api/admin/content/posts/${post.id}/revisions/${firstRevision.id}/restore`, {
      method: "POST",
      headers: { cookie: owner.cookie, "x-csrf-token": owner.csrfToken }
    });
    expect((await restored.json()).post.title).toBe("Rich Markdown post");

    const publicPost = await runtime.app.request("/api/content/posts/rich-markdown-post?lang=en");
    const publicBody = (await publicPost.json()).post.bodyHtml;
    expect(publicBody).toContain("<img");
    expect(publicBody).toContain("<a href=\"https://example.com\"");
    expect(publicBody).toContain("😀");
    const normalPostUrl = await runtime.app.request("/blog/rich-markdown-post");
    expect(normalPostUrl.status).toBe(200);
    expect(await normalPostUrl.text()).toContain("Rich Markdown post");

    const search = await runtime.app.request("/api/admin/market/search?q=VT", { headers: { cookie: owner.cookie } });
    const asset = (await search.json()).assets[0];

    const createdPosition = await runtime.app.request("/api/admin/portfolio/positions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie, "x-csrf-token": owner.csrfToken },
      body: JSON.stringify({
        assetId: asset.id,
        ticker: asset.symbol,
        name: asset.name,
        assetClass: "Equity",
        region: "Global",
        currency: "USD",
        quantity: 10,
        costBasisCents: 100000,
        asOf: "2026-05-25",
        status: "active"
      })
    });
    const position = (await createdPosition.json()).position;
    const edited = await runtime.app.request(`/api/admin/portfolio/positions/${position.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: owner.cookie, "x-csrf-token": owner.csrfToken },
      body: JSON.stringify({ quantity: 10 })
    });
    expect(edited.status).toBe(200);
    const refreshed = await runtime.app.request("/api/admin/market/quotes/refresh", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie, "x-csrf-token": owner.csrfToken },
      body: JSON.stringify({})
    });
    expect(refreshed.status).toBe(200);

    const publicPortfolio = await runtime.app.request("/api/portfolio/public");
    const redacted = await publicPortfolio.json();
    expect(redacted.totalReturnPercent).toBe(25);
    expect(JSON.stringify(redacted)).not.toContain("\"price\"");
    expect(JSON.stringify(redacted)).not.toContain("1250");
    expect(redacted.holdings[0].quantity).toBeUndefined();
    expect(redacted.holdings[0].costBasisCents).toBeUndefined();
    expect(redacted.holdings[0].marketValueCents).toBeUndefined();
    expect(redacted.privacy.redactedFields).toContain("latestPrice");
  });
});
