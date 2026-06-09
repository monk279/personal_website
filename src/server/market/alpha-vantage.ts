import { MarketDataError, type ExchangeRate, type MarketAssetSearchResult, type MarketDataProvider, type MarketQuote } from "./types";

type AlphaVantageOptions = {
  apiKey?: string;
  fetcher?: typeof fetch;
};

const endpoint = "https://www.alphavantage.co/query";

function requireApiKey(apiKey?: string) {
  if (!apiKey || apiKey.includes("replace-with")) {
    throw new MarketDataError("ALPHA_VANTAGE_API_KEY is not configured.", "MARKET_DATA_UNCONFIGURED");
  }
  return apiKey;
}

function readProviderError(payload: any) {
  return payload?.["Error Message"] || payload?.Note || payload?.Information || payload?.["Information"];
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function createAlphaVantageProvider(options: AlphaVantageOptions = {}): MarketDataProvider {
  const apiKey = options.apiKey ?? process.env.ALPHA_VANTAGE_API_KEY;
  const fetcher = options.fetcher ?? fetch;

  async function request(params: Record<string, string>) {
    const url = new URL(endpoint);
    for (const [key, value] of Object.entries({ ...params, apikey: requireApiKey(apiKey) })) {
      url.searchParams.set(key, value);
    }
    const response = await fetcher(url);
    if (!response.ok) throw new MarketDataError(`Alpha Vantage request failed with ${response.status}.`, "MARKET_DATA_HTTP");
    const payload = await response.json();
    const providerError = readProviderError(payload);
    if (providerError) throw new MarketDataError(String(providerError), "MARKET_DATA_PROVIDER");
    return payload;
  }

  return {
    name: "alpha_vantage",

    async searchAssets(query: string): Promise<MarketAssetSearchResult[]> {
      const payload = await request({ function: "SYMBOL_SEARCH", keywords: query });
      const matches = Array.isArray(payload.bestMatches) ? payload.bestMatches : [];
      return matches.slice(0, 12).map((match: any) => ({
        provider: "alpha_vantage",
        symbol: String(match["1. symbol"] ?? "").trim().toUpperCase(),
        name: String(match["2. name"] ?? "").trim(),
        assetType: String(match["3. type"] ?? "Equity").trim() || "Equity",
        region: String(match["4. region"] ?? "").trim() || null,
        currency: String(match["8. currency"] ?? "USD").trim().toUpperCase() || "USD",
        exchange: String(match["4. region"] ?? "").trim() || null,
        matchScore: asNumber(match["9. matchScore"]) ?? undefined
      })).filter((asset: MarketAssetSearchResult) => asset.symbol && asset.name);
    },

    async getQuote(symbol: string): Promise<MarketQuote> {
      const normalized = symbol.trim().toUpperCase();
      const payload = await request({ function: "GLOBAL_QUOTE", symbol: normalized });
      const quote = payload["Global Quote"];
      const price = asNumber(quote?.["05. price"]);
      if (!quote || price === null || price <= 0) {
        throw new MarketDataError(`No quote returned for ${normalized}.`, "MARKET_DATA_EMPTY_QUOTE");
      }
      return {
        provider: "alpha_vantage",
        symbol: normalized,
        price,
        currency: "USD",
        asOf: String(quote["07. latest trading day"] ?? new Date().toISOString()).trim(),
        raw: payload
      };
    },

    async getExchangeRate(fromCurrency: string, toCurrency: string): Promise<ExchangeRate> {
      const from = fromCurrency.trim().toUpperCase();
      const to = toCurrency.trim().toUpperCase();
      if (from === to) {
        return { fromCurrency: from, toCurrency: to, rate: 1, asOf: new Date().toISOString() };
      }
      const payload = await request({
        function: "CURRENCY_EXCHANGE_RATE",
        from_currency: from,
        to_currency: to
      });
      const exchange = payload["Realtime Currency Exchange Rate"];
      const rate = asNumber(exchange?.["5. Exchange Rate"]);
      if (!exchange || rate === null || rate <= 0) {
        throw new MarketDataError(`No FX rate returned for ${from}/${to}.`, "MARKET_DATA_EMPTY_FX");
      }
      return {
        fromCurrency: from,
        toCurrency: to,
        rate,
        asOf: String(exchange["6. Last Refreshed"] ?? new Date().toISOString()).trim(),
        raw: payload
      };
    }
  };
}
