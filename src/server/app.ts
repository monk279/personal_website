import { mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { classifyPublicSubmission } from "./abuse-filter";
import { createDb } from "./db/client";
import { ensureSchema } from "./db/migrate";
import {
  admins,
  auditEvents,
  comments,
  contentPostRevisions,
  contentPosts,
  marketQuotes,
  portfolioPositions,
  sessions,
  siteProfile,
  uploadedAssets
} from "./db/schema";
import { escapeHtml, excerptFromMarkdown, renderMarkdown } from "../lib/markdown";
import { isProductionRuntime, LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD } from "./local-owner";
import { createAlphaVantageProvider } from "./market/alpha-vantage";
import { ensureMarketAsset, parseAssetAliases, refreshQuotesForPositions, searchCachedMarketAssets, upsertSearchResults } from "./market/service";
import { MarketDataError, type MarketAssetSearchResult, type MarketDataProvider, type MarketProviderStatus } from "./market/types";
import { getPublicPortfolio } from "./portfolio";
import { checkRateLimit } from "./rate-limit";
import {
  addDays,
  emailHash,
  nowIso,
  randomToken,
  safeJson,
  sha256,
  verifyPassword
} from "./security";
import {
  loginSchema,
  moderationSchema,
  markdownPreviewSchema,
  parseJson,
  positionSchema,
  profileSchema,
  contentPostSchema,
  publicCommentSchema
} from "./validation";

type AppOptions = {
  databaseUrl?: string;
  marketDataProvider?: MarketDataProvider;
};

const sessionCookie = "zhaohe_session";

function isAllowedLocalAdminOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  } catch {
    return false;
  }
}

function siteIsHttps() {
  return process.env.NODE_ENV === "production" && (process.env.SITE_URL ?? "").startsWith("https://");
}

