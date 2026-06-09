export type MarketAssetSearchResult = {
  id?: number | null;
  provider: string;
  symbol: string;
  name: string;
  assetType: string;
  region: string | null;
  currency: string;
  exchange: string | null;
  aliases?: string[];
  source?: "provider" | "cache" | "manual";
  matchScore?: number;
};

export type MarketProviderStatus = {
  ok: boolean;
  provider: string;
  code?: string;
  message?: string;
};

export type MarketQuote = {
  provider: string;
  symbol: string;
  price: number;
  currency: string;
  asOf: string;
  raw?: unknown;
};

export type ExchangeRate = {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  asOf: string;
  raw?: unknown;
};

export type MarketDataProvider = {
  name: string;
  searchAssets(query: string): Promise<MarketAssetSearchResult[]>;
  getQuote(symbol: string): Promise<MarketQuote>;
  getExchangeRate(fromCurrency: string, toCurrency: string): Promise<ExchangeRate>;
};

export class MarketDataError extends Error {
  code: string;

  constructor(message: string, code = "MARKET_DATA_ERROR") {
    super(message);
    this.code = code;
  }
}
