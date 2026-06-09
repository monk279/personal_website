import { createDb } from "./db/client";
import { ensureSchema } from "./db/migrate";
import { marketAssets, marketQuotes, portfolioPositions, siteProfile } from "./db/schema";
import { ensureSeedOwner, LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD } from "./local-owner";
import { hashPassword, nowIso } from "./security";

type RuntimeEnv = Record<string, string | undefined>;

export async function seedDatabase(databaseUrl = process.env.DATABASE_URL, env: RuntimeEnv = process.env) {
  await ensureSchema(databaseUrl);
  const { db, client } = createDb(databaseUrl);
  const now = nowIso();

  try {
    const owner = await ensureSeedOwner(db, env);
    if (owner.local) {
      console.log(`Local owner reset: ${LOCAL_OWNER_EMAIL} / ${LOCAL_OWNER_PASSWORD}`);
    } else if (owner.email) {
      console.log(`Admin owner ready for ${owner.email}`);
    } else {
      const demoHash = await hashPassword("change-me-now");
      console.log("No usable ADMIN_PASSWORD_HASH found. Generate one with:");
      console.log('  bun run admin:hash -- "your-password"');
      console.log(`Temporary example hash for local testing: ${demoHash}`);
    }

    const [profile] = await db.select().from(siteProfile).limit(1);
    if (!profile) {
      await db.insert(siteProfile).values({
        displayName: "Zhaohe",
        headline: "Builder, writer, and long-term investor.",
        bioEn:
          "I use this site to keep durable notes on software, markets, and the shape of a thoughtful life online.",
        bioZh: "这里用于记录软件、投资与生活中的长期思考，也给未来的自己留下一条清晰的线索。",
        location: "Singapore",
        email: owner.email ?? null,
        updatedAt: now
      });
    }

    const existingPositions = await db.select().from(portfolioPositions).limit(1);
    if (existingPositions.length === 0) {
      const [vt] = await db.insert(marketAssets).values({
        provider: "alpha_vantage",
        symbol: "VT",
        name: "Vanguard Total World Stock ETF",
        assetType: "ETF",
        region: "Global",
        currency: "USD",
        exchange: "US",
        aliasesJson: JSON.stringify(["全球股票", "全球股票ETF", "先锋全球股票"]),
        createdAt: now,
        updatedAt: now
      }).returning();
      const [sgov] = await db.insert(marketAssets).values({
        provider: "alpha_vantage",
        symbol: "SGOV",
        name: "iShares 0-3 Month Treasury Bond ETF",
        assetType: "ETF",
        region: "US",
        currency: "USD",
        exchange: "US",
        aliasesJson: JSON.stringify(["美国国债", "短期国债", "现金管理"]),
        createdAt: now,
        updatedAt: now
      }).returning();
      const [cash] = await db.insert(marketAssets).values({
        provider: "alpha_vantage",
        symbol: "CASH",
        name: "Cash reserve",
        assetType: "Cash",
        region: "Global",
        currency: "USD",
        exchange: "Manual",
        aliasesJson: JSON.stringify(["现金", "现金储备"]),
        createdAt: now,
        updatedAt: now
      }).returning();
      await db.insert(marketQuotes).values([
        {
          assetId: vt.id,
          provider: "seed",
          price: 1120,
          currency: "USD",
          baseCurrency: "USD",
          fxRateToBase: 1,
          asOf: "2026-05-23",
          fetchedAt: now,
          status: "ok",
          rawJson: "{}"
        },
        {
          assetId: sgov.id,
          provider: "seed",
          price: 306,
          currency: "USD",
          baseCurrency: "USD",
          fxRateToBase: 1,
          asOf: "2026-05-23",
          fetchedAt: now,
          status: "ok",
          rawJson: "{}"
        },
        {
          assetId: cash.id,
          provider: "seed",
          price: 3000,
          currency: "USD",
          baseCurrency: "USD",
          fxRateToBase: 1,
          asOf: "2026-05-23",
          fetchedAt: now,
          status: "ok",
          rawJson: "{}"
        }
      ]);
      await db.insert(portfolioPositions).values([
        {
          assetId: vt.id,
          ticker: "VT",
          name: "Global equities",
          assetClass: "Equity",
          region: "Global",
          currency: "USD",
          quantity: 10,
          costBasisCents: 1000000,
          marketValueCents: 0,
          asOf: "2026-05-23",
          status: "active",
          notes: "Sample diversified equity allocation.",
          createdAt: now,
          updatedAt: now
        },
        {
          assetId: sgov.id,
          ticker: "SGOV",
          name: "Short-term treasury ETF",
          assetClass: "Fixed income",
          region: "US",
          currency: "USD",
          quantity: 20,
          costBasisCents: 600000,
          marketValueCents: 0,
          asOf: "2026-05-23",
          status: "active",
          notes: "Sample defensive allocation.",
          createdAt: now,
          updatedAt: now
        },
        {
          assetId: cash.id,
          ticker: "CASH",
          name: "Cash reserve",
          assetClass: "Cash",
          region: "Global",
          currency: "USD",
          quantity: 1,
          costBasisCents: 300000,
          marketValueCents: 0,
          asOf: "2026-05-23",
          status: "active",
          notes: "Sample liquidity allocation.",
          createdAt: now,
          updatedAt: now
        }
      ]);
    }
  } finally {
    await client.close();
  }
}

if (import.meta.main) {
  await seedDatabase();
  console.log("Seed complete.");
}
