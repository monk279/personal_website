export const site = {
  name: "Zhaohe",
  domain: "zhaohe.me",
  url: "https://zhaohe.me",
  defaultLocale: "en",
  locales: ["en", "zh"] as const,
  email: "hello@zhaohe.me",
  profile: {
    en: {
      eyebrow: "Personal website",
      headline: "Builder, writer, and long-term investor.",
      intro:
        "I write about software, markets, personal systems, and the process of building a durable life online.",
      about:
        "This website is a public notebook and a home base. It keeps my long-form writing, conversations with readers, and portfolio notes in one place."
    },
    zh: {
      eyebrow: "个人网站",
      headline: "记录软件、投资与长期生活的个人空间。",
      intro: "我会在这里写软件、市场、个人系统，以及如何在互联网上构建一个长期可维护的自我表达空间。",
      about: "这个网站是我的公开笔记和线上基地，用来整理长文、读者交流与投资组合记录。"
    }
  },
  nav: {
    en: [
      ["Blogs", "/blog"],
      ["Portfolio", "/portfolio"],
      ["About & Contact", "/about"]
    ],
    zh: [
      ["博客", "/zh/blog"],
      ["投资组合", "/zh/portfolio"],
      ["关于与联系", "/zh/about"]
    ]
  }
} as const;

export type Locale = (typeof site.locales)[number];
