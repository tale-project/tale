---
title: WebDAV API
description: Protocol reference for Tale's WebDAV server — URL scheme, authentication, supported methods, property list, lock semantics, and limits.
---

Tale exposes the document store under `/dav/<orgSlug>/` as a read-write WebDAV Class 2 endpoint (RFC 4918). This page is the protocol reference — the wire-level surface a client implementer or a third-party tool needs to integrate. For the end-user setup guide and per-client instructions, see [Platform > Connectors > WebDAV](/platform/connectors/webdav).

## URL scheme

```text
/dav/<orgSlug>/documents/<path>      R/W  active documents tree
/dav/<orgSlug>/.trash/<path>         R/O  trashed documents (soft-delete view)
/dav/<orgSlug>/                      R/O  collection containing the two above
```

Segments are URL-encoded. The server rejects segments containing `/`, `\`, NUL, or the relative names `.` and `..`. Each segment must be 1–255 bytes. The `orgSlug` matches `[a-zA-Z0-9_-]{1,64}`.

Trailing-slash policy follows WebDAV convention: collections (folders) are referenced with a trailing slash, resources (files) without. Many clients normalise on the fly; the server accepts both forms on lookup and emits the canonical form in PROPFIND responses.

## Authentication

HTTP Basic only. The username field can be any non-empty value — the app-password itself is the actual credential, and the server does not match the username against your account record. Using your Tale account email is the convention for audit clarity, and clients that prefill from the keychain expect an email-shaped string, but the auth decision is made on the password alone. The password is an **app-password** generated under Settings > WebDAV. The user's main account password is not accepted on this endpoint.

```http
Authorization: Basic <base64(email-or-anything:app-password)>
```

App-passwords are hashed with HMAC-SHA256 keyed by the server's `WEBDAV_APP_PASSWORD_HMAC_KEY` deployment secret. The key is derived deterministically from `INSTANCE_SECRET` by the platform entrypoint (prod) and `server.ts` (dev), so operators do not mint it manually; setting it explicitly in `.env` overrides the derived value. Lookup narrows by the password's first four characters (stored alongside the hash for indexed lookup) and verifies with a constant-time HMAC comparison.

Every authenticated request also verifies the requesting user is an active member of the organisation in the URL — a stale row (membership removed after app-password issue) is rejected with `403`.

`OPTIONS` is the only method allowed without authentication; clients use it to probe DAV capability before signing in.

## Methods

| Method     | Behaviour                                                                                                                                                                                         | Auth         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| OPTIONS    | Advertise capabilities. Returns `DAV: 1, 2`, `Allow: …`, and `Microsoft-Server-WebDAV-Extensions: 1` for Windows compatibility.                                                                   | Anonymous OK |
| PROPFIND   | List a resource (Depth 0) or a collection's immediate children (Depth 1). The property list emitted is documented below. **Depth: infinity is rejected with 403** to prevent unbounded responses. | Required     |
| PROPPATCH  | Returns 207 success per-property without storing values. Dead properties are not persisted in v1; PROPPATCH succeeds optimistically for client compatibility.                                     | Required     |
| GET / HEAD | Stream the document blob. Sets `Content-Type`, `Content-Length`, `ETag`, and `Last-Modified`. GET on a collection returns 405.                                                                    | Required     |
| PUT        | Create or replace a document. New blob is stored in the object store; the document row picks up `sourceProvider: "webdav"`. Returns 201 on create, 204 on overwrite. Requires `Content-Length`; a chunked body is refused with 411. | Required     |
| DELETE     | Soft-delete a document (sets `lifecycleStatus: "trashed"`) or a folder (cascades trash on contained documents, hard-deletes the folder rows). Returns 204.                                        | Required     |
| MKCOL      | Create a folder under an existing parent. Empty body only. Returns 201, 405 if the target exists, or 409 if the parent does not.                                                                  | Required     |
| MOVE       | Rename or relocate. Atomic for documents. For folders, updates the `parentId` of the moved folder. Honours `Overwrite: T/F` and `If` headers. Returns 201 (new destination) or 204 (overwrite).   | Required     |
| COPY       | Server-side copy. Document copies reuse the same stored object. Folder copies recurse. Honours `Overwrite` and `If`.                                                                              | Required     |
| LOCK       | Class 2 exclusive or shared write-lock. Timeout from `Timeout: Second-N` header, capped at 3600. Refresh by re-sending LOCK with `If: (<opaquelocktoken:...>)` and an empty body.                 | Required     |
| UNLOCK     | Release a lock by its token. Only the lock owner can release. Returns 204.                                                                                                                        | Required     |

`HEAD` shares its handler with `GET` minus the body.

## Properties

PROPFIND returns these live properties for every resource:

- `resourcetype` — `<collection/>` on folders, empty on documents.
- `displayname` — the folder name or document title.
- `getlastmodified` — RFC 1123 timestamp. Documents use `sourceModifiedAt` if set, otherwise the document row creation time.
- `creationdate` — ISO 8601 of the row creation time.
- `getcontenttype` — documents only; the MIME type the document was uploaded with.
- `getcontentlength` — documents only; bytes.
- `getetag` — documents only; the content hash if known, otherwise the document id.
- `supportedlock` — advertises exclusive write-lock support.
- `lockdiscovery` — present on resources with active locks.

Dead properties are not stored. PROPPATCH echoes 200 for a dead property set on its own, but setting a live/protected property returns a per-property 403 (`cannot-modify-protected-property`), and any dead properties in the same request are then reported as 424 Failed Dependency (RFC 4918 §9.2 atomicity). No value is ever persisted.

## Lock semantics

Locks live in their own Postgres table (`app.webdav_locks`), keyed by `(organizationId, resourcePath)`. Wire form is `opaquelocktoken:<uuid>`. The server:

- Caps timeout at 3600 seconds. Requests for longer windows are clamped silently.
- Treats `LOCK` with an `If: (<opaquelocktoken:UUID>)` header and an empty body as a refresh — the existing lock's expiry is bumped.
- Returns `412 Precondition Failed` on a refresh when the supplied token is unknown.
- Returns `423 Locked` on `PUT / DELETE / MOVE / COPY / MKCOL / PROPPATCH` against a locked path when the request lacks a matching `If` header.
- Returns `412 Precondition Failed` when the supplied `If` token does not match the live lock.
- Expires locks lazily — the lookup query returns null for expired rows and schedules a fire-and-forget delete.
- Hard-deletes every lock owned by an app-password when that app-password is revoked.

`UNLOCK` requires both a valid `Lock-Token` header and the requesting user to be the lock owner.

## Status codes

- `200` — OPTIONS, GET, HEAD, LOCK, LOCK refresh, PROPPATCH (per-property)
- `201` — PUT create, MKCOL, MOVE/COPY to a new destination
- `204` — DELETE, UNLOCK, PUT overwrite, MOVE/COPY overwrite
- `207` — PROPFIND, PROPPATCH (multi-status envelope)
- `400` — malformed `Destination` / `If` / `Lock-Token` / `Timeout` header
- `401` — missing or invalid Basic auth
- `403` — Depth: infinity rejected; .trash write attempt; root delete/move; wrong app-password owner on UNLOCK; user not a member of the org; MOVE/COPY onto itself or into its own subtree; cross-org `Destination`
- `404` — resource not found
- `405` — GET on a collection; PUT to a collection path; MKCOL on existing path; root MKCOL
- `409` — MKCOL, MOVE, or COPY when the destination parent does not exist
- `411` — PUT without `Content-Length` (chunked transfer is not supported: the body goes to a presigned object-store URL that needs the length up front)
- `412` — `If` token mismatch; `If-Match` / `If-None-Match` precondition failed; MOVE/COPY with `Overwrite: F` onto an existing destination
- `413` — PUT body over the size cap, or an XML request body (PROPFIND / PROPPATCH / MKCOL / LOCK) over 64 KB
- `415` — MKCOL with non-empty XML body (extended MKCOL not implemented)
- `423` — write attempted on a locked path without matching `If`
- `502` — cross-host `Destination`; storage proxy fetch failed
- `503` — LOCK count cap exceeded for the app-password (with `Retry-After`)
- `507` — folder subtree too large to delete, move, or copy in a single request

## Compliance

- DAV Class **1** (basic): full.
- DAV Class **2** (locking): full, with the lazy-expiry behaviour described above.
- DAV Class **3** (calendaring, contacts, search, ACL): not implemented.

The server advertises `DAV: 1, 2` in the OPTIONS response.

## Limits

- `Depth: infinity` on PROPFIND is rejected with `403`.
- `Timeout: Second-N` on LOCK is clamped to `[1, 3600]`.
- PUT body size is capped at **5 GB** by default (`413` once exceeded), enforced both at the reverse proxy and in the platform server. Operators can raise or lower it with the `WEBDAV_MAX_PUT_BYTES` environment variable. The body is streamed to a presigned S3 URL with backpressure, so a large upload does not buffer in platform memory. Because that URL needs the length up front, a PUT without `Content-Length` (chunked transfer) is refused with `411`.
- XML request bodies (PROPFIND / PROPPATCH / MKCOL / LOCK) are capped at **64 KB** (`413` once exceeded) — these envelopes are tiny by design.
- App-passwords are hashed with HMAC-SHA256; the secret never appears in any response after the create call.
- `lastUsedAt` is patched at most once per minute per app-password to avoid write storms on busy mounts.

## Network requirements

The WebDAV endpoint runs inside the platform Hono server (`platform:3000` in compose). Caddy routes `/dav/*` to it via the default fallback — no extra configuration is required. The handler talks to Postgres directly through the backend's own database connection; there is no separate service to reach.

For dev (`bun run dev`), Vite proxies `/dav` to the backend, so `curl` and clients can hit `http://localhost:3000/dav/<orgSlug>/...` against a running dev server without rebuilding.

## Security

WebDAV ships the app-password on every request as an HTTP Basic header — there is no session, no token refresh, just the raw credential replayed on every PROPFIND, PUT, LOCK, and so on. Only mount the endpoint over HTTPS; running it over plain HTTP leaks the password to anyone on the wire, and revoking the row is the only way to recover. Never put the app-password into the URL itself (the `https://user:pass@host/...` shorthand) — most clients log URLs in shell history, crash reports, and proxy access logs, where the credential would survive long after the mount was unmounted. Let the WebDAV client store the password in the OS keychain (macOS Keychain, Windows Credential Manager, GNOME Keyring) and surface it through the standard credential prompt instead.

The server enforces TLS at the reverse proxy layer in production deploys; dev mode over plain HTTP is only intended for `localhost` testing. Audit logs record every authenticated request with the prefix of the password used, so a leaked credential can be traced and revoked without rotating the rest of the device fleet.

## Where this fits

WebDAV is the mount-protocol surface of the same document store the [REST API reference](/develop/api-reference) drives for bulk import and search — both routes write into the table the [Document Hub](/platform/knowledge/documents) reads from, so a file created through Finder appears in the web UI without any sync step. The protocol is the right pick when a user wants their documents to feel like a local folder; the REST API is the right pick when a script or agent wants byte-level control over what gets written and when. RFC 4918 is the wire-level authority for everything on this page.
