import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const encoder = new TextEncoder();

export function nowIso() {
  return new Date().toISOString();
}

export function addDays(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function emailHash(email?: string) {
  if (!email) return null;
  return sha256(email.trim().toLowerCase());
}

export async function hashPassword(password: string) {
  const salt = randomToken(18);
  const iterations = 210000;
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations },
    key,
    256
  );
  return `pbkdf2$${iterations}$${salt}$${Buffer.from(bits).toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [scheme, iterationsText, salt, expected] = encoded.split("$");
  if (scheme !== "pbkdf2" || !iterationsText || !salt || !expected) return false;
  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations < 100000) return false;

  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations },
    key,
    256
  );
  const actual = Buffer.from(bits).toString("base64url");
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function safeJson(value: unknown) {
  return JSON.stringify(value ?? {});
}
