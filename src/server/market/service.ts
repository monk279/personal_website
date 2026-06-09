import { and, eq, inArray, ne } from "drizzle-orm";
import { marketAssets, marketQuotes, portfolioPositions } from "../db/schema";
import { nowIso, safeJson } from "../security";
import type { createDb } from "../db/client";
import type { MarketAssetSearchResult, MarketDataProvider } from "./types";

type Db = ReturnType<typeof createDb>["db"];

export const BASE_CURRENCY = "USD";
const staleAfterMs = 60 * 60 * 1000;

export function quoteIsStale(fetchedAt?: string | null, now = Date.now()) {
  if (!fetchedAt) return true;
  const fetchedTime = new Date(fetchedAt).getTime();
  return !Number.isFinite(fetchedTime) || now - fetchedTime > staleAfterMs;
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase();
}

export function parseAssetAliases(value?: string | string[] | null) {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean).slice(0, 20);
  if (!value) return [];
  if (value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean).slice(0, 20);
    } catch {
      return [];
    }
  }
  return value.split(/[,\n，、]/).map((item) => item.trim()).filter(Boolean).slice(0, 20);
}

function normalizeSearch(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function fuzzyScore(query: string, value: string, weight: number) {
  const q = normalizeSearch(query);
  const v = normalizeSearch(value);
  if (!q || !v) return 0;
  if (v === q) return weight;
  if (v.startsWith(q)) return weight * 0.88;
  if (v.includes(q)) return weight * 0.72;

  let cursor = 0;
  let matches = 0;
  for (const char of q) {
    const found = v.indexOf(char, cursor);
    if (found === -1) continue;
    matches += 1;
    cursor = found + 1;
  }
  const ratio = matches / q.length;
  return ratio >= 0.72 ? weight * ratio * 0.56 : 0;
}

export async function ensureMarketAsset(db: Db, input: {
  provider?: string | null;
  symbol: string;
  name: string;
  assetType?: string | null;
  region?: string | null;
  currency?: string | null;
  exchange?: string | null;
  aliases?: string | string[] | null;
}) {
  const provider = input.provider || "alpha_vantage";
  const symbol = normalizeSymbol(input.symbol);
  const now = nowIso();
  const values = {
    provider,
    symbol,
    name: input.name.trim(),
    assetType: input.assetType?.trim() || "Equity",
    region: input.region?.trim() || null,
    currency: input.currency?.trim().toUpperCase() || BASE_CURRENCY,
    exchange: input.exchange?.trim() || null,
    updatedAt: now
  };
  const aliasValues = input.aliases !== undefined
    ? { aliasesJson: JSON.stringify(parseAssetAliases(input.aliases)) }
    : {};
  const [existing] = await db
    .select()
    .from(marketAssets)
    .where(and(eq(marketAssets.provider, provider), eq(marketAssets.symbol, symbol)))
    .limit(1);

  if (existing) {
    const [asset] = await db
      .update(marketAssets)
      .set({ ...values, ...aliasValues })
      .where(eq(marketAssets.id, existing.id))
      .returning();
    return asset;
  }

  const [asset] = await db
    .insert(marketAssets)
    .values({ ...values, ...aliasValues, createdAt: now })
    .returning();
  return asset;
}

export async function upsertSearchResults(db: Db, results: MarketAssetSearchResult[]) {
  const assets = [];
  for (const result of results) {
    assets.push(
      await ensureMarketAsset(db, {
        provider: result.provider,
        symbol: result.symbol,
        name: result.name,
        assetType: result.assetType,
        region: result.region,
        currency: result.currency,
        exchange: result.exchange,
        aliases: result.aliases
      })
    );
  }
  return assets;
}

export async function searchCachedMarketAssets(db: Db, query: string) {
  const q = query.trim();
  if (!q) return [];
  const rows = await db.select().from(marketAssets).limit(500);
  return rows
    .map((asset) => {
      const aliases = parseAssetAliases(asset.aliasesJson);
      const aliasScore = Math.max(0, ...aliases.map((alias) => fuzzyScore(q, alias, 0.92)));
      const score = Math.max(
        fuzzyScore(q, asset.symbol, 1),
        fuzzyScore(q, asset.name, 0.9),
        fuzzyScore(q, asset.assetType, 0.45),
        fuzzyScore(q, asset.exchange ?? "", 0.35),
        fuzzyScore(q, asset.region ?? "", 0.35),
        fuzzyScore(q, asset.currency, 0.25),
        aliasScore
      );
      return {
        id: asset.id,
        provider: asset.provider,
        symbol: asset.symbol,
        name: asset.name,
        assetType: asset.assetType,
        region: asset.region,
        currency: asset.currency,
        exchange: asset.exchange,
        aliases,
        source: "cache" as const,
        matchScore: Math.round(score * 1000) / 1000
      };
    })
    .filter((asset) => asset.matchScore > 0)
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
    .slice(0, 12);
}

export async function refreshAssetQuote(db: Db, provider: MarketDataProvider, assetId: number) {
  const [asset] = await db.select().from(marketAssets).where(eq(marketAssets.id, assetId)).limit(1);
  if (!asset) return { ok: false as const, assetId, error: "Asset not found." };

  try {
    const quote = await provider.getQuote(asset.symbol);
    const quoteCurrency = asset.currency || quote.currency || BASE_CURRENCY;
    const fx = quoteCurrency === BASE_CURRENCY
      ? { rate: 1, asOf: quote.asOf, raw: null }
      : await provider.getExchangeRate(quoteCurrency, BASE_CURRENCY);
    const values = {
      assetId: asset.id,
      provider: provider.name,
      price: quote.price,
      currency: quoteCurrency,
      baseCurrency: BASE_CURRENCY,
      fxRateToBase: fx.rate,
      asOf: quote.asOf,
      fetchedAt: nowIso(),
      status: "ok",
      error: null,
      rawJson: safeJson({ quote: quote.raw, fx: fx.raw })
    };
    const [existing] = await db.select().from(marketQuotes).where(eq(marketQuotes.assetId, asset.id)).limit(1);
    const [stored] = existing
      ? await db.update(marketQuotes).set(values).where(eq(marketQuotes.id, existing.id)).returning()
      : await db.insert(marketQuotes).values(values).returning();
    return { ok: true as const, asset, quote: stored };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Quote refresh failed.";
    const [existing] = await db.select().from(marketQuotes).where(eq(marketQuotes.assetId, asset.id)).limit(1);
    if (existing) {
      await db
        .update(marketQuotes)
        .set({ status: "stale", error: message, fetchedAt: existing.fetchedAt })
        .where(eq(marketQuotes.id, existing.id));
    }
    return { ok: false as const, asset, assetId: asset.id, error: message };
  }
}

export async function refreshQuotesForPositions(db: Db, provider: MarketDataProvider, assetIds?: number[]) {
  const positionRows = await db
    .select()
    .from(portfolioPositions)
    .where(assetIds?.length ? inArray(portfolioPositions.assetId, assetIds) : ne(portfolioPositions.status, "closed"));
  const uniqueAssetIds = [...new Set(positionRows.map((position) => position.assetId).filter((id): id is number => Number.isInteger(id)))];
  const results = [];
  for (const assetId of uniqueAssetIds) {
    results.push(await refreshAssetQuote(db, provider, assetId));
  }
  return results;
}

export async function refreshStaleQuotesForPositions(db: Db, provider: MarketDataProvider) {
  const positionRows = await db
    .select()
    .from(portfolioPositions)
    .where(eq(portfolioPositions.status, "active"));
  const uniqueAssetIds = [...new Set(positionRows.map((position) => position.assetId).filter((id): id is number => Number.isInteger(id)))];
  const staleAssetIds = [];
  for (const assetId of uniqueAssetIds) {
    const [quote] = await db.select().from(marketQuotes).where(eq(marketQuotes.assetId, assetId)).limit(1);
    if (!quote || quoteIsStale(quote.fetchedAt)) staleAssetIds.push(assetId);
  }
  return refreshQuotesForPositions(db, provider, staleAssetIds);
}