function clientIp(c: { req: { header(name: string): string | undefined } }) {
  const forwarded = c.req.header("cf-connecting-ip") ?? c.req.header("x-real-ip") ?? c.req.header("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

function publicComment(row: typeof comments.$inferSelect) {
  return {
    id: row.id,
    targetType: row.targetType,
    targetSlug: row.postSlug,
    parentId: row.parentId,
    authorName: row.authorName,
    authorWebsite: row.authorWebsite,
    body: row.body,
    ownerReply: row.ownerReply,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt
  };
}

function parseTags(tagsJson: string) {
  try {
    const parsed = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function publicContentPost(row: typeof contentPosts.$inferSelect, includeBody = false) {
  const summary = {
    id: row.id,
    slug: row.slug,
    lang: row.lang,
    title: row.title,
    description: row.description,
    status: row.status,
    tags: parseTags(row.tagsJson),
    category: row.category,
    version: row.version,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    href: row.lang === "zh" ? `/zh/blog/${encodeURIComponent(row.slug)}` : `/blog/${encodeURIComponent(row.slug)}`
  };
  if (!includeBody) return summary;
  return {
    ...summary,
    bodyMarkdown: row.bodyMarkdown,
    bodyHtml: renderMarkdown(row.bodyMarkdown),
    excerpt: excerptFromMarkdown(row.bodyMarkdown)
  };
}

async function readBody(c: any) {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

function commentsWidget(locale: "en" | "zh", targetType: "blog" | "portfolio", targetSlug: string) {
  const empty = locale === "zh" ? "还没有公开评论。" : "No public comments yet.";
  const name = locale === "zh" ? "名字" : "Name";
  const website = locale === "zh" ? "网站" : "Website";
  const comment = locale === "zh" ? "评论" : "Comment";
  const pending = locale === "zh" ? "评论会先进入审核，通过后公开显示。" : "Comments go to moderation first and appear publicly after approval.";
  const submit = locale === "zh" ? "提交" : "Submit";
  const submitted = locale === "zh" ? "已提交，正在等待审核。" : "Thanks. Your comment is pending moderation.";
  return `
    <section class="comments" data-comments data-target-type="${targetType}" data-target-slug="${escapeHtml(targetSlug)}">
      <h2>${locale === "zh" ? "评论" : "Comments"}</h2>
      <div data-comment-list><p class="muted">${empty}</p></div>
      <form data-comment-form>
        <label>${name}<input name="name" maxlength="80" required></label>
        <label>Email<input name="email" type="email" maxlength="160"></label>
        <label>${website}<input name="website" maxlength="200"></label>
        <label>${comment}<textarea name="body" maxlength="3000" required></textarea></label>
        <label class="hp">Company<input name="company" tabindex="-1" autocomplete="off"></label>
        <p class="muted">${pending}</p>
        <button type="submit" data-submit-label="${submit}">${submit}</button>
        <p class="muted" data-comment-status></p>
      </form>
    </section>
    <script>
      const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
      const root = document.querySelector("[data-comments]");
      const list = root?.querySelector("[data-comment-list]");
      const form = root?.querySelector("[data-comment-form]");
      const status = root?.querySelector("[data-comment-status]");
      const targetType = root?.getAttribute("data-target-type") || "blog";
      const targetSlug = root?.getAttribute("data-target-slug") || "";
      fetch("/api/comments?targetType=" + encodeURIComponent(targetType) + "&targetSlug=" + encodeURIComponent(targetSlug))
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then((data) => {
          if (!list || !data.comments?.length) return;
          list.innerHTML = data.comments.map((item) => "<article><div class='meta'><strong>" + esc(item.authorName) + "</strong><span>" + new Date(item.createdAt).toLocaleDateString() + "</span></div><p>" + esc(item.body) + "</p>" + (item.ownerReply ? "<p class='muted'>Reply: " + esc(item.ownerReply) + "</p>" : "") + "</article>").join("");
        })
        .catch(() => {});
      form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = form.querySelector("button[type='submit']");
        if (button) {
          button.disabled = true;
          button.textContent = "Submitting...";
        }
        try {
          const body = Object.fromEntries(new FormData(form).entries());
          const response = await fetch("/api/comments", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...body, targetType, targetSlug })
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || "Submission failed.");
          if (status) status.textContent = "${submitted}";
          form.reset();
        } catch (error) {
          if (status) status.textContent = error instanceof Error ? error.message : "Submission failed.";
        } finally {
          if (button) {
            button.disabled = false;
            button.textContent = button.dataset.submitLabel || "${submit}";
          }
        }
      });
    </script>`;
}

function renderDynamicPostPage(post: typeof contentPosts.$inferSelect) {
  const locale = post.lang === "zh" ? "zh" : "en";
  const body = renderMarkdown(post.bodyMarkdown);
  const title = escapeHtml(post.title);
  const description = escapeHtml(post.description);
  const published = post.publishedAt ? new Date(post.publishedAt).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US") : "";
  const tags = parseTags(post.tagsJson).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const home = locale === "zh" ? "/zh" : "/";
  const blog = locale === "zh" ? "/zh/blog" : "/blog";
  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${description}">
    <title>${title} | Zhaohe</title>
    <link rel="icon" href="/assets/zhaohe-avatar.png">
    <style>
      :root{color-scheme:light;--bg:#f7f0df;--panel:#fffdf6;--text:#241a12;--muted:#675847;--line:#2b2118;--accent:#164f63;--accent2:#9b3326}
      *{box-sizing:border-box}body{margin:0;background:linear-gradient(90deg,rgba(36,26,18,.045) 1px,transparent 1px),linear-gradient(180deg,#fffdf6,#f7f0df);background-size:22px 22px,auto;color:var(--text);font-family:Georgia,"Times New Roman",serif;line-height:1.72}
      header,footer{border-block:4px double var(--line);background:var(--panel)}nav,main,footer div{max-width:900px;margin:auto;padding:1rem 1.25rem}nav{display:flex;gap:1rem;align-items:center;font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;text-transform:uppercase;font-size:.82rem}nav a:first-child{font-family:Georgia,"Times New Roman",serif;font-size:1.15rem;font-weight:800;margin-right:auto;text-decoration:none;text-transform:none}
      a{color:inherit;text-underline-offset:.2em;text-decoration-color:var(--accent)}article{background:var(--panel);border-inline:2px solid var(--line);max-width:860px;margin:0 auto;padding:3rem 1.5rem 2rem}h1{font-size:4rem;line-height:1;margin:.2rem 0;max-width:12ch}h2{border-bottom:1px solid #9d7f58;font-size:1.85rem;padding-bottom:.35rem}.eyebrow{color:var(--accent2);font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;font-size:.78rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.lead,.muted{color:var(--muted)}.lead{border-block:1px solid #9d7f58;padding-block:.75rem}.meta,.tag-row{display:flex;gap:.6rem;flex-wrap:wrap;color:var(--muted);font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;font-size:.86rem}.tag{border:1px solid var(--line);background:#f7f0df;padding:.15rem .45rem}img{max-width:100%;border:2px solid var(--line);box-shadow:5px 5px 0 rgba(36,26,18,.13)}pre{overflow:auto;background:#221910;border:2px solid var(--line);color:#fff8e8;padding:1rem}
      .comments{max-width:860px;margin:0 auto 4rem;padding:1.25rem}.comments form,.comments article{background:var(--panel);border:2px solid var(--line);box-shadow:6px 6px 0 rgba(36,26,18,.12);padding:1rem;margin-top:1rem}.comments form{display:grid;gap:.75rem}.comments article{max-width:none}.comments label{display:grid;gap:.25rem}.comments input,.comments textarea{border:2px solid var(--line);background:#fffef8;color:var(--text);padding:.6rem}.comments textarea{min-height:8rem}.comments button{background:var(--accent);border:2px solid var(--text);color:#fff8e8;padding:.7rem 1rem}.hp{position:absolute;left:-10000px}@media(max-width:620px){h1{font-size:2.55rem}article{border-inline:0;padding-inline:1.25rem}nav{align-items:flex-start;flex-direction:column}}
    </style>
  </head>
  <body>
    <header><nav><a href="${home}">Zhaohe</a><a href="${blog}">Blog</a><a href="${locale === "zh" ? "/zh/portfolio" : "/portfolio"}">Portfolio</a></nav></header>
    <main>
      <article>
        <p class="eyebrow">${escapeHtml(post.category)}</p>
        <h1>${title}</h1>
        <p class="lead">${description}</p>
        <div class="meta"><span>${escapeHtml(published)}</span><span>${locale === "zh" ? "网页发布" : "Web published"}</span></div>
        <div>${body}</div>
        <div class="tag-row">${tags}</div>
      </article>
      ${commentsWidget(locale, "blog", post.slug)}
    </main>
    <footer><div>${locale === "zh" ? "个人记录，不构成投资建议。" : "Personal notes, not investment advice."}</div></footer>
  </body>
</html>`;
}

async function readStaticArticle(pathname: string) {
  const cleanPath = pathname.replace(/\/$/, "");
  const file = Bun.file(`./dist${cleanPath}/index.html`);
  return (await file.exists()) ? file.text() : null;
}

export async function createApp(options: AppOptions = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  await ensureSchema(databaseUrl);
  const { db, client } = createDb(databaseUrl);
  const marketDataProvider = options.marketDataProvider ?? createAlphaVantageProvider();
  const app = new Hono();

  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("origin");
    if (!isProductionRuntime() && origin && isAllowedLocalAdminOrigin(origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Allow-Credentials", "true");
      c.header("Vary", "Origin");
      if (c.req.method === "OPTIONS") {
        c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
        c.header("Access-Control-Allow-Headers", "content-type,x-csrf-token");
        return c.body(null, 204);
      }
    }
    await next();
  });

  async function audit(adminId: number | null, action: string, entityType: string, entityId?: string, metadata?: unknown) {
    await db.insert(auditEvents).values({
      actorAdminId: adminId,
      action,
      entityType,
      entityId,
      metadataJson: safeJson(metadata),
      createdAt: nowIso()
    });
  }

  async function snapshotPostRevision(post: typeof contentPosts.$inferSelect, adminId: number | null, changedAt = nowIso()) {
    await db.insert(contentPostRevisions).values({
      postId: post.id,
      version: post.version,
      slug: post.slug,
      lang: post.lang,
      title: post.title,
      description: post.description,
      bodyMarkdown: post.bodyMarkdown,
      status: post.status,
      tagsJson: post.tagsJson,
      category: post.category,
      publishedAt: post.publishedAt,
      createdAt: post.createdAt,
      changedAt,
      changedByAdminId: adminId
    });
  }

  async function pendingCounts() {
    const [commentCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(comments)
      .where(eq(comments.status, "pending"));
    return {
      comments: commentCount?.count ?? 0
    };
  }

  async function currentSession(c: any) {
    const token = getCookie(c, sessionCookie);
    if (!token) return null;
    const tokenHash = sha256(token);
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
      if (session) await db.delete(sessions).where(eq(sessions.id, session.id));
      return null;
    }
    const [admin] = await db.select().from(admins).where(eq(admins.id, session.adminId)).limit(1);
    if (!admin) return null;
    await db.update(sessions).set({ lastSeenAt: nowIso() }).where(eq(sessions.id, session.id));
    return { session, admin };
  }

  async function requireAdmin(c: any, requireCsrf = false) {
    const auth = await currentSession(c);
    if (!auth) return { ok: false as const, response: c.json({ error: "Unauthorized" }, 401) };
    if (requireCsrf) {
      const csrf = c.req.header("x-csrf-token");
      if (!csrf || csrf !== auth.session.csrfToken) {
        return { ok: false as const, response: c.json({ error: "Invalid CSRF token" }, 403) };
      }
    }
    return { ok: true as const, ...auth };
  }

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      service: "zhaohe.me-api",
      time: nowIso()
    })
  );

  async function renderPublicPost(c: any, lang: "en" | "zh") {
    const slug = c.req.param("slug");
    const [post] = await db
      .select()
      .from(contentPosts)
      .where(and(eq(contentPosts.lang, lang), eq(contentPosts.slug, slug), eq(contentPosts.status, "published")))
      .limit(1);
    if (post) return c.html(renderDynamicPostPage(post));
    const staticHtml = await readStaticArticle(c.req.path);
    if (staticHtml) return c.html(staticHtml);
    return c.html(await Bun.file("./dist/404.html").text().catch(() => "Not found"), 404);
  }

  app.get("/blog/:slug", (c) => renderPublicPost(c, "en"));
  app.get("/zh/blog/:slug", (c) => renderPublicPost(c, "zh"));

  app.get("/api/admin/owner-status", async (c) => {
    const rows = await db.select().from(admins).limit(5);
    const [firstOwner] = rows;
    const localOwner = rows.find((row) => row.email === LOCAL_OWNER_EMAIL);
    const localPasswordWorks = localOwner ? await verifyPassword(LOCAL_OWNER_PASSWORD, localOwner.passwordHash) : false;
    const canExposeLocalHint = !isProductionRuntime() && Boolean(localOwner && localPasswordWorks);
    return c.json({
      apiOk: true,
      hasOwner: rows.length > 0,
      local: canExposeLocalHint,
      email: !isProductionRuntime() ? (localOwner?.email ?? firstOwner?.email ?? null) : null,
      passwordHint: canExposeLocalHint ? LOCAL_OWNER_PASSWORD : null,
      message: rows.length
        ? canExposeLocalHint
          ? "Local owner is ready."
          : "Owner account is configured."
        : "No owner account is configured. Run bun run db:seed."
    });
  });

  app.get("/api/comments", async (c) => {
    const targetType = c.req.query("targetType") === "portfolio" ? "portfolio" : "blog";
    const slug = c.req.query("targetSlug") ?? c.req.query("slug");
    if (!slug) return c.json({ error: "Missing target slug" }, 400);
    const rows = await db
      .select()
      .from(comments)
      .where(and(eq(comments.targetType, targetType), eq(comments.postSlug, slug), eq(comments.status, "approved")))
      .orderBy(desc(comments.createdAt));
    return c.json({ comments: rows.map(publicComment) });
  });

  app.post("/api/comments", async (c) => {
    const ip = clientIp(c);
    const limited = checkRateLimit(`comment:${ip}`, 4, 10 * 60 * 1000);
    if (!limited.ok) return c.json({ error: "Too many submissions", retryAfter: limited.retryAfter }, 429);

    const parsed = parseJson(publicCommentSchema, await readBody(c as any));
    if (!parsed.ok) return c.json({ error: "Invalid comment", issues: parsed.issues }, 400);
    const guard = classifyPublicSubmission(parsed.data, ip);
    if (guard.action === "drop") return c.json({ ok: true, status: "pending" }, 202);

    const [inserted] = await db
      .insert(comments)
      .values({
        targetType: parsed.data.targetType,
        postSlug: parsed.data.targetSlug,
        parentId: parsed.data.parentId ?? null,
        authorName: parsed.data.name,
        authorEmailHash: emailHash(parsed.data.email || undefined),
        authorWebsite: parsed.data.website,
        body: parsed.data.body,
        status: guard.status,
        ipHash: sha256(ip),
        userAgent: c.req.header("user-agent")?.slice(0, 300),
        createdAt: nowIso()
      })
      .returning();
    await audit(null, "create", "comment", String(inserted.id), { targetType: inserted.targetType, targetSlug: inserted.postSlug, guard: guard.reason });
    return c.json({ ok: true, status: "pending", id: inserted.id }, 202);
  });

  app.get("/api/portfolio/public", async (c) => c.json(await getPublicPortfolio(db)));

  app.get("/api/content/profile", async (c) => {
    const lang = c.req.query("lang") === "zh" ? "zh" : "en";
    const [profile] = await db.select().from(siteProfile).limit(1);
    if (!profile) return c.json({ profile: null });
    return c.json({
      profile: {
        displayName: profile.displayName,
        headline: profile.headline,
        bio: lang === "zh" ? profile.bioZh : profile.bioEn,
        location: profile.location,
        email: profile.email,
        updatedAt: profile.updatedAt
      }
    });
  });

  app.get("/api/content/posts", async (c) => {
    const lang = c.req.query("lang") === "zh" ? "zh" : "en";
    const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 50);
    const rows = await db
      .select()
      .from(contentPosts)
      .where(and(eq(contentPosts.lang, lang), eq(contentPosts.status, "published")))
      .orderBy(desc(contentPosts.publishedAt))
      .limit(limit);
    return c.json({ posts: rows.map((row) => publicContentPost(row)) });
  });

  app.get("/api/content/posts/:slug", async (c) => {
    const lang = c.req.query("lang") === "zh" ? "zh" : "en";
    const slug = c.req.param("slug");
    const [post] = await db
      .select()
      .from(contentPosts)
      .where(and(eq(contentPosts.lang, lang), eq(contentPosts.slug, slug), eq(contentPosts.status, "published")))
      .limit(1);
    if (!post) return c.json({ error: "Not found" }, 404);
    return c.json({ post: publicContentPost(post, true) });
  });

  app.post("/api/admin/login", async (c) => {
    const parsed = parseJson(loginSchema, await readBody(c as any));
    if (!parsed.ok) return c.json({ error: "Invalid login", issues: parsed.issues }, 400);

    const [configuredOwner] = await db.select({ id: admins.id }).from(admins).limit(1);
    if (!configuredOwner) {
      return c.json({ error: "No owner account is configured. Run bun run db:seed.", code: "OWNER_MISSING" }, 503);
    }

    const [admin] = await db.select().from(admins).where(eq(admins.email, parsed.data.email)).limit(1);
    if (!admin || !(await verifyPassword(parsed.data.password, admin.passwordHash))) {
      return c.json({ error: "Invalid email or password", code: "INVALID_CREDENTIALS" }, 401);
    }

    const token = randomToken();
    const csrfToken = randomToken(24);
    const createdAt = nowIso();
    const [session] = await db
      .insert(sessions)
      .values({
        adminId: admin.id,
        tokenHash: sha256(token),
        csrfToken,
        expiresAt: addDays(14),
        createdAt,
        lastSeenAt: createdAt
      })
      .returning();
    await db.update(admins).set({ lastLoginAt: createdAt, updatedAt: createdAt }).where(eq(admins.id, admin.id));
    await audit(admin.id, "login", "session", String(session.id));

    setCookie(c, sessionCookie, token, {
      path: "/",
      httpOnly: true,
      secure: siteIsHttps(),
      sameSite: "Lax",
      maxAge: 60 * 60 * 24 * 14
    });

    return c.json({
      ok: true,
      csrfToken,
      admin: { id: admin.id, email: admin.email, name: admin.name },
      pending: await pendingCounts()
    });
  });

  app.post("/api/admin/logout", async (c) => {
    const auth = await requireAdmin(c, true);
    if (!auth.ok) return auth.response;
    await db.delete(sessions).where(eq(sessions.id, auth.session.id));
    deleteCookie(c, sessionCookie, { path: "/" });
    await audit(auth.admin.id, "logout", "session", String(auth.session.id));
    return c.json({ ok: true });
  });

  app.get("/api/admin/me", async (c) => {
    const auth = await currentSession(c);
    if (!auth) return c.json({ authenticated: false, csrfToken: "", admin: null });
    return c.json({
      authenticated: true,
      csrfToken: auth.session.csrfToken,
      admin: { id: auth.admin.id, email: auth.admin.email, name: auth.admin.name },
      pending: await pendingCounts()
    });
  });

  app.get("/api/admin/comments", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) return auth.response;
    const status = c.req.query("status");
    const rows = await db
      .select()
      .from(comments)
      .where(status ? eq(comments.status, status) : undefined)
      .orderBy(desc(comments.createdAt))
      .limit(100);
    return c.json({ comments: rows });
  });

  app.patch("/api/admin/comments/:id", async (c) => {
    const auth = await requireAdmin(c, true);
    if (!auth.ok) return auth.response;
    const id = Number(c.req.param("id"));
    const parsed = parseJson(moderationSchema, await readBody(c as any));
    if (!Number.isInteger(id) || !parsed.ok) return c.json({ error: "Invalid moderation update" }, 400);
    const approvedAt = parsed.data.status === "approved" ? nowIso() : undefined;
    const [updated] = await db
      .update(comments)
      .set({ ...parsed.data, approvedAt })
      .where(eq(comments.id, id))
      .returning();
    if (!updated) return c.json({ error: "Not found" }, 404);
    await audit(auth.admin.id, "moderate", "comment", String(id), parsed.data);
    return c.json({ comment: updated });
  });

  app.delete("/api/admin/comments/:id", async (c) => {
    const auth = await requireAdmin(c, true);
    if (!auth.ok) return auth.response;
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);
    await db.delete(comments).where(eq(comments.id, id));
    await audit(auth.admin.id, "delete", "comment", String(id));
    return c.json({ ok: true });
  });

  app.get("/api/admin/portfolio/positions", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) return auth.response;
    const rows = await db.select().from(portfolioPositions).orderBy(desc(portfolioPositions.asOf));
    const positions = [];
    for (const row of rows) {
      const [quote] = row.assetId
        ? await db.select().from(marketQuotes).where(eq(marketQuotes.assetId, row.assetId)).limit(1)
        : [];
      positions.push({ ...row, quote: quote ?? null });
    }
    return c.json({ positions });
  });

  app.get("/api/admin/market/search", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) return auth.response;
    const query = (c.req.query("q") ?? "").trim();
    if (query.length < 1) return c.json({ assets: [], providerStatus: { ok: true, provider: marketDataProvider.name } });
    const cached = await searchCachedMarketAssets(db, query);
    let providerStatus: MarketProviderStatus = { ok: true, provider: marketDataProvider.name };
    let providerResults: MarketAssetSearchResult[] = [];

    try {
      providerResults = await marketDataProvider.searchAssets(query);
    } catch (error) {
      providerStatus = {
        ok: false,
        provider: marketDataProvider.name,
        code: error instanceof MarketDataError ? error.code : "MARKET_DATA_ERROR",
        message: error instanceof Error ? error.message : "Market provider is unavailable."
      };
    }

    const stored = providerResults.length ? await upsertSearchResults(db, providerResults) : [];
    const providerAssets = providerResults.map((result) => {
      const asset = stored.find((storedAsset) => storedAsset.provider === result.provider && storedAsset.symbol === result.symbol);
      return {
        ...result,
        id: asset?.id ?? null,
        aliases: parseAssetAliases(asset?.aliasesJson),
        source: "provider" as const
      };
    });
    const seen = new Set(providerAssets.map((asset) => `${asset.provider}:${asset.symbol}`));
    const assets = [
      ...providerAssets,
      ...cached.filter((asset) => !seen.has(`${asset.provider}:${asset.symbol}`))
    ].slice(0, 12);
    return c.json({
      assets,
      providerStatus
    });
  });

  app.post("/api/admin/market/quotes/refresh", async (c) => {
    const auth = await requireAdmin(c, true);
    if (!auth.ok) return auth.response;
    const body = await readBody(c as any);
    const assetIds = Array.isArray(body?.assetIds)
      ? body.assetIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
      : undefined;
    const results = await refreshQuotesForPositions(db, marketDataProvider, assetIds);
    await audit(auth.admin.id, "refresh", "market_quote", undefined, {
      refreshed: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length
    });
    return c.json({ results });
  });

  async function toPositionValues(data: any, existing?: typeof portfolioPositions.$inferSelect) {
    const merged = { ...existing, ...data };
    const asset = await ensureMarketAsset(db, {
      provider: data.provider ?? "alpha_vantage",
      symbol: merged.ticker,
      name: merged.name,
      assetType: merged.assetClass,
      region: merged.region,
      currency: merged.currency,
      exchange: data.exchange,
      aliases: data.aliases
    });
    return {
      assetId: data.assetId ?? asset.id,
      ticker: String(merged.ticker).trim().toUpperCase(),
      name: String(merged.name).trim(),
      assetClass: String(merged.assetClass).trim(),
      region: String(merged.region).trim(),
      currency: String(merged.currency).trim().toUpperCase(),
      quantity: Number(merged.quantity),
      costBasisCents: Number(merged.costBasisCents),
      marketValueCents: Number(merged.marketValueCents ?? 0),
      asOf: String(merged.asOf ?? new Date().toISOString().slice(0, 10)).trim(),
      status: merged.status ?? "active",
      notes: merged.notes ?? null
    };
  }

  app.post("/api/admin/portfolio/positions", async (c) => {
    const auth = await requireAdmin(c, true);
    if (!auth.ok) return auth.response;
    const parsed = parseJson(positionSchema, await readBody(c as any));
    if (!parsed.ok) return c.json({ error: "Invalid portfolio position", issues: parsed.issues }, 400);
    const now = nowIso();
    const values = await toPositionValues(parsed.data);
    const [position] = await db
      .insert(portfolioPositions)
      .values({ ...values, createdAt: now, updatedAt: now })
      .returning();
    await audit(auth.admin.id, "create", "portfolio_position", String(position.id), { ticker: position.ticker });
    return c.json({ position }, 201);
  });

  app.patch("/api/admin/portfolio/positions/:id", async (c) => {
    const auth = await requireAdmin(c, true);
    if (!auth.ok) return auth.response;
    const id = Number(c.req.param("id"));
    const parsed = parseJson(positionSchema.partial(), await readBody(c as any));
    if (!Number.isInteger(id) || !parsed.ok) return c.json({ error: "Invalid portfolio position" }, 400);
    const [existing] = await db.select().from(portfolioPositions).where(eq(portfolioPositions.id, id)).limit(1);
    if (!existing) return c.json({ error: "Not found" }, 404);
    const values = await toPositionValues(parsed.data, existing);
    const [position] = await db
      .update(portfolioPositions)
      .set({ ...values, updatedAt: nowIso() })
      .where(eq(portfolioPositions.id, id))
      .returning();
    await audit(auth.admin.id, "update", "portfolio_position", String(id), { ticker: position.ticker });
    return c.json({ position });
  });

  app.delete("/api/admin/portfolio/positions/:id", async (c) => {
    const auth = await requireAdmin(c, true);
    if (!auth.ok) return auth.response;
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);
    await db.delete(portfolioPositions).where(eq(portfolioPositions.id, id));
    await audit(auth.admin.id, "delete", "portfolio_position", String(id));
    return c.json({ ok: true });
  });

  app.get("/api/admin/profile", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) return auth.response;
    const [profile] = await db.select().from(siteProfile).limit(1);
    return c.json({ profile: profile ?? null });
  });

  app.patch("/api/admin/profile", async (c) => {
    const auth = await requireAdmin(c, true);
    if (!auth.ok) return auth.response;
    const parsed = parseJson(profileSchema, await readBody(c as any));
    if (!parsed.ok) return c.json({ error: "Invalid profile", issues: parsed.issues }, 400);
    const [existing] = await db.select().from(siteProfile).limit(1);
    const updatedAt = nowIso();
    const [profile] = existing
      ? await db.update(siteProfile).set({ ...parsed.data, updatedAt }).where(eq(siteProfile.id, existing.id)).returning()
      : await db.insert(siteProfile).values({ ...parsed.data, updatedAt }).returning();
    await audit(auth.admin.id, "update", "site_profile", String(profile.id));
    return c.json({ profile });
  });

  app.post("/api/admin/assets", async (c) => {
    const auth = await requireAdmin(c, true);
    if (!auth.ok) return auth.response;
    const form = await c.req.raw.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "Missing file" }, 400);

    const allowed = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
    if (!allowed.has(file.type)) return c.json({ error: "Unsupported image type" }, 400);
    if (file.size > 4 * 1024 * 1024) return c.json({ error: "Image must be 4MB or smaller" }, 400);

    const uploadDir = process.env.UPLOAD_DIR ?? "./public/uploads";
    mkdirSync(uploadDir, { recursive: true });
    const extension = extname(file.name).toLowerCase() || `.${file.type.split("/")[1]}`;
    const storedName = `${new Date().toISOString().slice(0, 10)}-${randomToken(10)}${extension}`;
    const diskPath = join(uploadDir, storedName);
    await Bun.write(diskPath, file);
    const publicPath = `/uploads/${storedName}`;
    const [asset] = await db
      .insert(uploadedAssets)
      .values({
        ownerAdminId: auth.admin.id,
        originalName: file.name || storedName,
        storedName,
        mimeType: file.type,
        sizeBytes: file.size,
        publicPath,
        createdAt: nowIso()
      })
      .returning();
    await audit(auth.admin.id, "upload", "asset", String(asset.id), { publicPath });
    return c.json({ asset }, 201);
  });

  app.get("/api/admin/content/posts", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) return auth.response;
    const rows = await db.select().from(contentPosts).orderBy(desc(contentPosts.updatedAt)).limit(200);
    return c.json({ posts: rows.map((row) => ({ ...row, tags: parseTags(row.tagsJson) })) });
  });

  app.post("/api/admin/content/preview", async (c) => {
    const auth = await requireAdmin(c, true);
    if (!auth.ok) return auth.response;
    const parsed = parseJson(markdownPreviewSchema, await readBody(c as any));
    if (!parsed.ok) return c.json({ error: "Invalid Markdown preview", issues: parsed.issues }, 400);
    return c.json({ html: renderMarkdown(parsed.data.bodyMarkdown) });
  });

  app.post("/api/admin/content/posts", async (c) => {
    const auth = await requireAdmin(c, true);
    if (!auth.ok) return auth.response;
    const parsed = parseJson(contentPostSchema, await readBody(c as any));
    if (!parsed.ok) return c.json({ error: "Invalid content post", issues: parsed.issues }, 400);
    const now = nowIso();
    const publishedAt = parsed.data.status === "published" ? parsed.data.publishedAt || now : parsed.data.publishedAt || null;
    const [post] = await db
      .insert(contentPosts)
      .values({
        slug: parsed.data.slug,
        lang: parsed.data.lang,
        title: parsed.data.title,
        description: parsed.data.description,
        bodyMarkdown: parsed.data.bodyMarkdown,
        status: parsed.data.status,
        tagsJson: JSON.stringify(parsed.data.tags),
        category: parsed.data.category,
        publishedAt,
        createdAt: now,
        updatedAt: now
      })
      .returning();
    await snapshotPostRevision(post, auth.admin.id, now);
    await audit(auth.admin.id, "create", "content_post", String(post.id), { slug: post.slug, lang: post.lang });
    return c.json({ post: { ...post, tags: parseTags(post.tagsJson) } }, 201);
  });

  app.patch("/api/admin/content/posts/:id", async (c) => {
    const auth = await requireAdmin(c, true);
    if (!auth.ok) return auth.response;
    const id = Number(c.req.param("id"));
    const parsed = parseJson(contentPostSchema.partial(), await readBody(c as any));
    if (!Number.isInteger(id) || !parsed.ok) return c.json({ error: "Invalid content post" }, 400);
    const [existing] = await db.select().from(contentPosts).where(eq(contentPosts.id, id)).limit(1);
    if (!existing) return c.json({ error: "Not found" }, 404);

    const nextStatus = parsed.data.status ?? existing.status;
    const publishedAt =
      nextStatus === "published" && !existing.publishedAt
        ? parsed.data.publishedAt || nowIso()
        : parsed.data.publishedAt === undefined
          ? existing.publishedAt
          : parsed.data.publishedAt;
    const { tags, ...postUpdate } = parsed.data;
    const [post] = await db
      .update(contentPosts)
      .set({
        ...postUpdate,
        tagsJson: tags ? JSON.stringify(tags) : existing.tagsJson,
        publishedAt,
        version: existing.version + 1,
        updatedAt: nowIso()
      })
      .where(eq(contentPosts.id, id))
      .returning();
    await snapshotPostRevision(post, auth.admin.id);
    await audit(auth.admin.id, "update", "content_post", String(id), { slug: post.slug, lang: post.lang });
    return c.json({ post: { ...post, tags: parseTags(post.tagsJson) } });
  });

  app.get("/api/admin/content/posts/:id/revisions", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) return auth.response;
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);
    const rows = await db
      .select()
      .from(contentPostRevisions)
      .where(eq(contentPostRevisions.postId, id))
      .orderBy(desc(contentPostRevisions.version));
    return c.json({ revisions: rows.map((row) => ({ ...row, tags: parseTags(row.tagsJson) })) });
  });

  app.post("/api/admin/content/posts/:id/revisions/:revisionId/restore", async (c) => {
    const auth = await requireAdmin(c, true);
    if (!auth.ok) return auth.response;
    const id = Number(c.req.param("id"));
    const revisionId = Number(c.req.param("revisionId"));
    if (!Number.isInteger(id) || !Number.isInteger(revisionId)) return c.json({ error: "Invalid id" }, 400);
    const [existing] = await db.select().from(contentPosts).where(eq(contentPosts.id, id)).limit(1);
    const [revision] = await db.select().from(contentPostRevisions).where(eq(contentPostRevisions.id, revisionId)).limit(1);
    if (!existing || !revision || revision.postId !== id) return c.json({ error: "Not found" }, 404);
    const [post] = await db
      .update(contentPosts)
      .set({
        slug: revision.slug,
        lang: revision.lang,
        title: revision.title,
        description: revision.description,
        bodyMarkdown: revision.bodyMarkdown,
        status: revision.status,
        tagsJson: revision.tagsJson,
        category: revision.category,
        publishedAt: revision.publishedAt,
        version: existing.version + 1,
        updatedAt: nowIso()
      })
      .where(eq(contentPosts.id, id))
      .returning();
    await snapshotPostRevision(post, auth.admin.id);
    await audit(auth.admin.id, "restore", "content_post", String(id), { revisionId });
    return c.json({ post: { ...post, tags: parseTags(post.tagsJson) } });
  });

  app.delete("/api/admin/content/posts/:id", async (c) => {
    const auth = await requireAdmin(c, true);
    if (!auth.ok) return auth.response;
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);
    await db.delete(contentPosts).where(eq(contentPosts.id, id));
    await audit(auth.admin.id, "delete", "content_post", String(id));
    return c.json({ ok: true });
  });

  return {
    app,
    db,
    client
  };
}
