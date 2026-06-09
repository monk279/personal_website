import type { Locale } from "@/config/site";

export type BlogFrontmatter = {
  title: string;
  description: string;
  publishedAt: string;
  updatedAt?: string;
  lang: Locale;
  slug: string;
  tags: string[];
  category: string;
  heroImage?: string;
  draft?: boolean;
  aliases?: string[];
};

export type BlogPost = BlogFrontmatter & {
  id: string;
  Content: any;
};

const modules = import.meta.glob("../content/blog/*.mdx", { eager: true });

export function getAllPosts() {
  return Object.entries(modules)
    .map(([id, module]) => {
      const loaded = module as { frontmatter: BlogFrontmatter; default: unknown };
      return {
        id,
        Content: loaded.default,
        ...loaded.frontmatter
      };
    })
    .filter((post) => !post.draft)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

export function getPosts(locale: Locale) {
  return getAllPosts().filter((post) => post.lang === locale);
}

export function getLatestPosts(locale: Locale, count = 3) {
  return getPosts(locale).slice(0, count);
}

export function getTags(locale: Locale) {
  return [...new Set(getPosts(locale).flatMap((post) => post.tags))].sort((a, b) => a.localeCompare(b));
}

export function getPostsByTag(locale: Locale, tag: string) {
  return getPosts(locale).filter((post) => post.tags.includes(tag));
}
