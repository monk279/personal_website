import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "../src/server/db/client";
import { resetSchema } from "../src/server/db/migrate";
import { marketAssets, marketQuotes, portfolioPositions } from "../src/server/db/schema";
import { getPublicPortfolio } from "../src/server/portfolio";
import { nowIso } from "../src/server/security";

let runtime: ReturnType<typeof createDb>;
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:15433/zhaohe_test";

beforeEach(async () => {
  await resetSchema(databaseUrl);
  runtime = createDb(databaseUrl);
});

afterEach(async () => {
  await runtime?.client.close();
});

describe("portfolio privacy", () => {
  test("public portfolio only exposes percentages, not raw values", async () => {
    const now = nowIso();
    const [vt] = await runtime.db.insert(marketAssets).values({
      provider: "alpha_vantage",
      symbol: "VT",
      name: "Global equities",
      assetType: "ETF",
      region: "Global",
      currency: "USD",
      exchange: "US",
      createdAt: now,
      updatedAt: now
    }).returning();
    const [bnd] = await runtime.db.insert(marketAssets).values({
      provider: "alpha_vantage",
      symbol: "BND",
      name: "Bonds",
      assetType: "ETF",
      region: "US",
      currency: "USD",
      exchange: "US",
      createdAt: now,
      updatedAt: now
    }).returning();
    await runtime.db.insert(marketQuotes).values([
      {
        assetId: vt.id,
        provider: "alpha_vantage",
        price: 125,
        currency: "USD",
        baseCurrency: "USD",
        fxRateToBase: 1,
        asOf: "2026-05-23",
        fetchedAt: now,
        status: "ok",
        rawJson: "{}"
      },
      {
        assetId: bnd.id,
        provider: "alpha_vantage",
        price: 100,
        currency: "USD",
        baseCurrency: "USD",
        fxRateToBase: 1,
        asOf: "2026-05-23",
        fetchedAt: now,
        status: "ok",
        rawJson: "{}"
      }
    ]);
    await runtime.db.insert(portfolioPositions).values([
      {
        assetId: vt.id,
        ticker: "VT",
        name: "Global equities",
        assetClass: "Equity",
        region: "Global",
        currency: "USD",
        quantity: 10,
        costBasisCents: 100000,
        marketValueCents: 0,
        asOf: "2026-05-23",
        status: "active",
        createdAt: now,
        updatedAt: now
      },
      {
        assetId: bnd.id,
        ticker: "BND",
        name: "Bonds",
        assetClass: "Fixed income",
        region: "US",
        currency: "USD",
        quantity: 10,
        costBasisCents: 100000,
        marketValueCents: 0,
        asOf: "2026-05-23",
        status: "active",
        createdAt: now,
        updatedAt: now
      }
    ]);

    const publicData = await getPublicPortfolio(runtime.db);
    expect(publicData.totalReturnPercent).toBe(12.5);
    expect(publicData.assetAllocation).toEqual([
      { label: "Equity", weightPercent: 55.56 },
      { label: "Fixed income", weightPercent: 44.44 }
    ]);
    expect(JSON.stringify(publicData)).not.toContain("\"price\"");
    expect(JSON.stringify(publicData)).not.toContain("1250");
    expect(publicData.holdings[0]).not.toHaveProperty("quantity");
    expect(publicData.privacy.redactedFields).toContain("latestPrice");
  });

  test("stale cached quotes are still used and marked without leaking price", async () => {
    const now = nowIso();
    const [asset] = await runtime.db.insert(marketAssets).values({
      provider: "alpha_vantage",
      symbol: "AAPL",
      name: "Apple Inc.",
      assetType: "Equity",
      region: "US",
      currency: "USD",
      exchange: "US",
      createdAt: now,
      updatedAt: now
    }).returning();
    await runtime.db.insert(marketQuotes).values({
      assetId: asset.id,
      provider: "alpha_vantage",
      price: 200,
      currency: "USD",
      baseCurrency: "USD",
      fxRateToBase: 1,
      asOf: "2026-05-30",
      fetchedAt: "2026-05-30T00:00:00.000Z",
      status: "stale",
      error: "quota exhausted",
      rawJson: "{}"
    });
    await runtime.db.insert(portfolioPositions).values({
      assetId: asset.id,
      ticker: "AAPL",
      name: "Apple Inc.",
      assetClass: "Equity",
      region: "US",
      currency: "USD",
      quantity: 2,
      costBasisCents: 30000,
      marketValueCents: 0,
      asOf: "2026-05-31",
      status: "active",
      createdAt: now,
      updatedAt: now
    });

    const publicData = await getPublicPortfolio(runtime.db);
    expect(publicData.quoteFreshness.staleCount).toBe(1);
    expect(publicData.holdings[0].quoteStatus).toBe("stale");
    expect(JSON.stringify(publicData)).not.toContain("\"price\"");
    expect(JSON.stringify(publicData)).not.toContain("200");
  });
});
