import { eq } from "drizzle-orm";
import { marketAssets, marketQuotes, portfolioPositions } from "./db/schema";
import type { createDb } from "./db/client";
import { quoteIsStale } from "./market/service";

type Db = ReturnType<typeof createDb>["db"];

function roundPercent(value: number) {
  return Math.round(value * 100) / 100;
}

function addAllocation(target: Map<string, number>, key: string, value: number) {
  target.set(key, (target.get(key) ?? 0) + value);
}

function toAllocation(map: Map<string, number>, total: number) {
  return [...map.entries()]
    .map(([label, value]) => ({ label, weightPercent: total > 0 ? roundPercent((value / total) * 100) : 0 }))
    .sort((a, b) => b.weightPercent - a.weightPercent);
}

export async function getPublicPortfolio(db: Db) {
  const rows = await db
    .select()
    .from(portfolioPositions)
    .where(eq(portfolioPositions.status, "active"));

  const valuedHoldings = [];
  const unpricedHoldings = [];

  for (const row of rows) {
    const [asset] = row.assetId
      ? await db.select().from(marketAssets).where(eq(marketAssets.id, row.assetId)).limit(1)
      : [];
    const [quote] = row.assetId
      ? await db.select().from(marketQuotes).where(eq(marketQuotes.assetId, row.assetId)).limit(1)
      : [];

    if (!quote || quote.price <= 0 || quote.fxRateToBase <= 0) {
      unpricedHoldings.push({
        ticker: row.ticker,
        name: row.name,
        assetClass: row.assetClass,
        region: row.region,
        currency: asset?.currency ?? row.currency,
        asOf: row.asOf,
        quoteStatus: "missing"
      });
      continue;
    }

    const marketValueBase = row.quantity * quote.price * quote.fxRateToBase;
    valuedHoldings.push({
      row,
      asset,
      quote,
      marketValueBase,
      quoteStale: quote.status !== "ok" || quoteIsStale(quote.fetchedAt)
    });
  }

  const totalMarketValue = valuedHoldings.reduce((sum, holding) => sum + holding.marketValueBase, 0);
  const totalCostBasis = valuedHoldings.reduce((sum, holding) => sum + holding.row.costBasisCents / 100, 0);
  const byAssetClass = new Map<string, number>();
  const byRegion = new Map<string, number>();
  const byCurrency = new Map<string, number>();

  for (const holding of valuedHoldings) {
    addAllocation(byAssetClass, holding.row.assetClass, holding.marketValueBase);
    addAllocation(byRegion, holding.row.region, holding.marketValueBase);
    addAllocation(byCurrency, holding.asset?.currency ?? holding.row.currency, holding.marketValueBase);
  }

  const holdings = valuedHoldings
    .map(({ row, asset, quote, marketValueBase, quoteStale }) => ({
      ticker: row.ticker,
      name: row.name,
      assetClass: row.assetClass,
      region: row.region,
      currency: asset?.currency ?? row.currency,
      weightPercent: totalMarketValue > 0 ? roundPercent((marketValueBase / totalMarketValue) * 100) : 0,
      returnPercent: row.costBasisCents > 0 ? roundPercent(((marketValueBase - row.costBasisCents / 100) / (row.costBasisCents / 100)) * 100) : 0,
      asOf: row.asOf,
      quoteAsOf: quote.asOf,
      quoteFetchedAt: quote.fetchedAt,
      quoteStatus: quoteStale ? "stale" : "fresh"
    }))
    .sort((a, b) => b.weightPercent - a.weightPercent);

  const quoteTimes = valuedHoldings.map((holding) => holding.quote.fetchedAt).filter(Boolean).sort();

  return {
    asOf: rows.map((row) => row.asOf).sort().at(-1) ?? null,
    baseCurrency: "USD",
    quoteFreshness: {
      latestFetchedAt: quoteTimes.at(-1) ?? null,
      staleCount: valuedHoldings.filter((holding) => holding.quoteStale).length,
      missingCount: unpricedHoldings.length
    },
    totalReturnPercent: totalCostBasis > 0 ? roundPercent(((totalMarketValue - totalCostBasis) / totalCostBasis) * 100) : 0,
    assetAllocation: toAllocation(byAssetClass, totalMarketValue),
    regionAllocation: toAllocation(byRegion, totalMarketValue),
    currencyAllocation: toAllocation(byCurrency, totalMarketValue),
    holdings,
    unpricedHoldings,
    privacy: {
      redactedFields: ["quantity", "costBasisCents", "latestPrice", "marketValue", "accountValue", "fxRateToBase"],
      message: "Public data is limited to percentages and quote freshness. This is not investment advice."
    }
  };
}
