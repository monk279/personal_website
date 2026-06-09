import { Database } from "bun:sqlite";
import { createDb } from "../src/server/db/client";
import { ensureSchema } from "../src/server/db/migrate";

const sqliteFile = process.argv[2] ?? "./data/site.sqlite";
const databaseUrl = process.env.DATABASE_URL;

await ensureSchema(databaseUrl);
const sqlite = new Database(sqliteFile, { readonly: true });
const { client } = createDb(databaseUrl);

const tables = [
  "admins",
  "sessions",
  "comments",
  "guestbook_entries",
  "portfolio_positions",
  "portfolio_cashflows",
  "portfolio_snapshots",
  "audit_events",
  "site_profile",
  "content_posts"
];

for (const table of tables) {
  const rows = sqlite.query(`select * from ${table}`).all() as Record<string, unknown>[];
  for (const row of rows) {
    const columns = Object.keys(row);
    const values = columns.map((column) => row[column]);
    const quotedColumns = columns.map((column) => `"${column}"`).join(", ");
    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
    await client.unsafe(`insert into ${table} (${quotedColumns}) values (${placeholders}) on conflict do nothing`, values);
  }
  console.log(`Imported ${rows.length} row(s) from ${table}.`);
}

sqlite.close();
await client.close();
console.log("SQLite import complete.");
