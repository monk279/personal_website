import { z } from "zod";

const urlField = z
  .string()
  .trim()
  .max(200)
  .optional()
  .or(z.literal(""))
  .transform((value) => {
    if (!value) return null;
    try {
      const url = new URL(value.startsWith("http") ? value : `https://${value}`);
      return url.toString();
    } catch {
      return null;
    }
  });

const optionalEmailField = z
  .string()
  .trim()
  .email()
  .max(160)
  .optional()
  .or(z.literal(""))
  .nullable()
  .transform((value) => value || null);

export const publicCommentSchema = z.object({
  targetType: z.enum(["blog", "portfolio"]).default("blog"),
  targetSlug: z.string().trim().min(1).max(160).optional(),
  postSlug: z.string().trim().min(1).max(160).optional(),
  parentId: z.number().int().positive().optional().nullable(),
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  website: urlField,
  body: z.string().trim().min(2).max(3000),
  company: z.string().optional()
}).transform((value) => ({
  ...value,
  targetSlug: value.targetSlug ?? value.postSlug ?? ""
})).refine((value) => value.targetSlug.length > 0, {
  path: ["targetSlug"],
  message: "Missing target slug."
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(160),
  password: z.string().min(8).max(200)
});

export const moderationSchema = z.object({
  status: z.enum(["pending", "approved", "hidden", "spam"]).optional(),
  ownerReply: z.string().trim().max(3000).optional().nullable()
});

export const positionSchema = z.object({
  assetId: z.number().int().positive().optional().nullable(),
  provider: z.string().trim().min(1).max(80).default("alpha_vantage"),
  exchange: z.string().trim().max(120).optional().nullable(),
  aliases: z.union([z.string().trim().max(500), z.array(z.string().trim().max(80)).max(20)]).optional().nullable(),
  ticker: z.string().trim().min(1).max(24),
  name: z.string().trim().min(1).max(120),
  assetClass: z.string().trim().min(1).max(80),
  region: z.string().trim().min(1).max(80),
  currency: z.string().trim().min(3).max(8).transform((value) => value.toUpperCase()),
  quantity: z.number().positive(),
  costBasisCents: z.number().int().nonnegative(),
  marketValueCents: z.number().int().nonnegative().optional().default(0),
  asOf: z.string().trim().min(8).max(40).optional(),
  status: z.enum(["active", "watchlist", "closed"]).default("active"),
  notes: z.string().trim().max(2000).optional().nullable()
});

export const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  headline: z.string().trim().min(1).max(180),
  bioEn: z.string().trim().min(1).max(1600),
  bioZh: z.string().trim().min(1).max(1600),
  location: z.string().trim().max(120).optional().nullable(),
  email: optionalEmailField
});

export const contentPostSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens."),
  lang: z.enum(["en", "zh"]),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(300),
  bodyMarkdown: z.string().trim().min(1).max(50000),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  category: z.string().trim().min(1).max(80).default("Notes"),
  publishedAt: z.string().trim().max(40).optional().nullable()
});

export const markdownPreviewSchema = z.object({
  bodyMarkdown: z.string().max(50000)
});

export function parseJson<T extends z.ZodTypeAny>(schema: T, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) {
    return {
      ok: false as const,
      issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    };
  }
  return { ok: true as const, data: result.data as z.output<T> };
}
