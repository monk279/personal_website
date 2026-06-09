import { sha256 } from "./security";

type Submission = {
  name: string;
  body: string;
  website?: string | null;
  email?: string;
  company?: string;
};

type GuardResult =
  | { action: "accept"; status: "pending" | "spam"; reason?: string }
  | { action: "drop"; status: "pending"; reason: string };

const suspiciousPatterns = [
  /<\s*script/i,
  /javascript:/i,
  /onerror\s*=/i,
  /onload\s*=/i,
  /\b(select|union|insert|drop|delete)\b.+\b(from|table|where)\b/i,
  /\b(?:free money|guaranteed profit|casino|loan offer)\b/i
];

function countLinks(value: string) {
  return (value.match(/https?:\/\/|www\./gi) ?? []).length;
}

function repeatedCharacterRun(value: string) {
  return /(.)\1{16,}/.test(value);
}

export function classifyPublicSubmission(input: Submission, ip: string): GuardResult {
  if (input.company?.trim()) {
    return { action: "drop", status: "pending", reason: "honeypot" };
  }

  const combined = `${input.name}\n${input.body}\n${input.website ?? ""}`;
  if (combined.length > 3500 || repeatedCharacterRun(combined)) {
    return { action: "accept", status: "spam", reason: "malformed-content" };
  }

  if (countLinks(input.body) > 2) {
    return { action: "accept", status: "spam", reason: "too-many-links" };
  }

  if (suspiciousPatterns.some((pattern) => pattern.test(combined))) {
    return { action: "accept", status: "spam", reason: "suspicious-pattern" };
  }

  const fingerprint = sha256(`${ip}:${input.body.toLowerCase().replace(/\s+/g, " ").trim()}`);
  if (fingerprint.length !== 64) {
    return { action: "accept", status: "spam", reason: "invalid-fingerprint" };
  }

  return { action: "accept", status: "pending" };
}
