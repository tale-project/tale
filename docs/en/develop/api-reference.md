---
title: API reference
description: How to call Tale from outside — authentication, the endpoint inventory, pagination, the async run and turn loops, and the error model.
i18nLintExclude:
  - terminology-loanword
---

The Tale API is the surface integrators use when they are outside the product and want to script it: knowledge resources, projects with their files and tasks, automations and their runs, chat threads, agents, and skills, all as JSON over HTTPS with an API key in a header. The same key also opens the [MCP endpoint](/develop/mcp-endpoint) — this page covers the REST half.

This page is the canonical inventory of the surface, the auth model, and the error shape. Field-level request and response schemas live in the OpenAPI document your instance serves at `/openapi.json` — its `servers` entry names that instance, so a client generated from it targets the right host — and renders at `/docs`. Load it when you need every property; read this page to understand how the API behaves.

## A worked request

The shortest useful request — list the organization's automations — is one curl:

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/automations" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

A successful response is a named list: `{ "automations": [ { "name": "billing/dunning", "latestVersion": 3, "deployedVersion": 2 } ] }`. List shapes vary by family: most answer a named array like this one, while the knowledge and chat resources — contacts, products, documents, knowledge entries, threads, websites — answer a `{ "page": [...], "isDone": ..., "continueCursor": ... }` page envelope. Where a page envelope paginates, pass `continueCursor` back as `?cursor=` and cap the page with `?limit=`: contacts, products, documents, knowledge entries, threads, and websites all page this way to the last page (`isDone: true` with an empty `continueCursor`) — stop there: sending that empty cursor back answers **400**, `INVALID_QUERY`, like any blank parameter, never the first page again. Run listings page the same way under their own key — `{ "runs": [...], "isDone": ..., "continueCursor": ... }`, newest first, `?limit=` (1..200, default 50; out-of-range values are clamped) per page — and `GET /api/v1/runs` lists runs across every automation. The Projects machine door travels lighter still — its section shows those shapes.

## Authentication

API keys are minted in the product by anyone with Admin or Developer permissions — [API keys](/platform/admin/api-keys) covers the panel. A key is shown once at creation and never again; it belongs to the user who minted it, and every call it makes acts as that user.

Pass the key as a bearer token: `Authorization: Bearer <key>` — a key starts with `tale` and carries no separator; treat the whole string as opaque. That is the only place a key is read: a request that carries one as an `x-api-key` header — the header the platform's own door uses internally — is refused with **401** on every route, the sign-in and app doors included, so a leaked key can never act as a signed-in session. Every request acts as the key holder in an organization they belong to. An explicit `X-Organization-Slug` header selects that organization and is always membership-checked. A user with one membership can omit it. A user with several must include it on every call, reads included; otherwise the API answers **400**, `ORG_SLUG_REQUIRED` — the organization a person last opened in the dashboard never steers a machine call. A slug that names no organization answers **404**, `ORG_SLUG_INVALID`, and one the key holder is no member of **403**, `ORG_FORBIDDEN`. The **400** lists the slugs you may send under `data.organizations`; `GET /api/v1/me` lists them too, as its top-level `organizations`. The slug is matched without regard to case. `GET /api/v1/me` also answers `capabilities` — the gates a deployment knob decides rather than the role: `deploymentEditor` says whether this key may import or revoke browser sessions, so read it before building on those two routes instead of learning the answer from a **403**. Every operation in the OpenAPI document declares the header. Project access and the operation determine the required permissions: project readers can chat and comment, while changing project resources or starting task workflows needs project edit access. Arbitrary live automation runs also require the developer capability. The sections below give the operation-specific rules.

## What every request is held to

Bodies are JSON, read strictly: UTF-8 only — a byte sequence that is not UTF-8 answers **400**, `INVALID_BODY` — with no NUL character, and a whole number beyond 2^53 − 1 is refused rather than rounded, so send such an id as a string. Every body schema is strict: an unknown key answers **400**, `INVALID_BODY`, naming it. Query strings are strict the same way — a parameter a route does not take, one given twice, or a named filter left blank answers **400**, `INVALID_QUERY` — and writes take no query parameters at all. An out-of-range number is handled by where it travels: a query parameter (`limit`) is clamped into its range, while a body field (a search `limit`, `maxOutputTokens`) is refused with **400**, `INVALID_BODY`, naming it. A body is capped at 1 MiB unless the operation says otherwise — a document's inline `content` at 32 MiB, `POST /api/v1/contacts/bulk` at 8 MiB, a conversation snapshot at 8 MiB, a staged conversation upload at 30 MiB, a skill save at 4 MiB — and an oversized one answers **413**, `BODY_TOO_LARGE`, before a byte is read when its length is declared. Bodies are read as JSON whatever `Content-Type` says; there is no 415. Every served path answers `HEAD` (for a `GET`, with the `Content-Length` the `GET` would carry) and `OPTIONS` (**204** with `Allow`, no key needed), a verb a path does not take answers **405**, `METHOD_NOT_ALLOWED`, with `Allow` naming the verbs it does, and one trailing slash on a path is tolerated. The surface is server-to-server: no response carries CORS headers, so a browser page cannot call it — keep the key behind your own backend. A request URL (path and query) above 32 KiB answers **414**, `URI_TOO_LONG`, in the envelope, before any route is looked up; request headers as a whole are budgeted at 64 KiB at the edge, and past that HTTP/1.1 answers a bare **431** without the envelope while an HTTP/2 connection is closed without a response — carry data in the body, never in a header. Every response from this surface carries an `X-Request-Id` (a refusal answered at the edge, such as a dot-segment 404, carries a fresh id of its own) — send your own to correlate a call with what the platform logs: up to 255 characters of letters, digits, `_`, `-` and `=`, anything else is replaced by a fresh UUID and the response shows the id that was used; a **500**, a **413** and a **414** repeat it as `requestId` in the envelope. Every response also names the contract it implements in `X-Tale-Api-Version` (see [Versioning](#versioning)). Timestamps are epoch milliseconds everywhere — a skill's `updatedAt` is when its `SKILL.md` was last written — and ids are strings.

## Caching, compression and partial reads

Every JSON read — a `GET` that answers **200** — carries an `ETag` computed over its bytes and `Cache-Control: private, no-cache`: keep the answer, and send the tag back as `If-None-Match` on the next read. An unchanged resource answers **304** with no body, so a poller that watches a finished run, an idle thread or a document's indexing state spends a round trip instead of the payload. Send the tag back exactly as you received it: behind the compressing edge the tag of a compressed answer reads `"…-gzip"` or `"…-zstd"`, and that form matches, as does the weak `W/"…"` form; the 304 carries the tag the API computed. File content (`GET /api/v1/projects/{id}/files/{documentId}/content`) honours `If-None-Match` and `If-Modified-Since` against the `ETag` and `Last-Modified` it issues, the same way — a mirror re-downloads a file only when its bytes changed. A **304** still counts as one request against the [rate limits](/develop/rate-limits).

```bash
# The first read answers 200 and its ETag; the repeat with that tag answers 304
curl -sS --compressed -D - -o /dev/null "https://your-host.example.com/api/v1/projects/<projectId>/runs/<runId>?fields=status,finishedAt" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H 'If-None-Match: "<etag from the previous answer>"'
```

JSON and text responses are compressed when the request offers `gzip` or `zstd` in `Accept-Encoding` — `curl --compressed` does, and every HTTP library can — above a floor of about 512 bytes; `br` is not served, and a compressed answer carries no `Content-Length`. The examples on this page all ask for it: a run list is about six times smaller compressed, a run whose input repeats itself hundreds of times smaller.

Where a resource is large and a read needs only part of it, the operation says so: a run read takes `?fields=status,finishedAt` (any keys of the run, comma-separated) and answers exactly those keys, and a run listing that inlines full rows through `?include=` reads at most 25 rows per page and answers at most 8 MiB of them — it ends at the last row that fits, `isDone: false`, with a `continueCursor` at that row, so keep following the cursor until `isDone`.

## Sign in to an application with Tale

Tale is also an OpenID Connect issuer. A registered application sends you through Tale's native login and consent; it receives a signed identity with a verified email and membership in the one organization bound to its client. An API key does not authenticate a person for this flow.

Register the application with an active Owner or Admin session whose selected organization equals `TALE_ORG_ID`. `TALE_ORIGIN` is your Tale origin and `TALE_SESSION_COOKIE` is that session's cookie header. Use the application's exact HTTPS callback; HTTP is accepted only on loopback for local development:

```bash
curl -sS --compressed -X POST "$TALE_ORIGIN/api/app/identity/clients?orgId=$TALE_ORG_ID" \
  -H "Cookie: $TALE_SESSION_COOKIE" \
  -H "Origin: $TALE_ORIGIN" \
  -H "Content-Type: application/json" \
  -d '{"key":"office-app","name":"Office application","redirectUri":"https://office.example.com/api/auth/oauth2/callback/tale"}'
```

The first response is **201** with `{ "created": true, "client": { "client_id": "…", "client_secret": "…", … } }`. Store the secret in the application's secret environment. Repeating the same key and configuration returns **200**, `created: false`, and the same client ID without the secret. A changed callback or policy returns **409** so a rerun cannot silently redirect an existing integration.

| Purpose          | Endpoint or requirement                              |
| ---------------- | ---------------------------------------------------- |
| Issuer           | `https://your-host.example.com/api/auth`             |
| Discovery        | `GET /api/auth/.well-known/openid-configuration`     |
| Authorization    | `GET /api/auth/oauth2/authorize`                     |
| Code exchange    | `POST /api/auth/oauth2/token`, `client_secret_post`  |
| Signing keys     | `GET /api/auth/jwks`                                 |
| Current identity | `GET /api/auth/oauth2/userinfo`, bearer access token |
| Requested scopes | `openid profile email tale:organization`             |

