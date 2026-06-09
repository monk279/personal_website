import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";

export const defaultDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:15433/zhaohe";

export function createDb(databaseUrl = defaultDatabaseUrl) {
  const client = new SQL(databaseUrl);
  return {
    client,
    db: drizzle({ client, schema })
  };
}

export async function closeDb(client: SQL) {
  await client.close();
}
