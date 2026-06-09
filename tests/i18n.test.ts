import { describe, expect, test } from "bun:test";
import { alternatePath, localePath, nav } from "../src/lib/i18n";

describe("i18n routes", () => {
  test("English is canonical at the root and Chinese lives under /zh", () => {
    expect(localePath("en", "/blog")).toBe("/blog");
    expect(localePath("zh", "/blog")).toBe("/zh/blog");
    expect(localePath("zh", "/")).toBe("/zh");
  });

  test("alternate paths swap between English and Chinese", () => {
    expect(alternatePath("en", "/portfolio")).toBe("/zh/portfolio");
    expect(alternatePath("zh", "/zh/portfolio")).toBe("/portfolio");
    expect(alternatePath("zh", "/zh")).toBe("/");
  });

  test("archive is removed from main navigation and kept as a blog alias", () => {
    expect(nav("en").map(([label]) => label)).not.toContain("Archive");
    expect(nav("zh").map(([label]) => label)).not.toContain("归档");
    expect(alternatePath("en", "/archive")).toBe("/zh/archive");
    expect(alternatePath("zh", "/zh/archive")).toBe("/archive");
  });

  test("public navigation uses blogs, portfolio, and about/contact", () => {
    expect(nav("en").map(([label]) => label)).toEqual(["Blogs", "Portfolio", "About & Contact"]);
    expect(nav("zh").map(([label]) => label)).toEqual(["博客", "投资组合", "关于与联系"]);
  });
});
