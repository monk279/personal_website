import { createApp } from "./app";
import { createAlphaVantageProvider } from "./market/alpha-vantage";
import { refreshStaleQuotesForPositions } from "./market/service";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const provider = createAlphaVantageProvider();
const { app, db } = await createApp({ marketDataProvider: provider });

Bun.serve({
  hostname: host,
  port,
  fetch: app.fetch
});

if (process.env.DISABLE_MARKET_REFRESH !== "1") {
  setInterval(() => {
    refreshStaleQuotesForPositions(db, provider).catch((error) => {
      console.error("Market quote refresh failed:", error);
    });
  }, 60 * 60 * 1000);
}

console.log(`zhaohe.me API listening on http://${host}:${port}`);
