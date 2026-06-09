import { eq, ne } from "drizzle-orm";
import { admins } from "./db/schema";
import { hashPassword, nowIso } from "./security";

export const LOCAL_OWNER_EMAIL = "owner@example.com";
export const LOCAL_OWNER_PASSWORD = "local-test-password";
export const LOCAL_OWNER_NAME = "Zhaohe";

type AdminDb = {
  select: () => any;
  insert: (table: typeof admins) => any;
  update: (table: typeof admins) => any;
  delete: (table: typeof admins) => any;
};

type RuntimeEnv = Record<string, string | undefined>;

export function isProductionRuntime(env: RuntimeEnv = process.env) {
  return env.NODE_ENV === "production";
}

export function hasUsablePasswordHash(hash: string | undefined) {
  return Boolean(hash && hash.startsWith("pbkdf2$") && !hash.includes("replace-with"));
}

export function shouldUseLocalOwner(env: RuntimeEnv = process.env) {
  return !isProductionRuntime(env) && !hasUsablePasswordHash(env.ADMIN_PASSWORD_HASH);
}

export async function ensureSeedOwner(
  db: AdminDb,
  env: RuntimeEnv = process.env
): Promise<{ email: string | null; local: boolean; passwordHint: string | null; changed: boolean }> {
  const now = nowIso();

  if (shouldUseLocalOwner(env)) {
    await db.delete(admins).where(ne(admins.email, LOCAL_OWNER_EMAIL));
    const passwordHash = await hashPassword(LOCAL_OWNER_PASSWORD);
    const [existing] = await db.select().from(admins).where(eq(admins.email, LOCAL_OWNER_EMAIL)).limit(1);
    if (existing) {
      await db
        .update(admins)
        .set({
          name: LOCAL_OWNER_NAME,
          passwordHash,
          updatedAt: now
        })
        .where(eq(admins.id, existing.id));
    } else {
      await db.insert(admins).values({
        email: LOCAL_OWNER_EMAIL,
        name: LOCAL_OWNER_NAME,
        passwordHash,
        createdAt: now,
        updatedAt: now
      });
    }
    return {
      email: LOCAL_OWNER_EMAIL,
      local: true,
      passwordHint: LOCAL_OWNER_PASSWORD,
      changed: true
    };
  }

  const adminEmail = env.ADMIN_EMAIL;
  const adminPasswordHash = env.ADMIN_PASSWORD_HASH;
  if (adminEmail && hasUsablePasswordHash(adminPasswordHash)) {
    const [existing] = await db.select().from(admins).where(eq(admins.email, adminEmail)).limit(1);
    if (existing) {
      await db
        .update(admins)
        .set({
          passwordHash: adminPasswordHash,
          updatedAt: now
        })
        .where(eq(admins.id, existing.id));
    } else {
      await db.insert(admins).values({
        email: adminEmail,
        name: LOCAL_OWNER_NAME,
        passwordHash: adminPasswordHash,
        createdAt: now,
        updatedAt: now
      });
    }
    return { email: adminEmail, local: false, passwordHint: null, changed: true };
  }

  return { email: null, local: false, passwordHint: null, changed: false };
}
