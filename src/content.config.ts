import { defineCollection, z } from "astro:content";

const blog = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.string(),
    updatedAt: z.string().optional(),
    lang: z.enum(["en", "zh"]),
    tags: z.array(z.string()),
    category: z.string(),
    heroImage: z.string().optional(),
    draft: z.boolean().default(false),
    aliases: z.array(z.string()).default([])
  })
});

export const collections = { blog };