Use a maintained OIDC client with authorization code flow, S256 PKCE, one-use state and a nonce. Validate the issuer, audience, RS256 signature, expiry and nonce of the ID token, then require `email_verified: true`. The `https://tale.dev/organization` claim contains `{ "id", "slug", "role" }` for the registered organization. Tale rechecks current membership and native MFA enforcement before issuing tokens and when reading userinfo; the application remains responsible for its own account access policy. Codes expire after 60 seconds and can be redeemed once; access and ID tokens expire after five minutes. Dynamic registration, implicit grants and refresh tokens are disabled.

Access tokens serve only native userinfo; external resource audiences are disabled. Use native API keys for REST requests.

Errors follow RFC 6749 and RFC 6750 — what a maintained client expects. `userinfo` answers **401** `invalid_token` with a `WWW-Authenticate: Bearer` challenge for an invalid or expired access token — every five-minute expiry walks this path, so treat it as a sign-in, not a retry — and **401** with the bare challenge when the token is missing; a token without the `openid` scope answers **403** `insufficient_scope`. The token and authorization endpoints answer `{ "error", "error_description" }`: a grant other than `authorization_code` is `unsupported_grant_type`, a malformed request `invalid_request`. Discovery lists `https://tale.dev/organization` under `claims_supported`; it also advertises the provider's introspection, revocation and end-session endpoints, which the flow above does not need.

For a reviewed client key, `POST /api/app/identity/clients/office-app/rotate-secret?orgId=<orgId>` with `{}` returns a new `client_secret` once and retires the old secret. `POST /api/app/identity/clients/office-app/status?orgId=<orgId>` with `{ "disabled": true }` blocks new authorizations; `false` restores the same client. Both require the same current organization, administrator session, Origin header and JSON content type as registration. Deleting an organization removes its clients and consent grants.

## Endpoint groups

For a project resource under `/api/v1`, put its project ID in the URL. These request bodies do not accept `projectId`; strict schemas reject it with **400**. The resource must belong to the named project and be visible to the key holder, otherwise the call answers **404**. Responses may include `projectId` as resource metadata. Organization catalogs, such as automation definitions and skill bundles, keep their organization paths.

| Group               | Path                                                                                                                        | What it covers                                                                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Automations         | `/api/v1/automations/...`                                                                                                   | Organization definitions, versions, triggers and the projects each is installed in; delete a definition; start and list runs that have no project.                                                                                               |
| Project automations | `/api/v1/projects/{id}/automations/...`                                                                                     | List installed automations, install or uninstall one, start and list this project's runs.                                                                                                                                                        |
| Runs                | `/api/v1/runs`, `/api/v1/projects/{id}/runs`, and one run at `/api/v1/projects/{id}/runs/{runId}` or `/api/v1/runs/{runId}` | List runs across automations; read one in full — status, output, trace, effects; `POST .../cancel` a live one and `DELETE` a finished one; use the project path for a project run.                                                               |
| Threads             | `/api/v1/projects/{id}/threads/...` or `/api/v1/threads/...`                                                                | The key holder's project chats or chats with no project: list, create, read, archive or restore, delete, send messages, poll the turn and cancel it.                                                                                             |
| Models              | `GET /api/v1/models`                                                                                                        | Configured chat models available to the key holder in this organization, with context window, output cap, capabilities, price, and `default: true` on the organization's pick when one is configured and accessible.                             |
| Agents              | `/api/v1/projects/{id}/agents/...`                                                                                          | List, read, create, update (conditionally, with `expectedUpdatedAt`) and delete agents within the required project.                                                                                                                              |
| Skills              | `/api/v1/skills/...`                                                                                                        | List, read, create or update, and delete organization skill bundles; read any file of a bundle. Every skill names its version (`etag`, `updatedAt`) and a save can be guarded with `If-Match`.                                                    |
| Knowledge entries   | `/api/v1/knowledge-entries/...`                                                                                             | Topic-keyed facts: list (`?topic=`, `?status=`), create, supersede, delete, and one topic's version history at `GET .../{id}/versions`.                                                                                                          |
| Knowledge search    | `POST /api/v1/projects/{id}/knowledge/search` or `POST /api/v1/knowledge/search`                                            | Search one project's indexed files, or visible non-project Hub documents and websites.                                                                                                                                                           |
| Documents           | `/api/v1/documents/...`                                                                                                     | Knowledge-base documents: CRUD (a `PATCH` answers the updated document), `GET .../content` for the bytes, plus `POST .../retry-indexing`; every file-backed document carries its `indexing` state. Hub only — project files live under Projects. |
| Websites            | `/api/v1/websites/...`                                                                                                      | Crawled sources: CRUD (a `PATCH` answers the updated website) plus `.../pages`, `.../sync`, `.../search`.                                                                                                                                        |
| Browser sessions    | `/api/v1/browser-sessions/...`                                                                                              | The warmed cookie pool behind [video ingestion](/self-hosted/configuration/video-ingestion): masked list, `POST .../import` and `DELETE .../{id}` for allowlisted operators (`GET /api/v1/me` says in advance whether this key is one: `capabilities.deploymentEditor`) — a session lives 14 days by default and 180 at most. |
| Products            | `/api/v1/products/...`                                                                                                      | Product catalog entries: CRUD (a `PATCH` answers the updated product).                                                                                                                                                                           |
| Contacts            | `/api/v1/contacts/...`                                                                                                      | Contact records: CRUD (a `PATCH` answers the updated contact) plus `POST /api/v1/contacts/bulk`.                                                                                                                                                 |
| Conversations       | `/api/v1/conversations/...`                                                                                                 | Mirror external conversations into Inbox as versioned snapshots, read a source's snapshot receipt, peek at a source's delivery queue, claim native replies, acknowledge or fail their delivery, and re-drive a dead-lettered one; exact schemas are in the running instance’s `/docs`. |
| Projects            | `/api/v1/projects/...`                                                                                                      | The machine door for external workers: list projects or look one up by external id, create, archive and restore, delete; prepare folders, upload, download and delete files, delete folders.                                                     |
| Tasks               | `/api/v1/projects/{id}/tasks/...`                                                                                           | Idempotent task creation from an external ref, state reads, workflow starts (answering the `runId` to poll) and comments within the named project.                                                                                               |
| MCP                 | `POST /api/v1/mcp`                                                                                                          | The [MCP endpoint](/develop/mcp-endpoint) — same key, JSON-RPC instead of REST.                                                                                                                                                                  |
| Webhook trigger     | `POST /api/projects/{id}/automations/webhook/{token}` or `POST /api/automations/webhook/{token}`                            | Start a deployed automation using its token; the [Webhooks page](/develop/webhooks) covers project and non-project URLs.                                                                                                                         |

Contacts, products and documents take the same optimistic-concurrency precondition: pass the last read `updatedAt` as optional `expectedUpdatedAt` in `PATCH /api/v1/contacts/{id}`, `PATCH /api/v1/products/{id}` or `PATCH /api/v1/documents/{id}`. A concurrent edit returns **409** — `CONTACT_STALE`, `PRODUCT_STALE` or `DOCUMENT_STALE`; reload the resource and merge your changes before retrying. Every `PATCH` — contact, product, document and website — answers **200** with the updated resource, so the next write has its `updatedAt`.

