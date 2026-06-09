import { site, type Locale } from "@/config/site";

export function localePath(locale: Locale, path: string) {
  if (locale === "en") return path;
  if (path === "/") return "/zh";
  return `/zh${path}`;
}

export function alternateLocale(locale: Locale) {
  return locale === "en" ? "zh" : "en";
}

export function alternatePath(locale: Locale, path: string) {
  const next = alternateLocale(locale);
  if (next === "zh") return path === "/" ? "/zh" : `/zh${path}`;
  return path.replace(/^\/zh(?=\/|$)/, "") || "/";
}

export function labels(locale: Locale) {
  return {
    en: {
      latestPosts: "Latest Blogs",
      portfolio: "Investment sharing",
      readMore: "Read more",
      comments: "Comments",
      submit: "Submit",
      pending: "Thanks. Your note is pending moderation.",
      notAdvice: "This is a personal record, not investment advice.",
      language: "中文"
    },
    zh: {
      latestPosts: "最新博客",
      portfolio: "投资分享",
      readMore: "继续阅读",
      comments: "评论",
      submit: "提交",
      pending: "谢谢，内容会在审核后显示。",
      notAdvice: "这是个人记录，不构成投资建议。",
      language: "English"
    }
  }[locale];
}

export function nav(locale: Locale) {
  return site.nav[locale];
}
