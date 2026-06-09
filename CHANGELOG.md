# Changelog

## 0.2.0 - 2026-05-25

- Added PRD/release version metadata and release notes.
- Merged Archive into Blog navigation while keeping `/archive` and `/zh/archive` as compatibility aliases.
- Added PostgreSQL persistence with Drizzle, Docker Compose PostgreSQL service, `DATABASE_URL`, and `pg_dump` backups.
- Added content post revision snapshots and restore APIs.
- Upgraded the owner post editor with Markdown toolbar controls, split preview, sticky save/publish actions, image upload, and revision history.
- Added authenticated image upload storage and metadata.
- Improved guestbook/comment forms with loading, success, error, and moderation-pending feedback.
- Added pending moderation counts in the owner studio.
- Wired portfolio position editing in the owner studio.
- Restyled the public site and owner studio with a clean nostalgic personal-web visual direction.
- Added Docker-based local PostgreSQL test compose file and E2E-style flow tests.

## 0.1.0 - 2026-05-24

- Built the first bilingual personal website implementation with Astro, Bun, Hono, Markdown posts, comments, guestbook, owner login, and privacy-preserving portfolio output.