Contacts and products share one editing vocabulary. Strings are trimmed; a contact's `email` is stored lowercase, so duplicates match case-insensitively, and the part before `@` is at most 64 characters. `null` clears any optional field, and on `PATCH` a blank string reads as `null` — a blank required field (a product's `name`) answers **400**, `INVALID_BODY`; on create and bulk import a blank string reads as the field left out, so a CSV-shaped row imports cleanly. A contact is filed under at least one of `name`, `email` and `externalId`: a patch that would clear the last one answers **400**, `CONTACT_IDENTITY_REQUIRED`. `PATCH` merges `metadata` per RFC 7396 — contacts, products and documents alike: sent keys are set, omitted keys stay, a key sent as `null` is removed, and the whole field sent as `null` clears it — while `address` is replaced whole, an address being a unit. `address` and `metadata` (a document's `metadata` too) are bounded to 64 KiB of JSON, 8 levels of nesting and 500 keys in total; a larger value answers **400**, `INVALID_BODY`, naming the path. A product's `currency` is an ISO 4217 code (`USD`, `EUR`), accepted in any case and stored uppercase, and its `imageUrl` an absolute `http(s)` URL — any other value answers **400**. A website's `domain` is immutable: `PATCH /api/v1/websites/{id}` accepts the stored value echoed back (a client may send the resource it read) and answers **400**, `WEBSITE_DOMAIN_IMMUTABLE`, for any other. `POST /api/v1/websites` stores the host as given — `www.` is kept — and the `www.` and apex spellings count as one site: a domain already registered under either spelling answers **409**, `WEBSITE_DUPLICATE_DOMAIN`, with `data.websiteId` and `data.domain` naming the existing row. The one exception is a URL list posted onto a domain registered as a list under the same spelling, which extends it and answers **200** with the existing id; a list posted onto a whole-site crawl is the same **409** — the crawl keeps its kind and nothing is queued — so read `kind` before you post, or re-post under the spelling the 409 names.

`PUT /api/v1/skills/{slug}` creates the skill when the slug is free and updates it in place otherwise: `description` and `body` are required, an omitted `icon`, `labels`, `teams`, `visibility` or `disableModelInvocation` keeps its stored value, `null` clears `icon` or `labels`, and `disableModelInvocation: false` drops the flag. The body is Markdown of at most 507,893 bytes of UTF-8 — bytes, not characters: the composed `SKILL.md`, frontmatter included, is capped at 512 KiB and this budget always fits inside it — and a body that does not end with a newline gets one appended, so a `GET` reads it back one byte longer. The save rewrites `SKILL.md` only — every other file of the bundle stays, and frontmatter keys the body does not carry (`license`, `recommended-packages`, community keys) are preserved; replacing a whole bundle is the app's zip upload. Every skill names its version: `etag`, the quoted SHA-256 of its `SKILL.md`, and `updatedAt`, when that file was last written — the tag moves with every save of the document and with nothing else. `GET /api/v1/skills/{slug}` carries the tag as `ETag` and answers **304** to an `If-None-Match` that names it. Guard an update or a delete with `If-Match`: the `etag` you last read — a skill whose document changed since, or that is not there, answers **412**, `SKILL_STALE`, with the current tag in `data.etag`, and nothing is written, so reload and merge before saving again; a weak tag (`W/"…"`) never matches, and the body is validated before the precondition is evaluated. Send `If-None-Match: *` to create only: a slug that already has a bundle then answers **412**, `SKILL_EXISTS`, and nothing is written. `GET /api/v1/skills/{slug}/files/{path}` reads any file of the bundle — `SKILL.md` included — as raw bytes named by `Content-Disposition`, with `path` exactly as `files[].path` lists it (`/` raw or `%2F`); a path the list would never carry answers **404**, `SKILL_FILE_NOT_FOUND`, and a bundle the file layer refuses — a planted symlink, a file over the 4 MiB staging cap — **422**, `SKILL_MALFORMED`. Every skill carries `canEdit` — whether this key may edit the bundle; shipped skills are organization bundles an administrator may overwrite — so check it before a save that means to replace one. Skills support `org` and `team` visibility; `teams` must name teams in this organization. `private` skill visibility is retired: it cannot be set, and a bundle that already carries it keeps it only when the save omits `visibility`. A slug is at most 64 characters of lowercase letters, digits and single hyphens, and `anthropic` and `claude` are reserved; `PUT` refuses a malformed one with **400**, `INVALID_SKILL_SLUG`, naming the rule it breaks, while `GET` and `DELETE` answer it as absent with **404**, `SKILL_NOT_FOUND`.

A conversation mirror is a versioned snapshot: `POST /api/v1/conversations/sync` applies a newer integer `version`, ignores an older one, and answers **409**, `CONVERSATION_SNAPSHOT_CONFLICT` for the same version with different content — except a teardown, which is not content: `deleted: true` applies at the stored version or any higher one and replays as a no-op once the source is torn down, so a source whose versions ran out can still close its mirror. A message that began life as a native Inbox reply — one you claimed through `POST /api/v1/conversations/deliveries/claim` — carries `taleMessageId`, that reply's `messageId`, and must have been acknowledged under its `externalId` first (**409**, `DELIVERY_UNACKNOWLEDGED`); a message without `taleMessageId` is the source's own, whatever `isCustomer` says. A claim names a source you mirrored: one no snapshot ever named answers **404**, `CONVERSATION_SOURCE_NOT_FOUND`, and one that only other service users own **403**, `INTEGRATION_NOT_OWNED` — a mistyped source never polls a healthy-looking empty queue. A claimed delivery says where it stands — `attempts`, `leaseExpiresAt`, `lastErrorCode`, `firstClaimedAt` — and `GET /api/v1/conversations/deliveries?source=` reads the whole queue without claiming: every native reply with its `status` (`queued`, `leased`, `failed`, `delivered`), attempt count and stamps, never the claim token or the body, oldest-due first and paginated like the other lists; `?status=failed` lists the dead letters, and `POST /api/v1/conversations/deliveries/{id}/retry` re-drives one — the same audited action as the Inbox's Retry — while a delivery that is not dead-lettered answers **409**, `DELIVERY_RETRY_UNAVAILABLE`. A snapshot naming an attachment that was never staged through `POST /api/v1/conversations/uploads` (or whose window lapsed) answers **400**, `ATTACHMENT_NOT_STAGED`, and one whose declared `size` disagrees with the bytes that landed **400**, `ATTACHMENT_SIZE_MISMATCH`; nothing of it is applied. `GET .../deliveries/{id}/attachments/{index}` tells its absences apart: no claimed delivery under the id is `DELIVERY_NOT_FOUND`, a position the delivery does not carry — or one that is not a whole number in 0..9 — is `ATTACHMENT_NOT_FOUND`. Staged uploads (`POST /api/v1/conversations/uploads`) have no delete: one that is never bound is reclaimed lazily after its two-hour window plus a 24-hour grace, on the next upload into the organization, while a bound ref lives and dies with its message. Every conversations body is strict: an unknown key, in a message or an attachment too, answers **400**, `INVALID_BODY` naming it.

For a hub document, send inline `content` to `POST /api/v1/documents`. Inline content is stored and readable but never indexed: knowledge search finds only documents backed by an uploaded file, and `POST .../retry-indexing` answers `{"status": "skipped", "reason": "content-only"}` for one without (the other skip reasons are `untracked-blob` and `rag-opt-out`). Its `fileId` alternative requires the key holder's own unbound Hub upload in the selected organization, created through the app; REST does not mint one. To put text into the search corpus from REST, create a knowledge entry instead: `POST /api/v1/knowledge-entries` mints a file-backed, indexed Hub document (`sourceProvider: knowledge`, at most 8,000 characters, one active entry per topic) and answers **201** `{ "id", "documentId" }` — create, then poll `GET /api/v1/documents/{documentId}` for `indexing`, two calls and no read of the entry in between; a supersede (`PATCH`) answers the new row the same way and re-indexes under the same `documentId`, and a delete trashes it. The entry doors need the knowledge write grant — a read-only member answers **403**, `KNOWLEDGE_ENTRY_FORBIDDEN` — and an object store that does not accept the content within 30 seconds answers **503**, `KNOWLEDGE_ENTRY_STORE_TIMEOUT`, with nothing written. That document refuses a direct `DELETE /api/v1/documents/{id}`, or a `PATCH` of its title or content, with **409**, `DOCUMENT_HAS_KNOWLEDGE_ENTRY` and `data.entryId` — the entry is the way to change it. `GET /api/v1/knowledge-entries?topic=<topic>&status=superseded` lists one topic's replaced versions, each stamped with `supersededAt`, and `GET /api/v1/knowledge-entries/{id}/versions` answers the whole chain from any of its rows, newest first. Read a document's bytes at `GET /api/v1/documents/{id}/content` — the same download choreography as a project file (`Content-Disposition`, `Range`, `HEAD`), and a content-only document answers its inline text there too, typed as its `mimeType`; `GET /api/v1/documents/{id}` carries `content` only for a content-only document, `null` for a file-backed one. Every document answers `contentHash` — the SHA-256 the platform computed for its bytes (a knowledge entry's content, a synced file), `null` otherwise — as a field of its own, never a key in your `metadata`. A document `PATCH` that changes nothing — an empty body, or every field already at its value — writes nothing and leaves `updatedAt` alone, so a no-op retry never invalidates another client's `expectedUpdatedAt`; a controlled record's content, MIME type, extension or source provider is refused with **400**, `DOCUMENT_RECORD_FROZEN` (in review or approved) or `DOCUMENT_RECORD_REPLACEMENT_REQUIRED` (a draft — use the replacement flow), and a `teamId` the key holder is not a member of with **403**, `TEAM_ACCESS_DENIED`. Every file-backed document carries `indexing` — `status` is `pending`, `queued`, `running`, `completed`, `failed`, `unsupported` or `skipped`, with `indexedAt`, `error` and `errorCode` when set — so poll the document after a create or a `retry-indexing` instead of sleeping. An upload already attached to any document, thread or conversation cannot be reused here. A missing upload, another user's upload or a bound upload answers **404**, `FILE_NOT_FOUND`. Project, chat and conversation uploads cannot become Hub documents through this route. Trashed or expired documents, including files from a deleted project, stay out of this Hub surface. `POST` and `PATCH` bodies are strict: `projectId` is refused with **400**. Create project files through the project upload and file routes below.

## Manage a project's agents

Every agent belongs to a project. The project ID is required in the URL for every operation; responses include both `projectId` and the agent's `id`. These are the same agents managed in the project's **Agents** tab, with the same access rules.

| Operation               | Route                                           | Success        |
| ----------------------- | ----------------------------------------------- | -------------- |
| List the roster         | `GET /api/v1/projects/{id}/agents`              | `200 {agents}` |
| Create                  | `POST /api/v1/projects/{id}/agents`             | `201 {agent}`  |
| Read                    | `GET /api/v1/projects/{id}/agents/{agentId}`    | `200 {agent}`  |
| Save full configuration | `PUT /api/v1/projects/{id}/agents/{agentId}`    | `200 {agent}`  |
| Delete                  | `DELETE /api/v1/projects/{id}/agents/{agentId}` | `204`          |

Choose an existing project and a model available to the selected harness. This example creates a Claude Code agent and reads back its configuration; it does not start a task.

```bash
: "${BASE:?Set BASE to your Tale origin}"
: "${TALE_API_KEY:?Set TALE_API_KEY}"
: "${ORG_SLUG:?Set ORG_SLUG}"
: "${PROJECT_ID:?Set PROJECT_ID to an existing project ID}"
: "${MODEL_ID:?Set MODEL_ID to a model served by your harness}"
AGENT_URL="$BASE/api/v1/projects/$PROJECT_ID/agents"
AGENT_BODY=$(jq -n --arg model "$MODEL_ID" \
  '{name:"Reviewer",harness:"claude-code",model:$model,skills:[],connectors:[]}')
AGENT_ID=$(curl -fsS "$AGENT_URL" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $ORG_SLUG" \
  -H 'Content-Type: application/json' -d "$AGENT_BODY" | jq -er '.agent.id')
curl -fsS "$AGENT_URL/$AGENT_ID" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $ORG_SLUG" \
  | jq '.agent | {name, harness, skills, connectors}'
```

