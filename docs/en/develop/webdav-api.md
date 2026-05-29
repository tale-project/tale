---
title: WebDAV API
description: Protocol reference for Tale's WebDAV server — URL scheme, authentication, supported methods, property list, lock semantics, and limits.
---

Tale exposes the document store under `/dav/<orgSlug>/` as a read-write WebDAV Class 2 endpoint (RFC 4918). This page is the protocol reference — the wire-level surface a client implementer or a third-party tool needs to integrate. For the end-user setup guide and per-client instructions, see [Platform > Integrations > WebDAV](/platform/integrations/webdav).

## URL scheme

```
/dav/<orgSlug>/documents/<path>      R/W  active documents tree
/dav/<orgSlug>/.trash/<path>         R/O  trashed documents (soft-delete view)
/dav/<orgSlug>/                      R/O  collection containing the two above
```

Segments are URL-encoded. The server rejects segments containing `/`, `\`, NUL, or the relative names `.` and `..`. Each segment must be 1–255 bytes. The `orgSlug` matches `[a-zA-Z0-9_-]{1,64}`.

Trailing-slash policy follows WebDAV convention: collections (folders) are referenced with a trailing slash, resources (files) without. Many clients normalise on the fly; the server accepts both forms on lookup and emits the canonical form in PROPFIND responses.

## Authentication

HTTP Basic only. The username is the user's Tale account email; the password is an **app-password** generated under Settings > WebDAV. The user's main account password is not accepted on this endpoint.

```
Authorization: Basic <base64(email:app-password)>
```

App-passwords are hashed with HMAC-SHA256 keyed by the server's `WEBDAV_APP_PASSWORD_HMAC_KEY` deployment secret. Lookup narrows by the password's first four characters (stored alongside the hash for indexed lookup) and verifies with a constant-time HMAC comparison.

Every authenticated request also verifies the requesting user is an active member of the organisation in the URL — a stale row (membership removed after app-password issue) is rejected with `403`.

`OPTIONS` is the only method allowed without authentication; clients use it to probe DAV capability before signing in.

## Methods

| Method     | Behaviour                                                                                                                                                                                         | Auth         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| OPTIONS    | Advertise capabilities. Returns `DAV: 1, 2`, `Allow: …`, and `Microsoft-Server-WebDAV-Extensions: 1` for Windows compatibility.                                                                   | Anonymous OK |
| PROPFIND   | List a resource (Depth 0) or a collection's immediate children (Depth 1). The property list emitted is documented below. **Depth: infinity is rejected with 403** to prevent unbounded responses. | Required     |
| PROPPATCH  | Returns 207 success per-property without storing values. Dead properties are not persisted in v1; PROPPATCH succeeds optimistically for client compatibility.                                     | Required     |
| GET / HEAD | Stream the document blob. Sets `Content-Type`, `Content-Length`, `ETag`, and `Last-Modified`. GET on a collection returns 405.                                                                    | Required     |
| PUT        | Create or replace a document. New blob is stored in Convex storage with content-hash dedup; the document row picks up `sourceProvider: "webdav"`. Returns 201 on create, 204 on overwrite.        | Required     |
| DELETE     | Soft-delete a document (sets `lifecycleStatus: "trashed"`) or a folder (cascades trash on contained documents, hard-deletes the folder rows). Returns 204.                                        | Required     |
| MKCOL      | Create a folder under an existing parent. Empty body only. Returns 201, 405 if the target exists, or 409 if the parent does not.                                                                  | Required     |
| MOVE       | Rename or relocate. Atomic for documents. For folders, updates the `parentId` of the moved folder. Honours `Overwrite: T/F` and `If` headers. Returns 201 (new destination) or 204 (overwrite).   | Required     |
| COPY       | Server-side copy. Document copies reuse the same Convex storage id (dedup). Folder copies recurse. Honours `Overwrite` and `If`.                                                                  | Required     |
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

Dead properties are not stored. PROPPATCH returns 200 per-property but no value is persisted.

## Lock semantics

Locks live in their own Convex table, keyed by `(organizationId, resourcePath)`. Wire form is `opaquelocktoken:<uuid>`. The server:

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
- `403` — Depth: infinity rejected; .trash write attempt; root delete/move; wrong app-password owner on UNLOCK; user not a member of the org
- `404` — resource not found
- `405` — GET on a collection; MKCOL on existing path; root MKCOL
- `409` — MKCOL when parent does not exist; PUT to a collection path
- `412` — `If` token mismatch
- `415` — MKCOL with non-empty XML body (extended MKCOL not implemented)
- `423` — write attempted on a locked path without matching `If`
- `502` — cross-host or cross-org `Destination`; storage proxy fetch failed

## Compliance

- DAV Class **1** (basic): full.
- DAV Class **2** (locking): full, with the lazy-expiry behaviour described above.
- DAV Class **3** (calendaring, contacts, search, ACL): not implemented.

The server advertises `DAV: 1, 2` in the OPTIONS response.

## Limits

- `Depth: infinity` on PROPFIND is rejected with `403`.
- `Timeout: Second-N` on LOCK is clamped to `[1, 3600]`.
- PUT body size is bounded by the platform's Convex storage upload-URL limit. The platform server forwards the body to a Convex presigned URL; the limit is whatever your self-hosted Convex deployment enforces. For unbounded streaming, consider importing through the REST API instead.
- App-passwords are hashed with HMAC-SHA256; the secret never appears in any response after the create call.
- `lastUsedAt` is patched at most once per minute per app-password to avoid write storms on busy mounts.

## Network requirements

The WebDAV endpoint runs inside the platform Hono server (`platform:3000` in compose). Caddy routes `/dav/*` to it via the default fallback — no extra configuration is required. The path requires the platform server to have `ADMIN_KEY` set in its environment so it can call internal Convex queries with admin auth.

For dev (`bun dev`), the same dispatch is mounted as a Vite middleware (`vite-plugins/serve-webdav.ts`) — `curl` and clients can hit `http://localhost:3000/dav/<orgSlug>/...` against a running dev server without rebuilding.

## See also

- [Platform > Integrations > WebDAV](/platform/integrations/webdav) — end-user setup guide and per-client instructions.
- [Develop > API reference](/develop/api-reference) — the REST API for bulk document import, search, and other non-mount workflows.
- RFC 4918 — WebDAV (HTTP extensions for distributed authoring).
