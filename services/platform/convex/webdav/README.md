# WebDAV Convex module — trust boundary

The functions in this directory are split into two visibility classes:

## Public (UI-callable, full Better Auth check)

- `app_password_mutations.createAppPassword` — generates a random secret + HMAC hash, inserts a row, returns plaintext **once**
- `app_password_mutations.revokeAppPassword` — soft-revoke a row owned by the caller
- `app_password_queries.listAppPasswords` — list rows owned by the caller (metadata only — no hash, no plaintext)

These run the full `authComponent.getAuthUser` check and only operate on rows where `userId === authUser.userId`.

## Internal (admin-key, called from the platform Hono server)

Everything else (`*_internal`, `findCandidatesByPrefix`, `recordAppPasswordUse`, all `lock_*` and `tree_*` functions).

The platform Hono server (`services/platform/server.ts`) opens a `ConvexHttpClient` configured with `ADMIN_KEY` at startup and calls these via `internal.webdav.*` after performing its own per-request HTTP Basic auth check using `findCandidatesByPrefix` + HMAC comparison.

**Why this split**: WebDAV uses HTTP Basic — the credentials are not a Better Auth session cookie that Convex can validate via `authComponent.getAuthUser`. The platform server holds the trust: it parses the `Authorization: Basic` header, verifies the app-password, then asserts `organizationId` + `userId` to Convex. Convex internal functions trust those assertions — they do **not** re-check user identity. This is the same pattern `services/platform/convex/http.ts:362-366` uses for `/api/sse/auth` (the platform Hono server reads the session cookie, then queries Convex with the user's id).

**HMAC secret**: `WEBDAV_APP_PASSWORD_HMAC_KEY` (hex-encoded 32-byte random). Derived deterministically from `INSTANCE_SECRET` by `docker-entrypoint.sh` (prod) and `server.ts` (dev) — operators do not set this manually. To rotate the HMAC independently of `INSTANCE_SECRET`, set `WEBDAV_APP_PASSWORD_HMAC_KEY` explicitly in `.env`; an explicit value always overrides the derived one. **Rotating it invalidates every existing app-password.**