```json
{
  "name": "Reviewer",
  "harness": "claude-code",
  "skills": [],
  "connectors": []
}
```

`POST` and `PUT` require `name`, `harness`, `model`, `skills` and `connectors`. Optional fields are `modelProvider`, `tools`, `secrets` and `instructions`. A `PUT` saves the full configuration: omitted provider/instructions reset to `null`, and omitted tools/secrets reset to empty lists. It updates an existing agent; it does not create one at an unknown ID. Pass the `updatedAt` you last read as `expectedUpdatedAt` to make the save conditional: an agent that changed since answers **409**, `PROJECT_AGENT_STALE`, with the current `updatedAt` in `data`, and nothing is written — reload it and merge before saving again.

A project holds at most 50 agents. Names are unique within the project without regard to case, up to 120 characters; each equipment list allows 25 entries and instructions allow 20,000 characters. An invalid configuration or an exceeded limit answers **400**; a name another agent of the project already carries answers **409**, `PROJECT_AGENT_NAME_TAKEN` — the class every other duplicate on this door answers, so reuse the existing agent rather than retrying. `model` must be a model the organization's catalog lists (name `modelProvider` when several providers serve it) and `tools` must name known tool grants — a wrong value answers **400** with `PROJECT_AGENT_MODEL_INVALID`, `PROJECT_AGENT_PROVIDER_UNKNOWN` or `PROJECT_AGENT_TOOL_UNKNOWN` naming what to fix, instead of an agent that fails at its first task. `secrets` contains organization secret names, never values; a name the organization has not stored is refused with **400**, `PROJECT_AGENT_SECRET_UNKNOWN`, naming it in `data.secrets` (the app's dialog prunes such names; the API does not, so a typo never yields an agent that runs without its credential). Only organization Owners and Admins may change secret grants, so an editor's full save must preserve existing grants.

Project readers can read the roster; writes require project edit access and an active project. An invisible or missing project, or an agent ID from another project, answers **404**. A multi-organization key must include `X-Organization-Slug` on reads and writes. [Project agents](/platform/projects/project-agents) explains how these agents work on tasks; direct chat keeps using the built-in assistant.

## Automation names in URLs

An automation's name is a `/`-separated path — `billing/dunning` — and a path cannot travel inside one URL segment. In every `.../automations/{name}/...` URL, write the name with `__` in place of each `/`:

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/automations/billing__dunning/versions" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Responses always carry the real name (`"name": "billing/dunning"`); the `__` form exists only in URLs. Skill slugs are flat and need no encoding. Project agents use their project ID and agent ID.

`GET /api/v1/automations` lists each automation with its `latestVersion`, `deployedVersion` and `projectIds` — the projects it is installed in, which the run routes below require — plus what a launcher needs without a second call: its `description`, the `inputs` schema a run must match (the deployed version's, else the newest saved one's) and its `trigger` — the kind and whether it is switched on, or `null`. `GET /api/v1/automations/{name}` answers the newest saved version by default, which may be a draft; a live run executes the deployed one, so read the contract of the code that actually runs with `?version=deployed` (a number names any saved version). A version the automation does not have answers **404** `AUTOMATION_VERSION_UNKNOWN` — `?version=deployed` while nothing is deployed too — where an unknown automation answers `AUTOMATION_NOT_FOUND`. `GET /api/v1/automations/{name}/versions` names the `deployedVersion` and marks each row `deployed`. `DELETE /api/v1/automations/{name}` removes the automation, its versions, triggers and project bindings included, and answers **409** `AUTOMATION_HAS_ACTIVE_RUNS` while a run is in flight; it needs the developer capability.

## Triggers

A trigger starts an automation without a call from you: on a schedule, from a webhook URL, or when the platform raises an event. Bind one with `PUT /api/v1/automations/{name}/triggers` — one trigger per automation, and the `PUT` replaces whatever was bound:

```bash
curl -sS --compressed -X PUT "https://your-host.example.com/api/v1/automations/billing__dunning/triggers" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "kind": "event", "event": "contact.created" }'
# → 200 { "name": "billing/dunning" }
```

