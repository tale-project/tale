# WebDAV handlers — trust boundary

This directory holds the storage-side handlers behind the WebDAV door. They
split into two visibility classes:

## Public (UI-callable, full session check)

- `app_password_mutations.createAppPassword` — generates a random secret + HMAC hash, inserts a row, returns plaintext **once**
- `app_password_mutations.revokeAppPassword` — soft-revoke a row owned by the caller
- `app_password_queries.listAppPasswords` — list rows owned by the caller (metadata only — no hash, no plaintext)

These run behind the session-authenticated settings routes and only operate on rows where `userId` is the caller's.

## Internal (called by the WebDAV protocol layer)

Everything else (`*_internal`, `findCandidatesByPrefix`, `recordAppPasswordUse`, all `lock_*` and `tree_*` functions).

The WebDAV protocol layer (`lib/webdav/`, mounted at `/dav` by `backend/domains/webdav/routes.ts`) holds the trust: it parses the `Authorization: Basic` header, verifies the app-password via `findCandidatesByPrefix` + HMAC comparison, then asserts `organizationId` + `userId` into every name-addressed handler call. The handlers trust those assertions — they do **not** re-check user identity.

**Why this split**: WebDAV uses HTTP Basic — the credentials are not a session cookie the normal auth middleware can validate, so exactly one layer (the protocol dispatcher) owns credential verification, and everything behind it takes identity as input.

**Hub-only visibility**: WebDAV applies no team ACLs (the trust split above asserts only `organizationId` + `userId`), but the tree functions do enforce document scope: project-scoped documents (`documents.projectId` set) are **not** WebDAV resources (#2545). `backend/domains/webdav/handlers.ts` gates every listing, leaf resolution, and name-collision lookup — folder and document reads are pinned to `project_id IS NULL` and a project-scoped leaf resolves as not-found — project files never list, resolve as not-found for every caller (mirroring the REST 404s), and a PUT whose name collides with one creates an independent hub document. Project members reach those files through the project surfaces instead.

Project-scoped **folders** (`folders.projectId` set) are excluded the same way, but at the index rather than a predicate: every folder listing, path segment, and name-collision lookup in `tree_queries.ts` / `tree_mutations.ts` (and the shared `folders/find_folder_by_path.ts`) queries `by_org_project_parent_name` pinned to `projectId=undefined`, so a project folder never lists, never resolves, and never counts as a MKCOL/PUT collision. Recursive descendant walks (cascade delete, copy, move fixup, hold guard) stay on `by_org_parent_name` — they descend from an already-hub-authorized root, and a folder's children share its scope by invariant.

**HMAC secret**: `WEBDAV_APP_PASSWORD_HMAC_KEY` (hex-encoded 32-byte random). Derived deterministically from `INSTANCE_SECRET` by `docker-entrypoint.sh` (prod) and `server.ts` (dev) — operators do not set this manually. To rotate the HMAC independently of `INSTANCE_SECRET`, set `WEBDAV_APP_PASSWORD_HMAC_KEY` explicitly in `.env`; an explicit value always overrides the derived one. **Rotating it invalidates every existing app-password.**
