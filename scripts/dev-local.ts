import { SQL } from "bun";
import { seedDatabase } from "../src/server/seed";
import { LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD } from "../src/server/local-owner";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:15433/zhaohe_test";
const apiHost = "127.0.0.1";
const apiPort = "3000";
const siteHost = "127.0.0.1";
const sitePort = "4321";
const adminUrl = `http://${siteHost}:${sitePort}/admin`;
const adminOwnerStatusUrl = `http://${siteHost}:${sitePort}/api/admin/owner-status`;

type ManagedProcess = {
  label: string;
  process: Bun.Subprocess;
};

const children: ManagedProcess[] = [];
let shuttingDown = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStep(label: string, cmd: string[]) {
  console.log(`\n> ${label}`);
  const proc = Bun.spawn(cmd, {
    stdout: "inherit",
    stderr: "inherit",
    env: process.env
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${label} failed with exit code ${code}.`);
}

function spawnManaged(label: string, cmd: string[], env: Record<string, string | undefined>) {
  console.log(`\n> Starting ${label}`);
  const proc = Bun.spawn(cmd, {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, ...env }
  });
  const child = { label, process: proc };
  children.push(child);
  return child;
}

async function waitForDatabase(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const sql = new SQL(databaseUrl);
    try {
      await sql`select 1`;
      await sql.close();
      return;
    } catch (error) {
      lastError = error;
      await sql.close().catch(() => {});
      await sleep(1000);
    }
  }
  throw new Error(`Postgres did not become ready at 127.0.0.1:15433. Last error: ${lastError}`);
}

async function waitForHttp(url: string, label: string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(`${label} did not become ready at ${url}. Last error: ${lastError}`);
}

async function waitForJson(
  url: string,
  label: string,
  validate: (data: unknown) => boolean,
  timeoutMs = 45_000
) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      const text = await response.text();
      if (!response.ok) {
        lastError = `${response.status} ${response.statusText}: ${text.slice(0, 160)}`;
      } else {
        const data = text ? JSON.parse(text) : {};
        if (validate(data)) return;
        lastError = `Unexpected JSON response: ${text.slice(0, 160)}`;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(`${label} did not become ready at ${url}. Last error: ${lastError}`);
}

async function stopChildren() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      child.process.kill();
    } catch {
      // Already stopped.
    }
  }
  await Promise.allSettled(children.map((child) => child.process.exited));
}

function installSignalHandlers() {
  const shutdown = () => {
    stopChildren().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main() {
  installSignalHandlers();

  await runStep("Starting local Postgres", ["docker", "compose", "-f", "compose.test.yaml", "up", "-d"]);
  console.log("\n> Waiting for local Postgres");
  await waitForDatabase();

  console.log("\n> Preparing local owner and seed data");
  await seedDatabase(databaseUrl, process.env);

  const api = spawnManaged("API", ["bun", "run", "dev:api"], {
    DATABASE_URL: databaseUrl,
    DISABLE_MARKET_REFRESH: "1",
    HOST: apiHost,
    PORT: apiPort
  });

  await waitForHttp(`http://${apiHost}:${apiPort}/api/health`, "API");

  const site = spawnManaged("Astro site", ["bunx", "--bun", "astro", "dev", "--host", siteHost, "--port", sitePort], {
    API_PROXY_TARGET: `http://${apiHost}:${apiPort}`,
    ASTRO_TELEMETRY_DISABLED: "1"
  });

  await waitForHttp(adminUrl, "Astro site");
  await waitForJson(
    adminOwnerStatusUrl,
    "Astro admin API proxy",
    (data) => Boolean(data && typeof data === "object" && "apiOk" in data && (data as { apiOk?: unknown }).apiOk)
  );

  console.log("\nLocal management is ready.");
  console.log(`Admin: ${adminUrl}`);
  console.log(`Login: ${LOCAL_OWNER_EMAIL} / ${LOCAL_OWNER_PASSWORD}`);
  console.log("\nPress Ctrl+C to stop the API and site. Local Postgres will keep running.");

  const firstExit = await Promise.race([
    api.process.exited.then((code) => ({ label: api.label, code })),
    site.process.exited.then((code) => ({ label: site.label, code }))
  ]);
  if (!shuttingDown) {
    console.error(`\n${firstExit.label} exited with code ${firstExit.code}. Stopping local dev runtime.`);
    await stopChildren();
    process.exit(firstExit.code || 1);
  }
}

main().catch(async (error) => {
  await stopChildren();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