`kind` is `schedule` (with a five-field `cron` and an optional IANA `timezone`), `webhook` (the response carries the URL's `token` once — the [Webhooks page](/develop/webhooks) covers that door) or `event`. A trigger that could never fire is refused with **400** `AUTOMATION_TRIGGER_INVALID` and a sentence naming the fix: a cron that matches nothing (including a day no named month has, `0 0 30 2 *`), a time zone that is not an IANA zone, an event the platform does not raise. Each kind takes its own keys — `cron` and `timezone` only with `schedule`, `event` only with `event`, `rotateToken` only with `webhook` — and a key that belongs to another kind is refused as an unknown key (**400** `INVALID_BODY`, naming it under `data.issues`), so a webhook trigger can never read back as one that also runs on a schedule. An event trigger binds one of the events the platform raises today, and the run's input is `{ "trigger": "event", "event": "<name>", "payload": <the event's data> }`:

| Event                                                   | Raised when                                                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `contact.created`, `contact.updated`, `contact.deleted` | a contact is created, changed or deleted — through the API, the app or an import                                        |
| `conversation.created`                                  | a conversation opens in Inbox — an email arriving, or an external conversation mirrored in                              |
| `conversation.message_received`                         | a message lands on an existing conversation                                                                             |
| `project.created`                                       | a project is created                                                                                                    |
| `task.created`                                          | a task is created — on a board, through the API, or by an intake                                                        |
| `task.status_changed`                                   | a person moves a task to another status (an agent's own moves raise nothing, so an automation cannot re-trigger itself) |
| `comment.created`                                       | a comment lands on a task                                                                                               |
| `comment.mentioned`                                     | a task comment mentions someone with `@`                                                                                |

`GET .../triggers` reads the binding back with its health: `lastFiredAt` is the last time this binding **started a run** — `lastRunId` names it, and both stay `null` until it has — while `lastSkippedAt` and `lastSkipReason` record the last time it came due and started nothing: `not_deployed` (nothing is deployed — deploy a version), `unusable_cron` (the expression or zone could not be read; the scheduler leaves the binding alone until it is edited) or `start_refused` (the deployed version's `inputs` schema refused the run's input). A binding is alive when `lastFiredAt` keeps pace with its cadence; one whose `lastSkippedAt` is the newer stamp is coming due and not running, and the reason says what to fix. A rebind to another kind starts every stamp afresh. `enabled: false` pauses a trigger without losing it; `DELETE .../triggers` removes it — and, for a webhook, revokes the URL. So does binding another kind over a live webhook: the `PUT` still answers **200**, with `"revoked": "webhook"` beside the name, and the old URL is gone for good — a later webhook bind mints a different token.

## Start a run, then poll it

A run is durable and may take minutes, so starting one answers **202** with the run's identity, not its result:

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "input": { "customerId": "cus_123" } }'
# → 202 { "runId": "...", "version": 2, "name": "billing/dunning", "mode": "live" }
```

Poll `GET /api/v1/projects/{id}/runs/{runId}?fields=status,finishedAt` until `status` leaves `queued`/`running`/`waiting` — naming the keys keeps the poll to a line instead of the whole run, and sending the answer's `ETag` back as `If-None-Match` turns an unchanged poll into a bodiless **304** ([caching](#caching-compression-and-partial-reads)); then read the run in full: it carries `output`, the per-node `trace`, and the `effects` it produced. `waiting` covers two families and only one needs you: while a run is parked, `waitingFor` says on what — `approval` (a person's decision on a gate) and `ask` (a question a person has to answer) need a human; `agent` (an agent turn still running) and `repeat` (a node polling until its `repeatUntil` condition holds) do not, and a run can sit in either for minutes while healthy. "Runs that need a person" is `waitingFor` in (`approval`, `ask`) — never `status=waiting` alone, which fills with polling runs. `detail` names the park (`approval:<approvalId>`, `agent:<nodeId>`, `repeat:<nodeId>`) and, once failed, the failure sentence. `POST /api/v1/projects/{id}/runs/{runId}/cancel` stops a run at its next node boundary — work a node already completed is not undone.

A start is safe to retry when you name it: send `Idempotency-Key: <your key>` and a repeat within 24 hours — a retried timeout, a lost response — answers **202** with the run the first attempt started and `"duplicate": true`, so no second run exists; the same key with a different body answers **409** `IDEMPOTENCY_KEY_REUSED`. The key is scoped to the automation and the URL project, and a refused start remembers nothing, so the same key runs once the refusal is fixed.

`mode` defaults to `live`; arbitrary live runs and run cancellation require the developer capability. Project runs also require edit access to an active project, including `mode: "mock"`. Mock runs use deterministic mocks; a non-project mock run needs only membership. Starting a run needs no trigger. An automation with no deployed version answers **409** unless a saved version is explicitly selected for a mock run.

An unknown automation answers **404**. A live run can only use the deployed `version`; naming another saved version answers **409**. Use `mode: "mock"` to test another saved version. A missing body means `{}`, but malformed JSON answers **400** and starts nothing. When the automation declares an `inputs` schema, the input must match it before a run is created: a mismatch answers **400** `AUTOMATION_INPUT_INVALID` with every problem under `data.issues` (`path`, `message`), the way a refused body does. `input` defaults to `{}` only when it is absent — `null` is sent as null, for the schema to judge.

The project in the URL is the context for the run's task and document tools. An automation with project bindings can run only in a bound project. `GET /api/v1/projects/{id}/automations/{name}/runs` lists that project's history for one automation, `GET /api/v1/projects/{id}/runs` for every automation. Listings answer summaries — identity, scope, status and timing — newest first as `{ "runs": [...], "isDone": ..., "continueCursor": ... }`: add `?status=failed` (one or more statuses, comma-separated) to narrow them, `?include=input,output` (also `trace`, `effects`, `checkpoints`) to inline the full-row fields a summary leaves out — an inlining page reads at most 25 rows, is bounded at 8 MiB of them, and ends early, `isDone: false`, when the next row would not fit — and pass `continueCursor` back as `?cursor=` until `isDone`. `GET /api/v1/runs` is the cross-cutting view: every run the key holder can see, organization runs and the runs of visible projects alike, each row naming its `projectId`. For an automation with no bindings, `POST /api/v1/automations/{name}/runs` starts a non-project run; a bound automation answers **409** there. `GET /api/v1/automations/{name}/runs` and `/api/v1/runs/{runId}` expose only non-project runs. A project run requires its project URL for reading, cancellation and deletion. `DELETE /api/v1/projects/{id}/runs/{runId}` (or `/api/v1/runs/{runId}`) removes a finished run — stored input and output included — under the developer capability; a run still in flight answers **409** `RUN_ACTIVE`, so cancel it first.

## Send a message, then poll the turn

Project chat follows the same 202-then-poll shape. Use a project you can read, create a thread, post a message, poll the generation, then read the messages:

List models before sending a message. Each entry carries what a client needs to choose — `contextWindow`, `maxOutputTokens`, `capabilities` (`tools`, `vision`, `reasoning`), `pricing` when the catalog publishes one, `tags` — and `default: true` marks the organization’s pick for this key holder; it appears only when the organization pins a default model, so do not wait for it. Use an entry’s `id` as `model`; add its `providerSlug` when the same id is listed under more than one provider. The list respects the organization’s model-access policy and includes only models callable directly through REST; an empty list means no chat model is available to this key holder. The list is the organization’s configured catalog, not a promise from the provider’s account: an operator excludes a model the provider’s plan does not cover through the credential’s model allowlist in Settings. The pair is checked on send, at the door: an id the list does not carry answers **400**, `CHAT_MODEL_UNKNOWN`; an id several providers serve, with none named, **400**, `CHAT_MODEL_AMBIGUOUS` with the candidates in `data.providers`; a `providerSlug` the list does not carry **400**, `CHAT_PROVIDER_UNKNOWN`, and one that does not serve the chosen `model` **400**, `CHAT_MODEL_NOT_ON_PROVIDER`. The 202 names the provider the turn runs on, and the turn never falls back to another provider behind your back.

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/models" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# No available model → 200 { "models": [] }
```

```bash
# 1. A thread of your own
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/threads" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" -d '{}'
# → 201 { "id": "<threadId>" }

# 2. Send a message — on this API the model is always explicit, never auto-selected
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/threads/<threadId>/messages" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "content": "Summarise this quarter for me.", "model": "<model-id>", "providerSlug": "<provider-slug>" }'
# → 202 { "threadId": "...", "status": "accepted", "model": "...", "providerSlug": "...", "messageId": "<assistantMessageId>", "poll": "/api/v1/projects/<projectId>/threads/<threadId>/generation" }

# 3. Poll until idle, then read
curl -sS --compressed "https://your-host.example.com/api/v1/projects/<projectId>/threads/<threadId>/generation" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "status": "queued", "messageId": "..." } … then { "status": "streaming", "messageId": "...", "text": "The quarter…", "textOffset": 0, "textLength": 12, "reasoning": "", "cancelRequested": false, "updatedAt": 1774... } … then { "status": "idle", "lastMessageId": "<assistantMessageId>", "lastStatus": "complete" }

# 4. Read the reply by the id the 202 named
curl -sS "https://your-host.example.com/api/v1/projects/<projectId>/threads/<threadId>/messages/<assistantMessageId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "id": "<assistantMessageId>", "role": "assistant", "status": "complete", "finishReason": "stop", "parts": [ … ], "usage": { … }, … }
```

`idle` means no turn is running, and it names the newest assistant message: compare `lastMessageId` with the `messageId` the 202 named — equal means your turn settled (`lastStatus` says how), a different id means yours has not started. Then read the reply by its id at `GET /api/v1/projects/{id}/threads/{threadId}/messages/{messageId}`, or page the transcript newest-first with `GET .../messages?order=desc` (a cursor is bound to the direction it was minted in). `queued` means the send was accepted and is waiting for a worker; `streaming` means the model is streaming its reply to the server, and `text` and `reasoning` carry what has arrived so far — there is no push channel on this surface, so poll every two to five seconds with a client timeout of at least thirty seconds, and send `?since=<textLength>` from the previous poll to receive only the characters that arrived after it (`textOffset` says where the slice starts; when it is below the `since` you sent, the text was reset by a settled tool round — replace what you hold). Keep the `messageId` the 202 names: it is the assistant message the reply lands in. If you lose the 202 (a dropped connection after the send), poll `.../generation` — `queued` or `streaming` means the turn is running, `idle` means compare `lastMessageId` as above, or find the newest `user` row carrying your `content`.

A send is safe to retry when you name it: send `Idempotency-Key: <your key>` and a repeat within 24 hours — a retried timeout, a lost 202 — answers **202** with what the first attempt answered, the same `messageId` included, and `"duplicate": true`, so no second turn runs or bills; the same key with a different body answers **409**, `IDEMPOTENCY_KEY_REUSED`. The key is scoped to the thread and the URL project, and a refused send (a thread still mid-turn) remembers nothing, so the same key sends once the poll says idle.

Every turn runs the built-in workspace assistant: its instructions, its safety rules and its three retrieval tools ride every request — about 3,000 prompt tokens per model round, counted in `usage.inputTokens`; a turn that calls a tool runs up to five rounds, each billing its full prompt again — and a request for a deliverable (a document, a report) is redirected to Tasks by design. This is a conversation with the workspace, not a bare model call. Two optional fields bound a turn: `reasoningEffort` picks the reasoning depth on the same five-step scale the app offers (`low`, `medium`, `high`, `extra`, `max`; ignored by a model without `capabilities.reasoning`), and `maxOutputTokens` caps the reply — it must not exceed the model’s own `maxOutputTokens` from `GET /api/v1/models`, or the send answers **400**, `INVALID_BODY` naming the ceiling; a thinking model keeps its reasoning budget under the cap. A reply that runs into the cap still settles as `complete` — the text is cut short, nothing else marks it — and says so with `finishReason: "length"`: read `finishReason` on every settled assistant message (`stop`, `length`, `tool-calls`, `content-filter`, `cancelled`, `other`; absent when the provider reported none) rather than comparing `usage.outputTokens` with the cap you sent. Lists, thread details, messages and generation status contain only the key holder's own threads in that project; another user's thread stays invisible even if you both belong to the project. List with `GET /api/v1/projects/{id}/threads` and read a thread with `GET /api/v1/projects/{id}/threads/{threadId}`.

`content` is trimmed before it is checked, so a blank prompt answers **400** instead of spending a turn; `locale` is a BCP 47 tag (`de`, `en-GB`) naming the language the assistant answers in. Every message carries a `status`: while a turn runs, its assistant row is already on the page as `pending` with empty `parts` — the row `.../generation` names as `messageId` — and settles to `complete`, to `cancelled` after a stop (with the partial output that had streamed), or to `failed` with `error` and `errorCode`, when the turn ends. `usage` carries the token counters and the cost: `reasoningTokens` is the share of `outputTokens` spent thinking, `cachedInputTokens` the share of `inputTokens` served from the provider’s cache, and `costEstimateCents` (fractional US cents) is the catalog estimate the organization’s usage ledger books for the same turn — absent when the catalog publishes no price for the model; cached input is priced at the input rate, so on a cached turn the figure is an upper bound. `usage.estimated: true` marks a turn whose counts are the platform’s own estimate because the provider’s count was lost — a cancelled turn, typically; the estimate charges the whole prompt, the assistant’s tools included — and `usage.stepLimitHit: true` a turn whose tool loop spent its whole round budget. `usage` is absent on a turn that failed before the provider reported any counts. `parts` is an ordered list discriminated by `type` — `text`, `reasoning`, `attachment`, `tool-call`, `tool-result`, `approval`, `human-input` — and the OpenAPI document types each kind. A `reasoning` part is the model’s thinking and may quote the assistant’s own instructions: display it as such, never as the answer. The vocabulary is additive, so render a kind you do not know as opaque.

For a personal chat with no project, use `/api/v1/threads` and its corresponding detail, messages and generation paths. Those URLs cannot address project threads. A wrong project URL answers **404**. Both kinds use the built-in assistant; `projectId`, `agentSlug` and `agentId` in create or message bodies answer **400**. Project readers, including Members, may create and send; an archived project refuses these writes with **403**. An archived thread refuses a message with **409**, `CHAT_THREAD_ARCHIVED`, a sandbox thread with **409**, `CHAT_THREAD_NOT_DIRECT`, and a thread whose turn is still running — or whose accepted send is still queued — with **409**, `CHAT_TURN_IN_PROGRESS`; nothing is queued and the running turn keeps its `messageId`. Retry the last one once the poll says idle, never the other two.

The lifecycle is yours through the same URLs. `PATCH .../threads/{threadId}` with `{ "archived": true }` archives a thread out of the way and `false` restores it, and `{ "title": "Q3 review" }` renames it (send at least one of the two; a title is trimmed and 1–120 characters, on create and on rename alike); a thread created without a title is named by the assistant after its first message, and the thread’s `title` carries the name either way. Archiving stamps `archivedAt` on the thread and leaves `updatedAt` alone — `updatedAt` is the last message activity, so a sync that watches it must read `archived` and `archivedAt` to see an archive or a restore. `DELETE .../threads/{threadId}` moves it to the trash (**409**, `CHAT_TURN_IN_PROGRESS` while a turn runs or a send is still queued); `DELETE .../threads/{threadId}/generation` asks the running turn to stop — **202** `{ "status": "cancelling" }`, then poll until idle; the stopped reply settles as `status: "cancelled"` with whatever had streamed; **404**, `CHAT_TURN_NOT_RUNNING` when nothing runs. An archived project refuses all three with **403**.

A model failure can appear as an assistant message with readable `error` text and, when available, `errorCode`. The model list is the organization’s configured catalog, not a promise from the provider’s account, so two codes mean the account rather than the request: `credit_exhausted` (the balance is spent) and `model_not_entitled` (the provider’s plan excludes this model). Pick another model or fix the account — waiting changes nothing, and neither is a `rate_limited`. The worker rechecks the accepted thread and project access before opening the turn. If the thread moves projects or access is lost while the request waits, it does not run or append an error in the new scope.

## Search a project's files

Use the project search URL when results must come from one project. It searches only that project's indexed files and requires read access, including for an archived project. Hub or team documents, other projects, websites and email attachments are outside this search. Omit `corpus` or set it to `"documents"`; any other corpus or a `projectId` body field answers **400**.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/knowledge/search" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "query": "Q1 filing deadline", "limit": 10 }'
```

The body requires `query` (trimmed before it is checked) and also accepts `limit` (1–50, default 10) and `minSimilarity` (0–1). `limit` is the size of the page, not of the search: the platform fuses a wider candidate pool, checks every candidate against its live document, and only then cuts the page — so `limit: 1` returns the best readable passage. `minSimilarity` floors the dense (vector) leg only, before fusion; there is no default on this door, so without it the nearest passages answer however weak, and the keyword leg is never floored (the built-in assistant's search applies the organization's configured floor instead — `minSimilarity` in its [`embedding.json`](/self-hosted/configuration/data-residency#the-organizations-embedding-model), 0.45 when unset). Hits come back in fused order, best first. `fusedScore` is that order key and nothing more: Σ 1/(60+rank) over the legs that ranked the passage, divided by the best possible for that many legs — a rank, so the best candidate of a one-leg search scores 1.0 however weak the leg found it; comparable only within one response, never a confidence, and not stable across searches. Every candidate is checked against its live document before fusion, so a passage you cannot see never holds a rank. What you can threshold on is `similarity` — the dense leg's cosine on the embedding model's own 0..1 scale, `null` when only the keyword leg found the passage — beside `keywordScore` (the BM25 weight, unbounded, `null` when only the vector leg found it) and `matchedLegs` (`documents:keyword`, `documents:dense`, `web:keyword`, `web:dense` — which legs ranked it; `legs` is their count, 2 when the keyword and the vector leg agreed). Each hit carries its passage, its leg `score` (the first matched leg's own number) and its `source`; `diagnostics.cached` and `diagnostics.reranked` are reserved for a deployment that installs a semantic cache or a reranker — none ships, so both are always `false`; a documents hit also carries `source.documentId` beside the blob `ref` the index keys it by: for a Hub hit (`source.projectId` null) it is the id `GET /api/v1/documents/{id}` takes, for a project hit the file id the project routes take (`GET /api/v1/projects/{projectId}/files/{documentId}/content`, `DELETE .../files/{documentId}`) — `/api/v1/documents/{id}` answers **404** for a project file. A missing embedding model answers **409**, `EMBEDDING_NOT_CONFIGURED`; so does an embedding provider that refuses for account reasons — a spent balance, a spend limit, or a plan that excludes the model — as **409**, `EMBEDDING_CREDIT_EXHAUSTED`; a credential the provider rejects, or one it refuses the model, is **409**, `EMBEDDING_CREDENTIAL_REJECTED` — fix the provider settings. Neither is a rate limit: no wait lifts them, an admin has to act. Any other provider failure answers **503**, `EMBEDDING_UPSTREAM_ERROR`, with `Retry-After` — retry that one with backoff. To search visible non-project Hub and team documents or registered websites instead, use `POST /api/v1/knowledge/search` with `corpus` set to `"documents"`, `"web"` or `"all"` (the default). That URL excludes project files and email attachments. Both URLs find file-backed documents only — a document created with inline `content` never indexes.

## Mirror an external system into a project

The Projects group is built for an unattended worker that mirrors an external system — a CRM, a practice-management tool — into Tale: find or create the client's project, prepare its folders, upload files, verify. Every call acts as the key's minting user: a project that user cannot see answers as if it did not exist, and writes need an editing role (Editor or above — Member is read-only here) plus edit access on the project.

These routes, and the Tasks routes below, refuse to guess the organization: a key whose user belongs to several organizations must send `X-Organization-Slug` on every call — a request without it answers **400**. Mint machine keys for a dedicated user with exactly one membership and the question never comes up; the examples keep the header anyway — it is always membership-checked, never ignored.

### Find or create the project

`externalItemId` is your key, not Tale's — an opaque string (your CRM's record id), unique per organization, never interpreted by the platform. It is stored and compared after NFC normalization and trimming, so a key handed over in NFD by a macOS filesystem finds the project a worker created in NFC from a CSV, and a trailing newline from a shell variable never makes a second project. Look it up first; the lookup answers at most one project, and a match the key's user cannot see looks exactly like no match:

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects?externalItemId=crm-4711" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "projects": [] } — or [ { "id": "...", "name": "ACME Ltd", "externalItemId": "crm-4711" } ]
```

A match carries `archivedAt` when the project is archived — decide what your worker does with that case before it happens. Without `externalItemId`, the same route lists every project the key's user can see, newest first, paged like the files listing — `{projects, isDone, cursor?}`; pass `cursor` back unchanged until `isDone` — with archived projects left out unless you ask for them (`?archived=include`, or `?archived=only`). Every row carries `createdAt` and `updatedAt`, so a worker can reconcile what it created:

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects?limit=50" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "projects": [ { "id": "...", "name": "ACME Ltd", "externalItemId": "crm-4711", "createdAt": 1774..., "updatedAt": 1774... } ], "isDone": true }
```

An empty lookup means create:

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "ACME Ltd", "externalItemId": "crm-4711" }'
# → 201 { "project": { "id": "...", "name": "ACME Ltd", "key": "ACME", "externalItemId": "crm-4711" } }
```

`key` (the task-identifier prefix) and `description` are optional — the key derives from the name when omitted. A second create with the same `externalItemId` — the same after NFC normalization and trimming — answers **409**; the same string in another organization is fine, uniqueness is per organization. A key that is blank once trimmed answers **400**, `INVALID_BODY`.

An explicit project `key` contains 2–6 letters or digits and is normalized to uppercase; invalid keys answer **400**, without truncation. A name that yields no valid key creates a keyless project. A derived key that collides is re-derived until it is free; an explicit key that collides answers **409**, `PROJECT_KEY_TAKEN` — supply an unused one. The same `externalItemId` twice is **409**, `PROJECT_DUPLICATE_EXTERNAL_ID`.

### Create folders

Folder creation is get-or-create: the same name under the same parent — compared without regard to case, so `inbox` and `INBOX` are one folder — answers the existing folder with its stored name and `created: false` (**200**) instead of a duplicate, so a worker re-runs its setup step blindly after a crash; two workers creating the same folder at once get one folder. Folder names carry no platform-reserved meanings — the layout is yours:

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/folders" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "2026-Q1" }'
# → 201 { "folder": { "id": "<folderId>", "name": "2026-Q1" }, "created": true }
```

`parentId` (a folder of this project) nests deeper; omit it for a root folder. A name is at most 128 characters, trimmed, and never a path — `a/b`, `.` and `..` answer **400**, `FOLDER_NAME_INVALID` — and a folder 20 levels deep takes no child (**400**, `FOLDER_DEPTH_EXCEEDED`). The tree reads back one level at a time: `GET .../folders` lists the root folders, `GET .../folders?parentId=<folderId>` the children of one folder, and every folder carries its `parentId` (`null` at the root); `GET .../folders/{folderId}` resolves a single folder — the `folderId` every file in `GET .../files` carries — so a worker that did not build the tree can still discover it, and a path is the parent chain walked upward. A `parentId` or `folderId` that is not a folder of this project answers **404**, `FOLDER_NOT_FOUND`.

### Upload a file in two steps

An upload is a handoff, then a bind. Mint the handoff first — it answers where the bytes go:

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/uploads" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "contentType": "application/pdf" }'
# → 200 { "uploadId": "...", "url": "https://...", "method": "PUT", "s3Ref": "...", "expiresAt": 1774..., "maxBytes": 104857600 }
```

Every blob is object-store-backed, so `url` is always a presigned `PUT`: send the bytes there with that method and no `Authorization` header — the URL carries its own signature, and the bucket refuses a request that authenticates twice — with a `Content-Type` header exactly matching the `contentType` you declared when minting — the declared type is signed into the URL, so the bucket refuses a PUT that carries a different one (omit `contentType` at mint and the PUT has no header requirement) — then bind the handoff's `s3Ref` back as `fileId`. Name the file at the mint (`"fileName": "ledger-2026-q1.pdf"`) and the bind's type rules run before anything is presigned: a name the organization's upload policy or the platform's format allowlist refuses answers **400** here (`UPLOAD_POLICY_REJECTED`, `UNSUPPORTED_FILE_TYPE`), so the bytes never travel. The mint also answers `maxBytes` — the largest file the organization accepts for the declared type: the platform ceiling of 100 MiB (104,857,600 bytes) or the organization's lower cap — and takes an optional `size`, the bytes you are about to send: a size the bind would refuse answers **400** here too, `FILE_TOO_LARGE` over the ceiling or `UPLOAD_POLICY_REJECTED` over the organization's cap or your volume quota, with the limit in `data.limitBytes`. Declare it and a too-large file costs one request instead of the whole upload; the bind still judges the landed size, so an understated `size` is refused there. The bind completes the upload:

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/files" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "uploadId": "<uploadId>", "fileId": "<s3Ref>", "folderId": "<folderId>", "fileName": "ledger-2026-q1.pdf" }'
# → 201 { "file": { "id": "...", "fileName": "ledger-2026-q1.pdf", "folderId": "<folderId>", "projectId": "<projectId>" } }
```

The `uploadId` is single-use and expires after 30 minutes, and the presigned `url` expires with it — `expiresAt` is the one deadline for both — so a worker that crashed mid-upload mints a fresh handoff instead of retrying the old one. `fileName` is a plain name: a path separator or a control character in it answers **400**. Upload policy applies at the bind: an oversized blob or a type outside the allowlist is refused with **400** and a reason code; a bind whose bytes never reached the presigned URL answers **404**, `BLOB_NOT_FOUND`, and the intent is rolled back, so PUT the file and bind the same handoff again. A deployment without an object store answers **503**, `OBJECT_STORE_UNCONFIGURED`, at the mint and the bind alike. Bytes that landed at the presigned URL but were never bound — a bind that was refused, a worker that crashed between the two calls, a handoff that simply expired — are not yours to delete and need no delete: the platform reclaims them lazily, 24 hours after the handoff's 30-minute expiry, on the next mint into the organization (a batch per mint), removing the blob together with the intent. Until then they sit in the bucket; they never become files, never count against a quota, and never surface in a listing.

Files that enter through this door are project working material, not organization knowledge: they skip knowledge indexing by default (`skipRagIndexing` defaults to `true` on the bind; pass `false` to opt in), and they never appear under `/api/v1/documents` — that family stays the knowledge hub's surface.

### Verify what landed

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects/<projectId>/files?folderId=<folderId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "files": [ { "id": "...", "fileName": "ledger-2026-q1.pdf", "createdAt": 1774... } ] }
```

The listing answers `{files, isDone, cursor?}`: a `cursor` in the response means more pages — pass it back as `?cursor=` unchanged (it is an opaque signed token), cap the page with `?limit=` (max 100).

### Delete what you no longer need

Nothing this door creates has to stay forever. A file goes with `DELETE .../files/{documentId}` — permanently: its document row, its search-corpus rows and its blob are purged through the same lane every hard delete uses, so the answer is **204** or a refusal, never a silent no-op:

```bash
curl -sS --compressed -X DELETE "https://your-host.example.com/api/v1/projects/<projectId>/files/<documentId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 204
```

A folder goes with `DELETE .../folders/{folderId}`, and everything beneath it goes too — every file in it and in its subfolders is purged first (their corpus rows released at once, so project search stops matching them), then the subtree. A protected controlled record or a legal hold anywhere beneath refuses the whole delete with **409** before anything is removed; a purge the object store could not finish answers **503**, `PURGE_INCOMPLETE`, with nothing removed — retry it. Both deletes need edit access to an active project; a file or folder of another project, or one already gone, answers **404** (`FILE_NOT_FOUND`, `FOLDER_NOT_FOUND`).

The project itself has a lifecycle too, for organization admins (**403**, `ROLE_FORBIDDEN`, for anyone else). `PATCH /api/v1/projects/{id}` with `{ "archived": true }` archives it — it stays readable through this door, refuses every write with **403**, `PROJECT_ARCHIVED`, keeps its `externalItemId` taken, and `{ "archived": false }` restores it. The same `PATCH` carries the identity a mirror propagates when the source record changes: `name` (trimmed, never blank), `description` (`null` clears it) and `externalItemId` (stored NFC-normalized and trimmed; `null` releases the key, another project's key answers **409**, `PROJECT_DUPLICATE_EXTERNAL_ID`, with the key in `data`) — for editors with project edit access on an active project, every field optional and at least one required. A body that restores and renames applies the restore first, one that renames and archives applies the archive last; renaming an archived project the body does not restore answers **403**, `PROJECT_ARCHIVED`. When "ACME Ltd" becomes "ACME Group" in the CRM, `{ "name": "ACME Group" }` is the whole move — nothing under the project is touched. `DELETE /api/v1/projects/{id}` removes it and frees the key: by default a cascade — every document expires into the retention pipeline, your own chats are trashed, every task is retired and its live runs cancelled — or, with the body `{ "mode": "detach" }`, the documents and chats are released into the organization instead. Agents and folders go with the project either way, and a cascade draws on the same per-user budget the app's delete does (5 per minute):

```bash
curl -sS --compressed -X DELETE "https://your-host.example.com/api/v1/projects/<projectId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 204
```

The delete is refused with **409**, before anything is written, while an automation is installed in the project — `PROJECT_HAS_BOUND_AUTOMATIONS`, with `data.automations` naming them; uninstall each via `DELETE /projects/{id}/automations/{name}` first — while a cascade would destroy a controlled record that is in review, approved or retains an approved version (`PROJECT_HAS_PROTECTED_RECORDS`, `data.documents` naming them), or while a legal hold covers one of its documents (`PROJECT_LEGAL_HOLD`).

## Materialize a task, then run it

The Tasks group turns an external item into a task on a project's board, starts a deployed workflow on it and reports back. A project-bound automation must be installed in this project first. Installing is idempotent: **201** on the first call, **200** when the binding exists. It requires the developer capability and edit access to an active project. Bind ahead of time if the worker's user lacks those permissions:

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/automations/vat-return" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{}'
# → 201 { "name": "vat-return", "added": true }
```

`GET /api/v1/projects/{id}/automations` lists the automations installed in that project. An automation without any project bindings can also run in an accessible project when the caller has the required edit permissions, but it is not part of that installed list. `DELETE /api/v1/projects/{id}/automations/{name}` uninstalls one again — **204**, or **404** `AUTOMATION_NOT_INSTALLED` when it was not installed there — under the same developer capability and edit access.

Task creation is idempotent per `(projectId, externalSystem, externalId)`: the first call creates (**201**, `created: true`), and a repeat answers with the same task (**200**, `created: false`). Both keys are stored and compared after NFC normalization and trimming — the same rule as a project's `externalItemId` — so a padded or differently normalized repeat is still the same task, and a key that is blank once trimmed answers **400**. Take `projectId` from the URL; sending it in the body answers **400**. Creating a task requires edit access to an active project.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "externalSystem": "crm", "externalId": "case-991", "title": "Prepare the Q1 filing" }'
# → 201 { "task": { "id": "<taskId>", "created": true } }
```

Repeating an active task’s external reference updates its title and description; omitting `description` clears it. Labels change only when supplied. An archived task stays unchanged. The task id stays the same, and `runWorkflowSlug` does not start another run on that repeat. Keep the repeated payload stable when retrying after a lost response.

`description`, `labels`, and `externalUrl` are optional; `title` takes up to 200 characters and `externalUrl` must be an absolute `http(s)` URL — a longer title or another scheme answers **400** rather than a silently altered task. Labels keep their spelling: a name is trimmed and NFC-normalized, matched against the project's catalog without regard to case, created with the spelling you sent when it is new, and read back as stored in the order you sent — so `["Bug", "P1"]` reads back as `["Bug", "P1"]`, while `["bug"]` on a project that already has `Bug` wears that existing label (two names differing only in case are one label, never two). Send `automationSlug` when the task belongs to an automation: it becomes the assignee, and the task modal's work panel — the Start button, run progress, and the operator questions a run asks — keys on that ownership (a later re-pick fills a missing attribution, but never overwrites an assignee). `runWorkflowSlug` starts a deployed workflow on a newly created task in the same call — the run starts inline, so the response carries its `runId` (the run id to poll; `executionId` repeats it and is deprecated), or `runId: null` when the slug names no deployed automation. Start explicitly instead when you want to name the workflow in a separate call. The owning `automationSlug` must name a deployed automation, otherwise the call answers **404**. A workflow bound to other projects answers **403**.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/start" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "workflowSlug": "vat-return" }'
# → 200 { "started": true, "runId": "<runId>", "executionId": "<runId>" }
```

Starting requires edit access to an active project and an active task — an archived task answers **403**, `TASK_ARCHIVED`. It wraps the task as `{task: ...}` and needs no additional developer capability; the run log attributes the start to your key. Poll `GET /api/v1/projects/{id}/runs/{runId}` with the `runId` (`executionId` carries the same value and is deprecated). The answer is **200** whether or not a run started, so branch on `started`, never on the status alone: with `started: false`, `reason: "already_running"` carries the in-flight run's `runId` — poll that run — and `reason: "not_started"` means the slug names no deployed automation.

Report back and read state — the comment posts as the key's minting user, indistinguishable from the same person commenting in the app, @mentions included. Project readers, including Members, may comment on an active task in an active project; an archived task refuses the comment with **403**, `TASK_ARCHIVED`, the way an archived project does with `PROJECT_ARCHIVED`. Reading a task or its comments is also allowed after archival. Every task URL is judged left to right: a project that is missing or invisible answers **404**, `PROJECT_NOT_FOUND`, and only a task that is missing or belongs to another project answers `TASK_NOT_FOUND`.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/comments" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "body": "Filed. Confirmation 2026-8842." }'
# → 201 { "comment": { "id": "..." } }

curl -sS --compressed "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "task": { "id": "<taskId>", "title": "...", "status": "in_progress", "externalId": "case-991", "labels": [], ... } }
```

And fetch the results. What the automation reported lands in the task's discussion; what it filed lands as files in the quarter's folder — both readable through the door. The discussion comes newest page first (`limit`, default 200, at most 500), chronological within the page; while `isDone` is `false`, pass `continueCursor` back as `cursor` unchanged to read the older comments — it is an opaque signed token, not a number. The content endpoint streams the bytes itself (**200**, no redirect to follow), named by an RFC 6266 `Content-Disposition`, so a plain `curl -o` lands the file and `--fail-with-body` turns a refusal into a non-zero exit instead of a file full of JSON. `Range` is honoured: a single byte range (`bytes=0-1023`, `bytes=1024-`, `bytes=-512`) answers **206** with `Content-Range`; a range starting at or past the end of the file — what `curl -C -` sends once the local copy is complete — answers **416** with an empty body and `Content-Range: bytes */<size>` naming the size, so a resuming worker learns it is done; several ranges or a `Range` the server cannot read are ignored and the whole file answers **200**. A `HEAD` answers the same headers a `GET` carries — `Content-Length`, `Content-Type`, `ETag`, `Last-Modified`, `Accept-Ranges` — without the bytes and ignores `Range`, so a poller checks for a new version with `curl -I` (not `curl -X HEAD`, which waits for a body) and sends the `ETag` back as `If-None-Match` to get **304** while nothing changed:

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/comments?limit=100" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "comments": [ { "id": "...", "authorType": "agent", "body": "Return prepared — key figures…", ... } ], "isDone": false, "continueCursor": "<opaque token>" }

curl -sS --compressed --fail-with-body "https://your-host.example.com/api/v1/projects/<projectId>/files/<documentId>/content" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -o report.md
# → the file bytes (Content-Disposition carries the filename)
```

## Error model

Every non-2xx response carries one flat envelope:

```json
{ "error": "Automation not found", "code": "AUTOMATION_NOT_FOUND" }
```

`error` is a sentence for humans; `code` is the stable value to branch on — every refusal the API itself makes carries one, and the OpenAPI document lists the full set as the `Error.code` enum. The set is additive: a new code is a minor change, so treat a value you do not know as a generic refusal of the status you got. Some refusals add `data` — `issues` for a refused body, `retryAfterMs` for a rate limit, `providers` for an ambiguous model. Branch on the code where one is named below, on the status otherwise:

- **400** — malformed request: a missing required field, a wrong type, an unknown key, an unparseable body, a body that is not UTF-8, a string carrying a NUL character, a whole number beyond 2^53 − 1 — the envelope carries `code: "INVALID_BODY"` and lists every problem under `data.issues`, each naming the field (`price`, `contacts.2.email`; an unknown key is named as its own issue) and the reason as a short phrase you can show a person — `is required`, `must be a string`, `must not be blank`, `must be at most 200 characters`, `must be one of "a", "b"` — so fix what `path` names and branch on `code`, never on the sentence. Bodies are read as JSON whatever `Content-Type` says; the door never answers 415; a `cursor` the list never answered (`INVALID_CURSOR`), a `limit` that is not a whole number (`INVALID_LIMIT` — out-of-range values are clamped instead) or another query parameter the route refuses (`INVALID_QUERY`) — none is read as the first page; a run input the automation's `inputs` schema refuses (`AUTOMATION_INPUT_INVALID`, `data.issues` again) or a trigger that could never fire (`AUTOMATION_TRIGGER_INVALID` — including a day no named month has, `0 0 30 2 *`); a contact patch that would clear its last identity field (`CONTACT_IDENTITY_REQUIRED`); a controlled record's content patched while frozen or outside the replacement flow (`DOCUMENT_RECORD_FROZEN`, `DOCUMENT_RECORD_REPLACEMENT_REQUIRED`); or a multi-org key that did not name its organization (`ORG_SLUG_REQUIRED`).
- **401** — missing or invalid API key (`UNAUTHORIZED`), with a `WWW-Authenticate: Bearer` challenge.
- **403** — the holder lacks the required role (`ROLE_FORBIDDEN`, `KNOWLEDGE_ENTRY_FORBIDDEN`) or project edit access, a document `teamId` names a team the holder is not in (`TEAM_ACCESS_DENIED`), the project or task is archived for a requested mutation (`PROJECT_ARCHIVED`, `TASK_ARCHIVED`), an automation cannot run in this project, or `X-Organization-Slug` names an organization the key holder is no member of (`ORG_FORBIDDEN`).
- **404** — the resource is absent, invisible to the holder, owned by another thread user, or belongs to a different project than the URL names; each family names its own code (`PROJECT_NOT_FOUND`, `DOCUMENT_NOT_FOUND`, `THREAD_NOT_FOUND`, …), an `X-Organization-Slug` that names no organization answers `ORG_SLUG_INVALID`, and an unknown route answers `NOT_FOUND`.
- **405** — the route exists, but not for that verb (`METHOD_NOT_ALLOWED`); `Allow` lists the verbs it serves.
- **409** — the state refuses the action: no deployed version, a bound automation called without a project URL, a run still in flight on delete (`RUN_ACTIVE`), an `Idempotency-Key` reused with a different body (`IDEMPOTENCY_KEY_REUSED`), an archived thread or a turn already running, a duplicate topic, email or `externalItemId`, a superseded knowledge entry (`KNOWLEDGE_ENTRY_SUPERSEDED`), a stale `expectedUpdatedAt` (`CONTACT_STALE`, `PRODUCT_STALE`, `DOCUMENT_STALE`), a document that backs an active knowledge entry (`DOCUMENT_HAS_KNOWLEDGE_ENTRY` — delete or update the entry instead), a delivery retry on one that is not dead-lettered (`DELIVERY_RETRY_UNAVAILABLE`), or search without an embedding model.
- **412** — a precondition failed and nothing was written: `If-Match` on a skill whose `SKILL.md` changed since you read it, or with nothing stored (`SKILL_STALE` — `data.etag` names the current tag, `null` when nothing is stored); `If-None-Match: *` on a skill slug that already has a bundle (`SKILL_EXISTS`).
- **413** — the body is too large (`BODY_TOO_LARGE`; the sentence names the cap): every JSON body at its cap (1 MiB unless the operation says otherwise — the caps are listed above), the webhook trigger at its 256 KiB (262,144 bytes) cap. An uploaded file that breaks the size or type policy is refused at the bind with **400** and a reason code instead.
- **422** — a skill body the file layer cannot read, or a bundle it refuses — a planted symlink, a file over the staging cap (`SKILL_MALFORMED`).
- **429** — rate limit exceeded (`RATE_LIMITED` — on this one refusal `error` repeats the code); the response carries `Retry-After` in whole seconds and `data.retryAfterMs` — see [Rate limits](/develop/rate-limits).
- **414** — the request URL (path and query) exceeds 32 KiB (`URI_TOO_LONG`); the envelope carries a `requestId`.
- **431** — the request headers as a whole exceed the edge's 64 KiB budget; answered without the envelope on HTTP/1.1, and on HTTP/2 by closing the connection.
- **500** — internal error (`INTERNAL_ERROR`); the envelope carries a `requestId` to quote when you report it.
- **503** — a dependency the request needed is down: the embedding provider (`EMBEDDING_UPSTREAM_ERROR`, with `Retry-After`), the object store behind a file download (`OBJECT_STORE_UNAVAILABLE`, with `Retry-After`) or a deployment without one (`OBJECT_STORE_UNCONFIGURED`), or a document purge that could not finish (`PURGE_INCOMPLETE`) — retry with backoff.

Unbinding a trigger from an existing automation (`DELETE .../triggers`) answers **204** whether or not a trigger was bound; an unknown automation answers **404**. Deleting a resource answers **404** when it is absent, including a contact already moved to trash or a knowledge entry already deleted. Deleting an active knowledge entry retires every version of its topic and moves the Hub document behind it to the trash — and drops that document's passages from the search corpus at once; deleting that document directly is refused. Cancelling an unknown run also answers **404**; `{cancelled: false}` means the run exists but has already finished.

## Versioning

Three numbers describe a running instance, and they mean different things. The build (`GET /api/health` answers it) is the deployment's release. The REST prefix, `/api/v1/`, is the compatibility line: a route under it is served until a `/api/v2/` exists and the retirement of `/api/v1/` has been announced in the release notes at least two minor releases ahead, with `Deprecation` and `Sunset` headers on the retiring routes in the meantime. The contract's own version is `info.version` in the OpenAPI document at `/openapi.json` — semver for the wire: a minor bump for an additive change (a new operation, field, header or error code), a major one for a removal or a changed meaning — and every response names the version the instance implements in `X-Tale-Api-Version`, so a client that pins to a version can tell when the instance moved. The document describes the routes and request and response schemas served by the running instance, with `servers` set to that instance; `/docs` renders it. Use it as the contract for your client, and read each release's notes under **API contract changes** — every wire change to this surface is listed there with the old and the new behaviour ([release notes format](/self-hosted/operate/release-notes/format)).

A few doors live outside that document on purpose: `GET /api/health` is the unauthenticated liveness probe (`{"status":"ok","version":"<build>"}`), `GET /status` and `/status.json` the deployment's own [status page](/develop/status-page), `/openapi.json` and `/docs` the contract itself; the [WebDAV](/develop/webdav-api) and OpenID Connect surfaces (above) speak their own protocols.

## Where this fits

This page is the REST half of the outside surface. The [MCP endpoint](/develop/mcp-endpoint) exposes the same platform to MCP clients — automation authoring lives there, not in REST. The [Webhooks page](/develop/webhooks) covers the inbound trigger that starts runs without a key. If you are building inside the product — project agents, automations — the [Platform tab](/platform) is your day-to-day; this page is for outside.
