---
title: API reference
description: Call the REST API, choose the organization and project, read paginated results, and handle asynchronous work and errors.
i18nLintExclude:
  - terminology-loanword
---

The REST API lets you read and change Tale resources with an API key: projects, files, tasks, automations, runs and chat threads. Start with [your first API request](/get-started/developers) to verify access, then use the operation-specific sections below.

Your instance serves the field-level OpenAPI schema at `/openapi.json` and an interactive reference at `/docs`. Use that instance’s schema when generating a client. This page explains permissions, scope, asynchronous work and errors that apply across those operations.

## A worked request

Set `TALE_URL` to your application origin, `TALE_API_KEY` to your key, and `TALE_ORG_SLUG` to the intended organization. Keep secrets in the environment. Begin with an identity check before creating resources:

```bash
curl --fail-with-body --compressed "$TALE_URL/api/v1/me" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG"
```

A `200` response identifies `user`, the selected `organization`, all current `organizations`, deployment `capabilities`, and this `key`'s name and expiration. Check the organization and role before continuing. The examples below use placeholder project, file, and run IDs: obtain actual IDs from a previous response rather than copying a display name or guessing an ID.

### Read every page of a list

List responses use named collections, not a bare array. The instance's OpenAPI `200` schemas declare `x-tale-pagination`; use it to choose the correct loop.

| Family | Requests | Response and stopping rule |
| --- | --- | --- |
| Keyset | `cursor`, `limit` | Rows plus `isDone` and `continueCursor`; stop at `isDone: true` |
| Offset: website pages only | `cursor` or `offset`, never both | `pages`, `total`, `offset`, `hasMore`, plus `isDone` and a signed `continueCursor` |
| Unpaginated | No `cursor` or `limit` | Named array containing the complete set or the operation's bounded roster |

For keyset lists, send `continueCursor` back unchanged. Do not decode or increment it. At the last page it is empty; sending that empty value again returns `400 INVALID_QUERY`, not the first page. Each operation declares its limit ceiling: usually 100 or 200, and 500 for task comments. Larger query limits are clamped.

Contacts and products are ordered by `updatedAt`, then `id`, both descending. Editing a record while you page can move it ahead of your cursor, so that pass may miss the change. For a full reconciliation, compare each record’s `updatedAt` and repeat complete passes; a cursor does not provide a snapshot of a changing directory. Hub documents, projects, project files, and websites use newest-first `createdAt` order.

Contacts, products, documents, knowledge entries, threads, messages, websites, and notification exports put their keyset rows under `page`. Runs, deliveries, task comments, projects, and project files use their resource name, such as `runs` or `files`. Run lists are newest first, default to 50, and accept limits of 1–200. `GET /api/v1/runs` lists accessible runs across automations.

Automations, agents, skills, folders, models, browser sessions, versions, and triggers are unpaginated. A website-page request with both `cursor` and `offset` receives `400 INVALID_QUERY`; the signed next-offset cursor also works with the normal keyset loop.

## Authentication

Create keys in **Settings > API > REST** with Admin or Developer access; [API keys](/platform/admin/api-keys) explains the UI. A key appears once and acts as the user who created it. This REST surface does not create, list, rotate, or revoke keys.

| Header | Rule |
| --- | --- |
| `Authorization: Bearer <key>` | The only supported API-key location; preserve the whole opaque string, including its `tale` prefix |
| `X-Organization-Slug: <slug>` | Select a current membership; always send it in reusable integrations |
| `x-api-key` | Rejected with `401`, even beside a valid Bearer header; it cannot turn an API key into an app session |

A user with exactly one organization can omit the organization header. With several memberships, every request needs it, including reads. The dashboard's selected organization never selects API scope. Slugs are matched without regard to case; blank or whitespace-only values count as absent.

| Organization selection | Result |
| --- | --- |
| Several memberships, no slug | `400 ORG_SLUG_REQUIRED`; available slugs are in `data.organizations` |
| Unknown slug | `404 ORG_SLUG_INVALID` |
| Existing organization without membership | `403 ORG_FORBIDDEN` |
| Valid membership | Request proceeds under that organization and role |

`GET /api/v1/me` also returns the membership list as `organizations`. Its `key.expiresAt` is epoch milliseconds, or `null` for a non-expiring key: rotate unattended credentials before expiry causes `401`. `key.name` identifies the credential in use.

Check both the role and the resource scope before offering an operation. Project readers can chat and comment; resource changes and task-workflow starts require edit access.

| Capability returned by `/me` | What it permits |
| --- | --- |
| `developer` | The Owner, Admin, and Developer roles can start arbitrary live runs, cancel or delete runs, bind or unbind triggers, delete automations, and install or uninstall project automations. These REST operations return `403 ROLE_FORBIDDEN` without it. MCP also checks this capability for saving, deploying, and other privileged tools, using its own error envelope. Validation and mock tools remain available to members. Project access is checked separately. |
| `deploymentEditor` | The operator allowlist permits browser-session import and revocation. An administrative role alone does not grant this capability. |
| `notificationExport` | The key may export members’ notifications through `GET /api/v1/notifications/sync`. Owners and Admins have it through their role; any other member only while an Admin’s `tale:notifications.export` grant is live — see [Delegate the export without an Admin role](#delegate-the-export-without-an-admin-role). Without it, the export returns `403 ROLE_FORBIDDEN`. |
| `actAs` | The key may name an `actor` — the verified member a relayed gesture is recorded for — on `POST …/runs/{runId}/asks/{askId}` and `POST …/tasks/{taskId}/review`. Owners and Admins have it through their role; any other member only while an Admin’s `tale:rest.act-as` grant is live — see [Name the member the gesture is for](#name-the-member-the-gesture-is-for). An `actor` sent without it returns `403 ROLE_FORBIDDEN`. |

## What every request is held to

### JSON and query validation

Send JSON encoded as UTF-8. Invalid UTF-8, NUL characters, unpaired UTF-16 surrogates in keys or values, and integer values beyond 2^53 − 1 return `400 INVALID_BODY`. Represent large identifiers as strings. Nested validation issues include the full field path, such as `messages.0.createdAt`. IDs are strings and timestamps are epoch milliseconds. A skill’s `updatedAt` records when its `SKILL.md` was written.

| Input | Rule |
| --- | --- |
| Unknown body key | `400 INVALID_BODY`, with the key named in the issue |
| Duplicate JSON key | Last value wins |
| Unknown, repeated, or blank query parameter | `400 INVALID_QUERY` |
| Query on a write operation | Rejected; writes take no query parameters |
| Query `limit` outside its range | Clamped to the operation's range |
| Body number outside its range | `400 INVALID_BODY`; search `limit` and `maxOutputTokens` are examples |
| `Content-Type` | Bodies are parsed as JSON regardless of this header; this surface does not return `415` |
| `Accept` | JSON operations return JSON even when this header requests another format or excludes JSON; there is no `406` |

### Request-size and arrival limits

| Body | Maximum |
| --- | --- |
| Default JSON request | 1 MiB |
| Inline document content | 32 MiB |
| Contact bulk import | 8 MiB |
| Conversation snapshot | 8 MiB |
| Staged conversation upload | 30 MiB |
| Skill save | 4 MiB |
| Delivery claim, failure report, or acknowledgement | 64 KiB |

An oversized body receives `413 BODY_TOO_LARGE`. When the declared length exceeds the cap, the platform rejects before reading the body; otherwise it stops at the first chunk over the cap. It never buffers the complete oversized body. Upload-specific rules can be lower than these transport limits.

Headers and body must finish arriving within 15 minutes. A 30 MiB body needs roughly 35 KB/s to meet that deadline. A slower request receives `408 REQUEST_TIMEOUT` and the connection closes. Use a faster link, smaller supported requests, or the two-step project upload, which transfers file bytes outside this JSON arrival window.

### Methods and response identifiers

Existing read routes accept `HEAD`, with the uncompressed `GET` length and no body; `HEAD` is never compressed. `OPTIONS` is keyless and returns `204` with `Allow`. An unsupported verb on an existing route returns `405 METHOD_NOT_ALLOWED` and its allowed verbs. One trailing slash is tolerated.

The production REST surface is server-to-server and does not enable CORS. Keep API keys behind your own backend. The keyless status JSON is a separate CORS-enabled surface.

Every API response includes `X-Request-Id`. To correlate a request with logs, send up to 255 characters drawn from letters, digits, `_`, `-`, and `=`. An invalid value is replaced by a fresh UUID; the response contains the value actually used. `429`, `500`, `413`, and `414` also include `requestId` in the JSON envelope. Two refusals are the exception, because the edge's HTTP parser answers them before a request exists to log: the bare `431` for headers over the 64 KiB budget and the bare `400` for a control character in a header value carry no `X-Request-Id`, no envelope and no `X-Tale-Api-Version` — there is nothing to quote, and the request itself is what to change.

`Idempotency-Key` is read only by the operations that declare it — a run start, a chat send; the OpenAPI document lists them, and the webhook endpoints read it as a delivery id under their own rule. Any other operation ignores the header: its at-most-once guard is the natural key its body names — a contact's `externalId`, a task's `(externalSystem, externalId)`, a project's `externalItemId`. An `Expect: 100-continue` draws one `100 Continue` from the edge as soon as it starts forwarding the body; the platform's own verdict — a `413` for a declared length over the cap — still arrives before a body byte is read.

Responses from `/api/v1` and webhook routes include `X-Tale-Api-Version`; see [Versioning](#versioning). Keyless `/api/health`, `/status`, `/status.json`, and `/openapi.json` do not implement that contract and have no version header.

<Accordion title="Advanced HTTP and proxy behavior">

The URL, including query, is limited to 32 KiB; a larger one gets `414 URI_TOO_LONG` before route lookup. Request headers have a 64 KiB edge budget. HTTP/1.1 permits a few KiB of slack before a bare `431`, so a 66 KiB URL can still reach the platform and receive `414`. HTTP/2 enforces the header budget exactly by closing the connection without a response.

Header control characters below 0x20, except tab, and DEL are rejected before the platform: HTTP/1.1 receives a bare text `400` with no `X-Request-Id`; HTTP/2 resets the stream or closes a connection carrying a body.

Malformed HTTP/1.1 chunk framing, such as a non-hexadecimal chunk size or missing CRLF, receives `400 BODY_CHUNK_MALFORMED` at the edge. Correct the HTTP client or intermediary that encoded the request; retrying the same malformed bytes will not help.

For an oversized declared body, the HTTP/1.1 edge may drain up to 256 KiB before delivering the refusal, although the platform reads none. If a body ends before its declared length, HTTP/2 returns `400 BODY_LENGTH_MISMATCH`, unless the platform's over-cap `413` won the race. HTTP/1.1 waits for the missing bytes until the 15-minute arrival deadline.

Edge refusals have their own request ID and no `X-Tale-Api-Version`: the proxy does not know the application contract. Examples include a dot-segment `404`, `BODY_LENGTH_MISMATCH`, `BODY_CHUNK_MALFORMED`, and `502`/`503`/`504 UPSTREAM_UNAVAILABLE` during a restart. Do not assume every intermediary response has the API's JSON envelope.

</Accordion>

## Caching, compression and partial reads

### Reuse unchanged responses

Every JSON read — a `GET` that returns **200** — carries an `ETag` computed over its bytes and `Cache-Control: private, no-cache`: keep the answer, and send the tag back as `If-None-Match` on the next read. An unchanged resource returns **304** with no body, so a poller that watches a finished run, an idle thread or a document's indexing state spends a round trip instead of the payload.

Send the tag back exactly as you received it: behind the compressing edge the tag of a compressed answer reads `"…-gzip"` or `"…-zstd"`, and that form matches, as does the weak `W/"…"` form; the 304 carries the tag the API computed. File content — `GET /api/v1/projects/{id}/files/{documentId}/content` and a Hub document's `GET /api/v1/documents/{id}/content` alike — honours `If-None-Match` and `If-Modified-Since` against the `ETag` and `Last-Modified` it issues, the same way — a mirror re-downloads a file only when its bytes changed.

The date is judged at the whole-second precision an HTTP date carries, and `If-None-Match` decides alone when both travel; on a content-only Hub document `Last-Modified` is the document's own `updatedAt`, which a title or metadata patch moves too, so a mirror that tracks bytes sends the `ETag`. A **304** still counts as one request against the [rate limits](/develop/rate-limits).

```bash
# The first read answers 200 and its ETag; the repeat with that tag answers 304
curl -sS --compressed -D - -o /dev/null "https://your-host.example.com/api/v1/projects/<projectId>/runs/<runId>?fields=status,finishedAt" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG" \
  -H 'If-None-Match: "<etag from the previous answer>"'
```

### Request compression

JSON and text responses are compressed when the request offers `gzip` or `zstd` in `Accept-Encoding` — `curl --compressed` does, and every HTTP library can — above a floor of about 512 bytes; `br` is not served. A compressed answer's `Content-Length`, when present, is the compressed size (a large answer streams without one) and its `ETag` reads with the `-gzip`/`-zstd` suffix, as above; a `HEAD` is never compressed and reports the uncompressed length. Request compression for large JSON responses when your HTTP client supports it. The benefit depends on the response content; it does not reduce the number of requests charged to your rate budget.

### Read only the fields you need

Where a resource is large and a read needs only part of it, the operation says so: a run read takes `?fields=status,finishedAt` (any keys of the run, comma-separated) and returns exactly those keys, and a run listing that inlines full rows through `?include=` reads at most 25 rows per page and returns at most 8 MiB of them — it ends at the last row that fits, `isDone: false`, with a `continueCursor` at that row, so keep following the cursor until `isDone`.

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

| Purpose          | Endpoint or requirement                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| Issuer           | `https://your-host.example.com/api/auth`                                     |
| Discovery        | `GET /api/auth/.well-known/openid-configuration`                             |
| Authorization    | `GET /api/auth/oauth2/authorize`                                             |
| Code exchange    | `POST /api/auth/oauth2/token`, `client_secret_basic` or `client_secret_post` |
| Signing keys     | `GET /api/auth/jwks`                                                         |
| Current identity | `GET /api/auth/oauth2/userinfo`, bearer access token                         |
| Requested scopes | `openid profile email tale:organization`                                     |

Use a maintained OIDC client with authorization code flow, S256 PKCE, one-use state and a nonce. Validate the issuer, audience, RS256 signature, expiry and nonce of the ID token, then require `email_verified: true`. The `https://tale.dev/organization` claim contains `{ "id", "slug", "role" }` for the registered organization. Every ID token also carries `acr: "urn:mace:incommon:iap:bronze"` — always that value, the one discovery lists under `acr_values_supported` and `claims_supported`; Tale asserts no stronger authentication context, MFA enforcement included, so do not gate on `acr`. Discovery's `prompt_values_supported` names what the issuer honours — `none`, `login`, `consent`; `select_account` and `create` are not offered.

Tale rechecks current membership and native MFA enforcement before issuing tokens and when reading userinfo; the application remains responsible for its own account access policy. Codes expire after 60 seconds and can be redeemed once; access and ID tokens expire after five minutes. Dynamic registration, implicit grants and refresh tokens are disabled.

Access tokens serve only native userinfo; external resource audiences are disabled. Use native API keys for REST requests.

### Handle identity-provider errors

Errors follow RFC 6749 and RFC 6750 — what a maintained client expects. `userinfo` returns **401** `invalid_token` with a `WWW-Authenticate: Bearer` challenge for an invalid or expired access token — every five-minute expiry walks this path, so treat it as a sign-in, not a retry — and **401** with the bare challenge when the token is missing; a token without the `openid` scope returns **403** `insufficient_scope`.

The token and authorization endpoints answer `{ "error", "error_description" }`: a grant other than `authorization_code` is `unsupported_grant_type`, a malformed request — a missing `grant_type` included — `invalid_request`, with the description naming the parameter (`grant_type is required`, `client_id is required`, `response_type must be one of "code"`). A body of the wrong media type on a JSON-only endpoint (a form posted to `register`) returns **400** `invalid_request` naming the type it takes — there is no 415 on this surface.

An authorization request whose `client_id` names no registered client is redirected to the issuer's own error page — never to the `redirect_uri` it sent — with `error=invalid_client` and a description that says the client is unknown, so a mistyped id is not mistaken for a missing one. Discovery lists `https://tale.dev/organization` under `claims_supported`; it also advertises the provider's introspection, revocation and end-session endpoints, which the flow above does not need.

### Rotate or disable an application client

For a reviewed client key, `POST /api/app/identity/clients/office-app/rotate-secret?orgId=<orgId>` with `{}` returns a new `client_secret` once and retires the old secret. `POST /api/app/identity/clients/office-app/status?orgId=<orgId>` with `{ "disabled": true }` blocks new authorizations; `false` restores the same client. Both require the same current organization, administrator session, Origin header and JSON content type as registration. Deleting an organization removes its clients and consent grants.

## Endpoint groups

For a project resource under `/api/v1`, put its project ID in the URL. These request bodies do not accept `projectId`; strict schemas reject it with **400**. The resource must belong to the named project and be visible to the key holder, otherwise the call returns **404**. Responses may include `projectId` as resource metadata. Organization catalogs, such as automation definitions and skill bundles, keep their organization paths.

Every **201** that creates one addressable resource carries `Location` — the resource's own path, relative to the request URL — so a generic client follows it whatever shape the body has (`{id}` on a contact, `{project}` on a project, `{task}` on a task); the bulk contact import creates many and carries none.

Automation authoring is separate from this REST surface. Use the [MCP endpoint](/develop/mcp-endpoint) or the app’s editor to save, validate, test, and deploy definitions. `tale deploy` releases deployment configuration; it is not a REST authoring endpoint.

| Resource | Route and scope |
| --- | --- |
| Automations | `/api/v1/automations/...`<br>Organization definitions, versions, triggers and the projects each is installed in; delete a definition; start and list runs that have no project. |
| Project automations | `/api/v1/projects/{id}/automations/...`<br>List installed automations, install or uninstall one, start and list this project's runs. |
| Runs | `/api/v1/runs`, `/api/v1/projects/{id}/runs`, and one run at `/api/v1/projects/{id}/runs/{runId}` or `/api/v1/runs/{runId}`<br>List runs across automations; read one in full — status, output, trace, effects; `POST .../cancel` a live one and `DELETE` a finished one; read the question a waiting run asks at `GET .../ask` and answer it at `POST .../asks/{askId}`; use the project path for a project run. |
| Threads | `/api/v1/projects/{id}/threads/...` or `/api/v1/threads/...`<br>The key holder's project chats or chats with no project: list, create, read, archive or restore, delete, send messages, poll the turn and cancel it. |
| Models | `GET /api/v1/models`<br>Configured chat models available to the key holder in this organization — plus `harnesses`, the coding harnesses a project agent may run on — with `contextWindow`, `maxOutputTokens` (absent when the catalog declares no ceiling — then no cap check applies to a send), capabilities, optional `pricing` when the catalog publishes rates, and `default: true` on the organization's pick when one is configured and accessible. |
| Teams | `GET /api/v1/teams`<br>Every team of the organization — `id`, `name` and whether the key holder is a `member` — as a complete set: the ids a team audience takes (`teamIds` on a project or a Hub document, `teams` on a skill). Teams are created and staffed in the app (Settings > Teams) or by an identity provider; nothing on this surface writes one. |
| Agents | `/api/v1/projects/{id}/agents/...`<br>List, read, create, update (conditionally, with `expectedUpdatedAt`) and delete agents within the required project. A `PUT` that names the configuration already stored writes nothing and leaves `updatedAt` alone. |
| Skills | `/api/v1/skills/...`<br>List, read, create or update, and delete organization skill bundles; read any file of a bundle — a validated read (`ETag` and `Last-Modified` on the bytes; `If-None-Match` / `If-Modified-Since` answer **304**), so a mirror re-downloads only what changed. Every skill names its version (`etag`, `updatedAt`) and a save can be guarded with `If-Match`; a skill keeps no version history on this surface — the read answers the current bundle only. |
| Knowledge entries | `/api/v1/knowledge-entries/...`<br>Topic-keyed facts: list (`?topic=`, `?status=`), create, supersede, delete, and one topic's version history at `GET .../{id}/versions`. |
| Knowledge search | `POST /api/v1/projects/{id}/knowledge/search` or `POST /api/v1/knowledge/search`<br>Search one project's indexed files, or visible non-project Hub documents and websites. |
| Documents | `/api/v1/documents/...`<br>Knowledge-base documents: CRUD (a `PATCH` returns the updated document), `GET .../content` for the bytes, plus `POST .../retry-indexing`; every file-backed document carries its `indexing` state. Hub only — project files live under Projects. |
| Websites | `/api/v1/websites/...`<br>Crawled sources: CRUD (a `PATCH` returns the updated website) plus `.../pages` — each page with its `status` (`discovered` until a fetch stores it, `active` from then on), `failCount`, and, when its last attempt failed, `lastError`, `lastErrorKind` and `lastErrorAt`, so a page the fetch guard refused (a redirect into a private address) is told apart from one nobody has fetched yet — `.../sync` and `.../search`. Search returns `{results, total}` — each result its `url`, `title`, `content`, `chunkIndex` and `score` — a shape of its own, not the `{hits, diagnostics}` of the knowledge-search endpoints; its `limit` (1–100, default 10) is a body field, refused with **400**, `INVALID_BODY`, when out of range — never clamped. On the website, `crawledPageCount` counts the pages the crawler attempted, stored or not, and `failedPageCount` those whose last attempt failed; the three counts are stamped by the corpus → row sync, which runs after discovery, after every stored batch, at each link's end and at the scan's end (`metadata.lastStatusSyncAt` says when) and which `POST .../sync` forces, and `lastScannedAt` is when the last scan ended. Discovery honours `robots.txt` `Disallow` rules on every path a URL can enter by, listed URLs excepted, and a page a rule covers leaves the index on the next scan; `POST /api/v1/websites` refuses an `http://` domain (`WEBSITE_DOMAIN_INVALID` — the crawler dials https only) and drops a trailing dot, so `example.com.` is `example.com`; a page's `lastError` is one line naming the cause, never a framework call log. |
| Browser sessions | `/api/v1/browser-sessions/...`<br>Browser cookies for [video ingestion](/self-hosted/configuration/video-ingestion). Organization members can read the masked list. `POST .../import` and `DELETE .../{id}` require an allowlisted deployment editor; check `capabilities.deploymentEditor` in `/me`. Sessions last 14 days by default and at most 180 days. |
| Products | `/api/v1/products/...`<br>Product catalog entries: CRUD (a `PATCH` returns the updated product). |
| Contacts | `/api/v1/contacts/...`<br>Contact records: CRUD (a `PATCH` returns the updated contact) plus `POST /api/v1/contacts/bulk`. |
| Conversations | `/api/v1/conversations/...`<br>Mirror external conversations into Inbox as versioned snapshots, read a source's snapshot receipt, peek at a source's delivery queue, claim native replies, acknowledge or fail their delivery, and re-drive a dead-lettered one; exact schemas are in the running instance’s `/docs`. |
| Notifications | `GET /api/v1/notifications/sync`<br>Read-only export of one verified member’s personal or organization feed; Owners and Admins, or a member an Admin granted `tale:notifications.export`. Signed pagination, localized text, stable IDs and content/read-state hashes. |
| Projects | `/api/v1/projects/...`<br>The machine endpoint for external workers: list projects or look one up by external id, create, archive and restore, delete; prepare folders, upload, download and delete files, index a file now, delete folders. |
| Tasks | `/api/v1/projects/{id}/tasks/...`<br>Idempotent task creation from an external ref, state reads, workflow starts (answering the `runId` to poll), comments, and the task’s review — read at `GET .../review`, decided for a member at `POST .../review` — within the named project. |
| MCP | `POST /api/v1/mcp`<br>The [MCP endpoint](/develop/mcp-endpoint) — same key, JSON-RPC instead of REST. |
| Webhook trigger | `POST /api/projects/{id}/automations/webhook/{token}` or `POST /api/automations/webhook/{token}`<br>Start a deployed automation using its token; the [Webhooks page](/develop/webhooks) covers project and non-project URLs. |

### Avoid overwriting a concurrent edit

Use `expectedUpdatedAt` in a contact, product, or document `PATCH` when your change depends on the last row you read. A stale value returns `409 CONTACT_STALE`, `PRODUCT_STALE`, or `DOCUMENT_STALE`. Reload the resource, merge your intended change with the intervening edit, then submit the new precondition.

For Hub documents, `If-Match` offers a representation-level guard: send the strong `ETag` returned by the document’s `GET`. The comparison runs inside the document’s write transaction. A mismatch returns `412 PRECONDITION_FAILED`, includes the current tag in `data.etag`, and writes nothing. A tag list or `*` is accepted; a weak `W/` tag never matches. The tag covers the whole read, including `indexing`, so indexing progress can invalidate it even when the document row’s `updatedAt` has not changed.

A successful contact, product, document, or website `PATCH` returns `200` with the updated resource; a document `PATCH` also carries the new representation's `ETag`, the value the next `If-Match` sends. For contacts, products, documents, and projects, a patch that leaves all stored values unchanged performs no write and preserves `updatedAt`. Preconditions are checked first: a no-op body does not bypass a stale `expectedUpdatedAt` or `If-Match`.

### Edit contacts, products, and website identity

Contacts and products share one editing vocabulary. Strings are trimmed; a contact's `email` is stored lowercase, so duplicates match case-insensitively, and the part before `@` is at most 64 characters. A second contact with the same `email` or `externalId` returns **409**, `CONTACT_DUPLICATE_EMAIL` or `CONTACT_DUPLICATE_EXTERNAL_ID`; a second product with the same `name` — compared without regard to case — or `externalId` returns **409**, `DUPLICATE_PRODUCT_NAME` or `DUPLICATE_PRODUCT_EXTERNAL_ID`, on create and on a `PATCH` that renames onto either.

`null` clears any optional field, and on `PATCH` a blank string reads as `null` — a blank required field (a product's `name`) returns **400**, `INVALID_BODY`; on create and bulk import a blank string — or `null` — reads as the field left out, so a CSV-shaped row or a JSON export imports cleanly (the OpenAPI document declares the optional create fields nullable for that reason). A bulk import carries at least one row — an empty `contacts` array returns **400**, `INVALID_BODY`, never a **201** that created nothing. A contact is filed under at least one of `name`, `email` and `externalId`: a patch that would clear the last one returns **400**, `CONTACT_IDENTITY_REQUIRED`.

Read a contact bulk-import result row by row. `POST /api/v1/contacts/bulk` accepts an object containing only `contacts`, an array of 1–500 rows. It validates rows independently and returns `201` even when some fail:

| Response field | How to use it |
| --- | --- |
| `success`, `failed` | Counts of accepted and rejected rows |
| `created[]` | Each created contact’s `id` and original zero-based `index` |
| `errors[]` | Original `index` and `contact`, human-readable `error`, stable `errorCode`, and field `issues` for schema failures |

A malformed email, unknown row key, or missing identity produces an `INVALID_BODY` row error; duplicate identities have their own codes. Correct only the failed rows before resubmitting. Invalid batch structure, transport limits, or invalid JSON encoding still reject the whole request before row processing.

The contact list’s `source` filter accepts the same closed source enum as writes, including `manual_import`, `api_import`, `shopify`, `hubspot`, `webhook`, and `custom`. Use the full enum in the instance’s OpenAPI schema; an unknown value returns `400 INVALID_QUERY`.

`PATCH` merges `metadata` per RFC 7396 — contacts, products and documents alike: sent keys are set, omitted keys stay, a key sent as `null` is removed, and the whole field sent as `null` clears it — while `address` is replaced whole, an address being a unit. `address` and `metadata` (a document's `metadata` too) are bounded to 64 KiB of JSON, 8 levels of nesting and 500 keys in total; a larger value returns **400**, `INVALID_BODY`, naming the path.

A product’s `currency` is an ISO 4217 code (`USD`, `EUR`), accepted in any case and stored uppercase. Its `imageUrl` must be an absolute HTTP or HTTPS URL with a public host. Relative paths, other schemes, private or loopback IP literals, single-label names, and cloud metadata hosts return `400 INVALID_BODY`. Validation examines the URL without a DNS lookup and does not fetch the image. The operator setting `TALE_ALLOW_PRIVATE_CRAWL_HOSTS=1` allows private-network targets but never metadata hosts.

An image uploaded through the product form is a separate case. The app accepts PNG, JPEG, WebP, GIF, or SVG files up to 5 MiB, checks their bytes, and returns a stable protected URL. REST product reads expose that address as an absolute URL. You may send it back in `imageUrl`, including on a private deployment, if it belongs to this organization and you uploaded it or a current product already uses it. An inaccessible or missing image returns `404 FILE_NOT_FOUND`; an altered managed URL returns `400 INVALID_BODY`. Viewing its bytes requires an authorized app session; the URL is not a public sharing link, and a REST API key does not grant access to this app route. Set `imageUrl` to `null` on PATCH to remove the product’s image. Uploading image bytes uses the app form, not a REST product upload endpoint.

A website's `domain` is immutable: `PATCH /api/v1/websites/{id}` accepts the stored value echoed back (a client may send the resource it read) and returns **400**, `WEBSITE_DOMAIN_IMMUTABLE`, for any other. `POST /api/v1/websites` stores the host as given — `www.` is kept — and the `www.` and apex spellings count as one site: a domain already registered under either spelling returns **409**, `WEBSITE_DUPLICATE_DOMAIN`, with `data.websiteId` and `data.domain` naming the existing row.

The one exception is a URL list posted onto a domain registered as a list under the same spelling, which extends it and returns **200** with the existing id; a list posted onto a whole-site crawl is the same **409** — the crawl keeps its kind and nothing is queued — so read `kind` before you post, or re-post under the spelling the 409 names.

A website’s `status` describes its scan lifecycle. Filter with `GET /api/v1/websites?status=` using `scanning` (a registered site starts here), `active`, `error`, or `deleting`; other values return `400 INVALID_QUERY`, and so does `?scanInterval=` outside its seven values. `active` means a finished scan has stored at least one page, not that every page was refreshed. `error` means the scan failed or no pages remain stored after attempted fetches; inspect `metadata.lastSyncError`.

Each page’s `lastErrorKind` helps distinguish a network or TLS failure (`network_error`, `tls_error`), a refused target (`private_ip`), an HTTP failure (`http_error`), extraction or rendering failures, content that cannot be turned into text (`unsupported_content`), and a `robots_noindex` refusal — the origin answered `X-Robots-Tag: noindex` or the page carries a `<meta name="robots" content="noindex">` tag. A failed refresh can retain previously indexed content, so inspect page failures alongside the site’s status.

`POST /api/v1/websites/{id}/search` performs keyword search over that site’s stored chunks. Its BM25 `score` is unbounded and comparable only within one response. Deployments without ParadeDB use substring matching and report `0` for every hit. For semantic similarity and `minSimilarity`, use `POST /api/v1/knowledge/search` with `corpus: "web"`; that searches the visible web corpus, not one selected site.

### Save and synchronize skill bundles

`PUT /api/v1/skills/{slug}` creates the skill when the slug is free — **201** — and updates it in place otherwise — **200** — so the status is the create-or-update signal, the same convention as materializing a task, and a sync that mirrors bundles from elsewhere needs no read first: `description` and `body` are required, an omitted `icon`, `labels`, `teams`, `visibility` or `disableModelInvocation` keeps its stored value, `null` clears `icon` or `labels`, and `disableModelInvocation: false` drops the flag.

The body is Markdown of at most 507,893 bytes of UTF-8 — bytes, not characters: the composed `SKILL.md`, frontmatter included, is capped at 512 KiB and this budget always fits inside it — and a body that does not end with a newline gets one appended, so a `GET` reads it back one byte longer. The save rewrites `SKILL.md` only — every other file of the bundle stays, and frontmatter keys the body does not carry (`license`, `recommended-packages`, community keys) are preserved; replacing a whole bundle is the app's zip upload.

Every skill names its version: `etag`, the quoted SHA-256 of its `SKILL.md`, and `updatedAt`, when that file was last written — the tag moves with every save of the document and with nothing else.

A save whose composed `SKILL.md` is byte-identical to the stored one writes nothing: it returns **200** with the stored `etag` and `updatedAt` and adds no history entry — the no-op documents and knowledge entries already follow — so a mirror that re-pushes an unchanged bundle leaves `updatedAt` a change signal; the preconditions are still evaluated first, so a stale `If-Match` on an identical body is still **412**.

`GET /api/v1/skills/{slug}` carries the tag as `ETag` and returns **304** to an `If-None-Match` that names it — the weak `W/"…"` and the edge's `"…-gzip"` forms included — with the same `Cache-Control: private, no-cache` as its **200**. `GET /api/v1/skills` also returns `failures` — bundles on disk that could not be read, each with `slug`, `path` and `message`; normally an empty array — so a listing never fails because one bundle is broken.

Guard an update or a delete with `If-Match`: the `etag` you last read — a skill whose document changed since returns **412**, `SKILL_STALE`, with the current tag in `data.etag`, and nothing is written, so reload and merge before saving again (a guarded `PUT` of a skill that is not there is the same **412** with `data.etag: null`, while a guarded `DELETE` of one answers the plain **404**, `SKILL_NOT_FOUND` — already gone is done); a weak tag (`W/"…"`) never matches, and the body is validated before the precondition is evaluated. Send `If-None-Match: *` to create only: a slug that already has a bundle then returns **412**, `SKILL_EXISTS`, and nothing is written.

`GET /api/v1/skills/{slug}/files/{path}` reads any file of the bundle — `SKILL.md` included — as raw bytes named by `Content-Disposition`, with `path` exactly as `files[].path` lists it (`/` raw or `%2F`); the read is validated — the `ETag` is the file's bytes, `Last-Modified` its modification time, and `If-None-Match` or `If-Modified-Since` answers **304** —; a path the list would never carry returns **404**, `SKILL_FILE_NOT_FOUND`, and a bundle the file layer refuses — a planted symlink, a file over the 4 MiB staging cap — **422**, `SKILL_MALFORMED`.

A raw dot-segment in the URL (`../`, or `%2e%2e/` — the dots encoded, the slash not) never reaches the route: the edge refuses it first with its own **404**, `NOT_FOUND`, an `X-Request-Id` of its own and no `X-Tale-Api-Version`; a spelling whose slashes are encoded too (`%2e%2e%2f…`) reaches the route and reads as `SKILL_FILE_NOT_FOUND`. Every skill carries `canEdit` — whether this key may edit the bundle; shipped skills are organization bundles an administrator may overwrite — so check it before a save that means to replace one. Skills support `org` and `team` visibility; `teams` must name teams in this organization.

`private` skill visibility is retired: it cannot be set, and a bundle that already carries it keeps it only when the save omits `visibility`. A slug is at most 64 characters of lowercase letters, digits and single hyphens, and `anthropic` and `claude` are reserved; `PUT` refuses a malformed one with **400**, `INVALID_SKILL_SLUG`, naming the rule it breaks, while `GET` and `DELETE` answer it as absent with **404**, `SKILL_NOT_FOUND`.

### Mirror conversations and deliver replies

Create the contact with `POST /api/v1/contacts` first. A conversation snapshot links `externalContactId` to that contact's `externalId` in the organization. An unknown contact returns **404** `CONTACT_NOT_FOUND`; an ambiguous match returns **409** `CONTACT_AMBIGUOUS`. A snapshot cannot move an existing source conversation to another contact: changing its `externalContactId` returns **409** `CONVERSATION_CONTACT_CONFLICT`.

`POST /api/v1/conversations/sync` compares the integer `version` with the stored snapshot:

| Incoming snapshot | Result |
| --- | --- |
| Newer version | Apply it. |
| Older version | Ignore it. |
| Same version, different content | **409** `CONVERSATION_SNAPSHOT_CONFLICT`. |
| `deleted: true`, version equal to or newer than stored | Close the mirror. Repeating this after closure changes nothing. |

Closing preserves the conversation and messages in the Inbox. This API does not hard-delete them.

`GET /api/v1/conversations/sync` also reports the linked `externalContactId`, the bound row's `contactId`, and `contactStatus`: `active`, `trashed`, or `missing` — and `sourceDeleted` with the Inbox `status`, so an engine that resumes from the receipt knows a teardown landed: a content snapshot onto a torn-down mirror answers **409** `CONVERSATION_CLOSED` at any version (mirror the source conversation under a new `externalId` to start again). The binding keeps the original contact row. Deleting that contact moves it to trash and frees its email and external ID, but recreating those identifiers never transfers the old conversation’s history. A contact re-keyed in the CRM (a `PATCH` of its `externalId`) keeps its conversations: a snapshot naming the current id applies and the receipt follows it, while the id it no longer carries returns **409** `CONVERSATION_CONTACT_CONFLICT` naming the id the conversation is bound to. `GET /api/v1/conversations?source=` lists every conversation you mirrored under a source — `conversationId`, `externalId`, `externalContactId`, `contactId`, `contactStatus`, `version`, `sourceDeleted`, `status`, `subject` — newest first as a keyset page under `conversations` (the same `?cursor=` loop as every list), and `?contactStatus=trashed` finds the mirrors a deleted contact froze.

A newer content snapshot for a trashed contact returns `409 CONVERSATION_CONTACT_TRASHED`. Restore the contact — `POST /api/v1/contacts/{id}/restore`, which applies the create's own rule (a live contact that has since taken its email or `externalId` refuses the restore with the create's **409**), or the app's trash — before sending more content, or close the mirror with `deleted: true` at an equal or newer version; a closed mirror is not reopened by the restore, so a later content snapshot answers the same 409 while the contact stays in the trash. Older snapshots remain ignored, and same-version repeats still follow the version rules above; deleting the contact does not turn every replay into an error.

Claim replies written in the Tale Inbox through `POST /api/v1/conversations/deliveries/claim`. Before including one in a later source snapshot, acknowledge its delivery under its `externalId`, then set `taleMessageId` to the reply's `messageId`. An unacknowledged reply returns **409** `DELIVERY_UNACKNOWLEDGED`. Without `taleMessageId`, a message is treated as originating in the source system, regardless of `isCustomer`.

A claim must name a source you have mirrored. An unknown source returns **404** `CONVERSATION_SOURCE_NOT_FOUND`; one owned only by other service users returns **403** `INTEGRATION_NOT_OWNED`. A source typo therefore produces an error rather than an apparently healthy empty queue.

A claimed delivery includes `attempts`, `leaseExpiresAt`, `lastErrorCode`, and `firstClaimedAt`. Use `GET /api/v1/conversations/deliveries?source=` to inspect the queue without claiming replies. It returns status (`queued`, `leased`, `failed`, `delivered`), attempt counts, and timestamps, but no claim token or message body. Entries are ordered oldest-due first in `{deliveries, isDone, continueCursor}`; pass `?cursor=` for subsequent pages.

Filter with `?status=failed` to find dead-lettered deliveries. `POST /api/v1/conversations/deliveries/{id}/retry` retries one and records the same audit action as **Retry** in the Inbox. A delivery that is not dead-lettered returns **409** `DELIVERY_RETRY_UNAVAILABLE`.

Stage attachments through `POST /api/v1/conversations/uploads` before referencing them in a snapshot. Invalid attachments prevent the snapshot from being applied:

| Problem | Response |
| --- | --- |
| Unstaged, expired, malformed, or cross-organization `storageId` | **400** `ATTACHMENT_NOT_STAGED`. |
| Attachment staged by another service user in the organization | **403** `ATTACHMENT_NOT_OWNED`. |
| Declared `size` differs from the uploaded bytes | **400** `ATTACHMENT_SIZE_MISMATCH`. |

`replyConstraints` limits message length, attachment count, attachment size, and file extensions for replies a person writes in the Inbox. These limits apply when composing a reply, not when accepting a source snapshot.

`GET .../deliveries/{id}/attachments/{index}` returns `DELIVERY_NOT_FOUND` if the claimed delivery does not exist. A missing attachment position, or an index outside the integers 0 through 9, returns `ATTACHMENT_NOT_FOUND`.

There is no staged-upload delete route. Unbound uploads become eligible for cleanup after their two-hour window plus a 24-hour grace period; cleanup runs on a later upload in the organization. Bound attachments follow their message's lifetime. All conversation request bodies are strict: unknown keys, including those inside messages and attachments, return **400** `INVALID_BODY` with the field name.

### Create searchable knowledge and Hub documents

`POST /api/v1/documents` can store text directly as `content`. This inline content remains readable but is not indexed. Knowledge search finds only file-backed documents, so `POST .../retry-indexing` returns `{"status": "skipped", "reason": "content-only"}` for an inline document.

Other skip reasons are `untracked-blob`, `unsupported` (terminal indexing failure; inspect `indexing.errorCode`), and `in-progress` (a fresh indexing job is already queued or running). For `in-progress`, poll the document. Retrying a file that previously opted out of indexing opts it back in and returns `indexing`.

A project file is not this endpoint's — it returns **404**, `DOCUMENT_NOT_FOUND`, like any id outside the Hub — but has the same retry at `POST /api/v1/projects/{id}/files/{documentId}/retry-indexing`, which lifts the bind-time `skipRagIndexing` opt-out (see **Verify what landed** below). Either retry runs through the same guards as the app's **Index now**, a budget of 10 per user per minute included (**429**, `RATE_LIMITED`). Its `fileId` alternative requires the key holder's own unbound Hub upload in the selected organization, created through the app; REST does not mint one.

Use `POST /api/v1/knowledge-entries` to create searchable text. It creates a file-backed Hub document with `sourceProvider: knowledge` and starts indexing. An entry allows at most 8,000 characters, with one active entry per topic. The **201** response `{id, documentId}` already contains the document ID: poll `GET /api/v1/documents/{documentId}` to follow indexing.

A `PATCH` supersedes the active entry and re-indexes under the same `documentId`. If `topic` and `content` are unchanged after trimming, it creates no version and returns the existing entry ID. A `PATCH` of a superseded row returns **409**, `KNOWLEDGE_ENTRY_SUPERSEDED`, naming the topic's active row in `data.activeId` (and its direct successor in `data.supersededBy`) — update that row, no chase down the chain. An entry created or superseded over this door reads `source: "api"` (the app's form writes `manual`, the assistant's capture `chat`), so the Knowledge entries table tells the three apart. Deleting the entry trashes its backing document.

The entry endpoints need the knowledge write grant — a read-only member returns **403**, `KNOWLEDGE_ENTRY_FORBIDDEN` — and an object store that does not accept the content within 30 seconds returns **503**, `KNOWLEDGE_ENTRY_STORE_TIMEOUT`, with nothing written. That document refuses a direct `DELETE /api/v1/documents/{id}`, or a `PATCH` of its title or content, with **409**, `DOCUMENT_HAS_KNOWLEDGE_ENTRY` and `data.entryId` — the entry is the way to change it. `GET /api/v1/knowledge-entries?topic=<topic>&status=superseded` lists one topic's replaced versions, each stamped with `supersededAt`, and `GET /api/v1/knowledge-entries/{id}/versions` returns the whole chain from any of its rows, newest first.

`GET /api/v1/documents` lists Hub documents newest first. Choose the folder scope explicitly when reproducing the app’s folder view:

| `folderId` query parameter | Documents returned |
| --- | --- |
| Omitted | All visible Hub documents, including those inside folders. |
| `root` | Only documents that are not in a folder. |
| A folder ID | Documents directly inside that folder. |

Read a document's bytes at `GET /api/v1/documents/{id}/content` — the same download choreography as a project file (`Content-Disposition`, `Range`, `HEAD`), and a content-only document returns its inline text there too, typed as its `mimeType`; `GET /api/v1/documents/{id}` carries `content` only for a content-only document, `null` for a file-backed one. Every document returns `contentHash` — the SHA-256 the platform computed for its bytes (a knowledge entry's content, a synced file), `null` otherwise — as a field of its own, never a key in your `metadata`.

A document `PATCH` that changes nothing — an empty body, or every field already at its value — writes nothing and leaves `updatedAt` alone, so a no-op retry never invalidates another client's `expectedUpdatedAt`; a controlled record's content, MIME type, extension or source provider is refused with **400**, `DOCUMENT_RECORD_FROZEN` (in review or approved) or `DOCUMENT_RECORD_REPLACEMENT_REQUIRED` (a draft — use the replacement flow), and a `teamIds` entry the key holder is not a member of with **403**, `TEAM_ACCESS_DENIED` (a team that is not the organization's is **400**, `TEAM_NOT_IN_ORG`; a repeated id collapses to one).

Every file-backed document carries `indexing` — `status` is `pending`, `queued`, `running`, `completed`, `failed`, `unsupported` or `skipped`, with `indexedAt`, `error` and `errorCode` when set — so poll the document after a create or a `retry-indexing` instead of sleeping. An upload already attached to any document, thread or conversation cannot be reused here. A missing upload, another user's upload or a bound upload returns **404**, `FILE_NOT_FOUND`. Project, chat and conversation uploads cannot become Hub documents through this route. Trashed or expired documents, including files deleted with their project, stay out of this Hub surface. Files you keep when deleting their project are detached and remain in the Hub.

Branch on `indexing.errorCode`, not the wording of `error`. The OpenAPI schema enumerates the closed set:

| Status and codes | Recovery |
| --- | --- |
| `unsupported`: `unsupported_type`, `image_no_vision`, `empty`, `not_text`, `malformed` | Replace or re-export the source in a supported format. For `not_text`, export actual UTF-8 text. `malformed` currently identifies an unreadable PDF; corrupt Office files can instead report `indexer_error`. The retry route skips terminal codes, including older rows still marked `failed`. |
| `failed`: `embedding_upstream`, `indexer_error`, `index_rebuilding` | The background job retries these failures. Poll before requesting another attempt. |
| `failed`: `embedding_not_configured`, `embedding_provider_refused`, `index_repair_failed` | Ask the operator to correct provider configuration, permissions, or index health, then retry. |
| `failed`: `secret_detected`, `pii_blocked` | Correct the source or the organization’s approved content policy before retrying. |

`POST` and `PATCH` bodies are strict: `projectId` is refused with **400**. Create project files through the project upload and file routes below.

## Mirror a member’s notifications

`GET /api/v1/notifications/sync`, added in API contract 1.8.0, exports the notifications a particular member can see. Use it for a one-way mirror in another application. The caller’s API key must belong to an Owner or Admin of the selected organization, or to a member an Admin granted the `tale:notifications.export` capability (API contract 1.14.0). Any other role alone, Developer included, is insufficient.

### Delegate the export without an Admin role

A mirror worker does not need an Admin account. The Admin role also manages members, administers single sign-on and SCIM, and can reset lower-ranked members’ passwords, so run the worker as an ordinary member and grant that member the one capability the export checks. The grant is an entry in the organization’s competence register: it applies only in that organization, is audited, can carry an expiry, and is revoked automatically when an Admin removes the member or SCIM deprovisions them.

An Owner or Admin grants it from an active session. `TALE_ORIGIN` is your Tale origin and `TALE_SESSION_COOKIE` that session’s cookie header; `TALE_ORG_ID` and `TALE_WORKER_USER_ID` are the `organization.id` and `user.id` that `GET /api/v1/me` returns for the worker’s key:

```bash
GRANT_BODY=$(jq -n --arg user "$TALE_WORKER_USER_ID" \
  '{userId:$user,competence:"tale:notifications.export",evidence:"Notification mirror worker"}')
curl -sS --compressed -X POST "$TALE_ORIGIN/api/app/governance/competences?orgId=$TALE_ORG_ID" \
  -H "Cookie: $TALE_SESSION_COOKIE" \
  -H "Origin: $TALE_ORIGIN" \
  -H "Content-Type: application/json" \
  -d "$GRANT_BODY"
```

The response is **201** with `{ "recordId": "…" }`. Add `expiresAt` in epoch milliseconds to end the grant on its own; without it, the grant does not expire. While a grant is live, granting it again returns **409** `COMPETENCE_ALREADY_GRANTED`. Any other name under `tale:` returns **400** `COMPETENCE_CAPABILITY_UNKNOWN`, a user outside the organization **400** `COMPETENCE_USER_NOT_MEMBER`, and a session without the Owner or Admin role **403** `COMPETENCE_FORBIDDEN`. Before the first page, confirm with the worker’s key that `GET /api/v1/me` reports `capabilities.notificationExport: true`.

To withdraw the right, find the grant’s `id` in `GET /api/app/governance/competences?orgId=<orgId>&userId=<userId>` with the same session, then send `POST /api/app/governance/competences/<recordId>/revoke?orgId=<orgId>`. The worker’s next export request returns `403 ROLE_FORBIDDEN`. A revoked grant stays in the list as the audit trail; grant the capability again to restore the export.

### Select the recipient and stream

Set `TALE_RECIPIENT_EMAIL` to the intended member’s verified email address. The recipient must have exactly one matching, active membership in the selected organization. The endpoint checks membership and verification again on every page. Organization notifications use the recipient’s role for visibility: an administrator caller cannot export security notifications to a recipient who could not see them in Tale.

| Query parameter | Rule |
| --- | --- |
| `recipientEmail` | Required valid email, at most 320 characters; matching ignores case. |
| `stream` | Required: `personal` for the member’s personal feed, or `organization` for organization notifications visible to them. Read both separately for a complete mirror. |
| `locale` | Optional `en`, `de` or `fr`. Defaults to the organization’s language, with English message fallback. |
| `limit` | Default 100, maximum 100, minimum 1. Whole numbers outside the range are clamped. |
| `cursor` | Omit on the first request; pass the preceding `continueCursor` unchanged for the next page. There is no numeric `offset` parameter. |

```bash
curl --fail-with-body --silent --show-error --compressed --get \
  "$TALE_URL/api/v1/notifications/sync" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --data-urlencode "recipientEmail=$TALE_RECIPIENT_EMAIL" \
  --data-urlencode 'stream=personal' \
  --data-urlencode 'locale=en' \
  --data-urlencode 'limit=100'
```

A successful request returns `200` with `{recipientId, page, isDone, continueCursor}`. Missing, disabled, unverified or ambiguous recipients return `recipientId: null`, an empty `page`, `isDone: true` and an empty cursor. This is not an invitation or account-creation operation.

### Read rows and complete a scan

| Row field | Meaning |
| --- | --- |
| `id` | Stable source ID in the form `<organizationId>:<stream>:<notificationId>`. Use it for matching and upserts within that recipient’s mirror. Organization notification IDs can be shared by recipients; keep their mirrors separate. |
| `version` | A 64-character hexadecimal SHA-256 hash of the exported row before the hash is added. Content or read-state changes change it; localized title/body changes can also change it. This is a change marker, not an incrementing sequence. |
| `title`, `body` | Text rendered from Tale’s notification catalogs and parameters, limited to 500 and 8,000 UTF-16 code units respectively. Keep the chosen locale stable across scans. |
| `path` | The same organization-scoped `/dashboard/...` destination used by the notification bell, including encoded identifiers and query parameters. Resolve it against the Tale browser origin, not an internal API transport URL. The user still needs access and any required private network connection. |
| `createdAt` | Creation time in epoch milliseconds. |
| `read` | Whether the intended recipient has read the notification in Tale. |

Personal pages are ordered by descending notification sequence; organization pages by descending creation time and ID. Both expose signed keyset cursors. A cursor is scoped to the organization, recipient and stream; never reuse it for another recipient or swap streams with it.

To keep the mirror consistent:

1. Start each stream without a cursor and upsert rows by `id`, comparing `version` for changes.
2. While `isDone` is `false`, send the returned cursor. At `true`, stop; do not send the empty final cursor.
3. Finish both streams successfully before retracting destination rows absent from this scan. If any page fails, preserve the previous mirror and recover the failed scan.
4. Begin later scans from the first page to notice read-state or text changes in older notifications. A cursor is a pagination position, not a change-feed checkpoint.

Reading the export never marks a Tale notification read and never deletes it. The endpoint provides no acknowledgement or write-back operation. Changing the destination’s read state does not change Tale’s.

### Recover an export request

| Response | Action |
| --- | --- |
| `401 UNAUTHORIZED` | Replace the missing, invalid or expired API key. |
| `403 ROLE_FORBIDDEN` | Use an Owner or Admin key in the selected organization, or have an Admin grant the key’s user `tale:notifications.export`; `capabilities.notificationExport` in `GET /api/v1/me` confirms it. An expired or revoked grant no longer permits the export. Recipient membership does not grant the caller export permission. |
| `400 INVALID_QUERY` | Correct missing or invalid recipient/stream/locale fields, unknown or repeated parameters, or blank cursor/limit. Inspect `data.issues`. |
| `400 INVALID_LIMIT` | Supply an integer limit. |
| `400 INVALID_CURSOR` | Restart the affected stream without a cursor. A removed or changed recipient can invalidate a cursor because membership is checked again. |
| `200`, `recipientId: null` | Check the recipient’s current membership and verified email. An empty completed page is not proof that an account exists. |
| `429 RATE_LIMITED` | Respect `Retry-After` and the [shared API budget](/develop/rate-limits); retain the previous mirror while waiting. |

The normal organization-selection errors also apply. Never replace a failed export with an empty successful result in the destination.

## Manage a project's agents

Every agent belongs to a project. The project ID is required in the URL for every operation; responses include both `projectId` and the agent's `id`. These are the same agents managed in the project's **Agents** tab, with the same access rules.

| Operation               | Route                                           | Success        |
| ----------------------- | ----------------------------------------------- | -------------- |
| List the roster         | `GET /api/v1/projects/{id}/agents`              | `200 {agents}` |
| Create                  | `POST /api/v1/projects/{id}/agents`             | `201 {agent}`  |
| Read                    | `GET /api/v1/projects/{id}/agents/{agentId}`    | `200 {agent}`  |
| Save full configuration | `PUT /api/v1/projects/{id}/agents/{agentId}`    | `200 {agent}`  |
| Delete                  | `DELETE /api/v1/projects/{id}/agents/{agentId}` | `204`          |

Choose an existing project, a harness `GET /api/v1/models` lists under `harnesses` — the ones the platform runs with its own credentials — and a model available to it. This example creates a Claude Code agent and reads back its configuration; it does not start a task.

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

### Save a full agent configuration

`POST` and `PUT` require `name`, `harness`, `model`, `skills` and `connectors`; a `harness` outside the eligible set returns **400**, `PROJECT_AGENT_HARNESS_INVALID`, with the set in `data.harnesses`. Optional fields are `modelProvider`, `tools`, `secrets` and `instructions`. A `PUT` saves the full configuration: omitted provider/instructions reset to `null`, and omitted tools/secrets reset to empty lists. It updates an existing agent; it does not create one at an unknown ID. Pass the `updatedAt` you last read as `expectedUpdatedAt` to make the save conditional: an agent that changed since returns **409**, `PROJECT_AGENT_STALE`, with the current `updatedAt` in `data`, and nothing is written — reload it and merge before saving again.

### Validate models, grants, and limits

A project holds at most 50 agents. Names are unique within the project without regard to case, up to 120 characters; each equipment list allows 25 entries and instructions allow 20,000 characters. An invalid configuration or an exceeded limit returns **400**; a name another agent of the project already carries returns **409**, `PROJECT_AGENT_NAME_TAKEN` — the class every other duplicate on this endpoint returns, so reuse the existing agent rather than retrying.

`model` must be a model the organization's catalog lists (name `modelProvider` when several providers serve it) and `tools` must name known tool grants — a wrong value returns **400** with `PROJECT_AGENT_MODEL_INVALID`, `PROJECT_AGENT_PROVIDER_UNKNOWN` or `PROJECT_AGENT_TOOL_UNKNOWN` naming what to fix, instead of an agent that fails at its first task. `secrets` contains organization secret names, never values; a name the organization has not stored is refused with **400**, `PROJECT_AGENT_SECRET_UNKNOWN`, naming it in `data.secrets` (the app's dialog prunes such names; the API does not, so a typo never yields an agent that runs without its credential).

Only organization Owners and Admins may change secret grants, so an editor's full save must preserve existing grants.

Project readers can read the roster; writes require project edit access and an active project. An invisible or missing project, or an agent ID from another project, returns **404**. A multi-organization key must include `X-Organization-Slug` on reads and writes. [Project agents](/platform/projects/project-agents) explains how these agents work on tasks; direct chat keeps using the built-in assistant.

## Automation names in URLs

An automation's name is a `/`-separated path — `billing/dunning` — and a path cannot travel inside one URL segment. In every `.../automations/{name}/...` URL, write the name with `__` in place of each `/`:

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/automations/billing__dunning/versions" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG"
```

Responses always carry the real name (`"name": "billing/dunning"`); the `__` form exists only in URLs. Skill slugs are flat and need no encoding. Project agents use their project ID and agent ID.

### Read the version that will run

`GET /api/v1/automations` lists each automation with its `latestVersion`, `deployedVersion` and `projectIds` — the projects it is installed in, which the run routes below require — plus what a launcher needs without a second call: its `description`, the `inputs` schema a run must match (the deployed version's, else the newest saved one's) and its `trigger` — kind, switch and health: `lastFiredAt`, `lastSkippedAt` and `lastSkipReason`, the same stamps `GET .../triggers` reads, so one listing call finds every binding that is enabled and not firing — or `null` when none is bound.

`GET /api/v1/automations/{name}` returns the newest saved version by default (`?version=latest` spells the default out), which may be a draft; a live run executes the deployed one, so read the contract of the code that actually runs with `?version=deployed` (a number names any saved version). A version the automation does not have returns **404** `AUTOMATION_VERSION_UNKNOWN` — `?version=deployed` while nothing is deployed too — where an unknown automation returns `AUTOMATION_NOT_FOUND`.

`GET /api/v1/automations/{name}/versions` names the `deployedVersion` and marks each row `deployed`, and each row carries the version's test verdict: `testsPassed` is `null` until the tests were run (a document without tests stays `null`), else `true` or `false` for the last run — the save's, when the MCP `save_automation` saves a document with tests, or the deploy gate's, which persists a refusal — with `testsCheckedAt` saying when — `null` beside a verdict recorded before 0.5.24 kept the time, so branch on `testsPassed` for the verdict and on `testsCheckedAt` for its freshness only; the latest verdict wins.

`DELETE /api/v1/automations/{name}` removes the automation, its versions, triggers and project bindings included — its runs stay: they remain listed by `GET /api/v1/runs`, readable by id, and still answered by name at `GET /api/v1/automations/{name}/runs` (and its project twin) under the name they ran as, which `GET /api/v1/automations/{name}`, its versions and its triggers then return **404** for — and returns **409** `AUTOMATION_HAS_ACTIVE_RUNS` while a run is in flight; it needs the developer capability. Creating, saving and deploying an automation is not on this surface: that is the [MCP endpoint](/develop/mcp-endpoint)'s `save_automation` and `deploy_automation`, the app's canvas, or a `tale deploy` configuration release — REST lists, reads, runs, installs and wires triggers for automations built there.

## Triggers

A trigger starts an automation without a call from you: on a schedule, from a webhook URL, or when the platform raises an event. Bind one with `PUT /api/v1/automations/{name}/triggers` — one trigger per automation, and the `PUT` replaces whatever was bound:

```bash
curl -sS --compressed -X PUT "https://your-host.example.com/api/v1/automations/billing__dunning/triggers" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "kind": "event", "event": "contact.created" }'
# → 200 { "name": "billing/dunning", "deployed": true }
```

### Choose the trigger kind

`kind` is `schedule` (with a five-field `cron` and an optional IANA `timezone`), `webhook` (the response carries the URL's `token` once — the [Webhooks page](/develop/webhooks) covers that endpoint) or `event`. A trigger that could never fire is refused with **400** `AUTOMATION_TRIGGER_INVALID` and a sentence naming the fix: a cron that matches nothing (including a day no named month has, `0 0 30 2 *`), a time zone that is not an IANA zone, an event the platform does not raise.

Each kind takes its own keys — `cron` and `timezone` only with `schedule`, `event` only with `event`, `rotateToken` only with `webhook` — and a key that belongs to another kind is refused as an unknown key (**400** `INVALID_BODY`, naming it under `data.issues`), so a webhook trigger can never read back as one that also runs on a schedule. An event trigger binds one of the events the platform raises today, and the run's input is `{ "trigger": "event", "event": "<name>", "payload": <the event's data> }`:

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

### Check trigger health and pause safely

`GET .../triggers` reads the binding back — as `triggers`, a list of at most one, the one plural in the family — with its health: `lastFiredAt` is the last time this binding **started a run** — `lastRunId` names it, and both stay `null` until it has — while `lastSkippedAt` and `lastSkipReason` record the last time it came due and started nothing: `not_deployed` (nothing is deployed — deploy a version), `unusable_cron` (the expression or zone could not be read; the scheduler leaves the binding alone until it is edited) or `start_refused` (the deployed version's `inputs` schema refused the run's input). A webhook delivery the deployed `inputs` schema refuses is a different case: it is answered **400** `AUTOMATION_INPUT_INVALID` to the sender and starts nothing, and it moves none of these stamps — the binding did not come due, so a webhook whose every delivery is refused reads the same as one that has never been called. Verify deliveries from the sender's side.

A binding is alive when `lastFiredAt` keeps pace with its cadence; one whose `lastSkippedAt` is the newer stamp is coming due and not running, and the reason says what to fix. A rebind to another kind starts every stamp afresh. `enabled: false` pauses a trigger without losing it; `DELETE .../triggers` removes it — and, for a webhook, revokes the URL. So does binding another kind over a live webhook: the `PUT` still returns **200**, with `"revoked": "webhook"` beside the name, and the old URL is gone for good — a later webhook bind mints a different token.

The `PUT` also returns `deployed`: binding before deploying is accepted, and a trigger bound to an automation with no deployed version starts nothing — every occurrence is skipped as `not_deployed`, which the row's `trigger` on `GET /api/v1/automations` shows — until a version is deployed.

## Start a run, then poll it

A run is durable and may take minutes, so starting one returns **202** with the run's identity, not its result:

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "input": { "customerId": "cus_123" } }'
# → 202 { "runId": "...", "version": 2, "name": "billing/dunning", "mode": "live" }
```

### Interpret running and waiting states

Poll `GET /api/v1/projects/{id}/runs/{runId}?fields=status,finishedAt` until `status` leaves `queued`/`running`/`waiting` — naming the keys keeps the poll to a line instead of the whole run, and sending the answer's `ETag` back as `If-None-Match` turns an unchanged poll into a bodiless **304** ([caching](#caching-compression-and-partial-reads)); then read the run in full: it carries `output`, the per-node `trace`, and the `effects` it produced.

`waiting` covers two families and only one needs you: while a run is parked, `waitingFor` says on what — `approval` (a person's decision on a gate) and `ask` (a question a person has to answer) need a human; `agent` (an agent turn still running) and `repeat` (a node polling until its `repeatUntil` condition holds) do not, and a run can sit in either for minutes while healthy. "Runs that need a person" is `waitingFor` in (`approval`, `ask`) — never `status=waiting` alone, which fills with polling runs. `detail` names the park (`approval:<approvalId>`, `agent:<nodeId>`, `repeat:<nodeId>`) and, once failed, the failure sentence.

Failed runs expose a stable `failureCode` alongside the human-readable `detail`. Non-failed runs return `null`; older failed records can also have no code. Run summaries omit an unset code.

| Failure family | Examples and next action |
| --- | --- |
| Automation engine | `node_error`, `connector_error`, `llm_output_invalid`, `approval_rejected`, `execution_limit`, `automation_deleted`: inspect the failed node and its trace. Correct the input or definition; if a person rejected an operation, address their reason before requesting another run. |
| Model provider | Codes such as `credit_exhausted` or `rate_limited`: resolve the provider condition before another attempt. |
| Agent execution | Codes such as `harness_error`, `session_gone`, `deadline`, or `budget_exceeded`: inspect the agent’s detail and limits. The complete enum is in OpenAPI. |

A failure code identifies the cause; it does not make a whole-run retry safe. Earlier nodes may already have changed external systems. `startedAt` records when the start was accepted, before a worker claims it. There is no separate pickup timestamp, so `finishedAt - startedAt` includes queueing and other waits.

`POST /api/v1/projects/{id}/runs/{runId}/cancel` stops a run at its next node boundary; completed work is not undone. The response includes `cancelled` and the resulting `status`. A successful cancellation returns `cancelled: true`, `status: "cancelled"`, and clears the run’s `detail`. If the run already finished, `cancelled: false` accompanies its terminal status (`success`, `failed`, or `cancelled`).

### Retry a start without creating another run

A start is safe to retry when you name it: send `Idempotency-Key: <your key>` and a repeat within 24 hours — a retried timeout, a lost response — returns **202** with the run the first attempt started and `"duplicate": true`, so no second run exists; the same key with a different body returns **409** `IDEMPOTENCY_KEY_REUSED`. The key is scoped to the automation and the URL project, and a refused start remembers nothing, so the same key runs once the refusal is fixed.

An optional `Idempotency-Key` must contain 1–255 printable ASCII characters after surrounding whitespace is removed. A header that is present but blank, too long, or contains other characters returns `400 INVALID_HEADER` with the header named in `data.issues`; nothing starts. Reuse the same trimmed value and body for a retry. Omit the header only when you do not want replay protection.

### Choose live or mock execution

`mode` defaults to `live`; arbitrary live runs and run cancellation require `capabilities.developer` from `/me`. Project runs also require edit access to an active project, including `mode: "mock"`. Mock runs use deterministic mocks; a non-project mock run needs only membership. Starting a run needs no trigger. An automation with no deployed version returns **409** unless a saved version is explicitly selected for a mock run.

An unknown automation returns **404**. A live run can only use the deployed `version`; naming another saved version returns **409**. Use `mode: "mock"` to test another saved version. A missing body means `{}`, but malformed JSON returns **400** and starts nothing. When the automation declares an `inputs` schema, the input must match it before a run is created: a mismatch returns **400** `AUTOMATION_INPUT_INVALID` with every problem under `data.issues` (`path`, `message`), the way a refused body does. `input` defaults to `{}` only when it is absent — `null` is sent as null, for the schema to judge.

### Select scope and browse run history

The project in the URL is the context for the run's task and document tools. An automation with project bindings can run only in a bound project; one with no bindings runs in any project the caller can edit — installing it (`POST /api/v1/projects/{id}/automations/{name}`) lists it under that project and scopes it, it is not a gate a never-bound automation has to pass. `GET /api/v1/projects/{id}/automations/{name}/runs` lists that project's history for one automation, `GET /api/v1/projects/{id}/runs` for every automation.

Listings answer summaries — identity, scope, status and timing, each row naming the run as `id` and, under the name the start answered, `runId`, one value under both names — newest first as `{ "runs": [...], "isDone": ..., "continueCursor": ... }`: add `?status=failed` (one or more statuses, comma-separated) to narrow them, `?include=input,output` (also `trace`, `effects`, `checkpoints`) to inline the full-row fields a summary leaves out — an inlining page reads at most 25 rows, is bounded at 8 MiB of them, and ends early, `isDone: false`, when the next row would not fit — and pass `continueCursor` back as `?cursor=` until `isDone`.

`GET /api/v1/runs` is the cross-cutting view: every run the key holder can see, organization runs and the runs of visible projects alike, each row naming its `projectId`. For an automation with no bindings, `POST /api/v1/automations/{name}/runs` starts a non-project run; a bound automation returns **409** there. `GET /api/v1/automations/{name}/runs` and `/api/v1/runs/{runId}` expose only non-project runs. A project run requires its project URL for reading, cancellation and deletion. `DELETE /api/v1/projects/{id}/runs/{runId}` (or `/api/v1/runs/{runId}`) removes a finished run — stored input and output included — under the developer capability; a run still in flight returns **409** `RUN_ACTIVE`, so cancel it first.

## Act for a member: answer a run’s question, decide a task’s review

A run parked on `waitingFor: "ask"` and a task parked in `in_review` both wait on a person. When that person works in another application — an office portal that mirrors the desk, say — the machine caller relays their gesture and names them as the `actor`, so Tale records the person and not the key. Both doors need API contract 1.16.0.

### Answer the question a run is waiting on

`GET /api/v1/projects/{id}/runs/{runId}/ask` answers the live question as `PendingAsk` — the sentence, an optional structured `questions` set, the node that asked and the `expiresAt` deadline — or `ask: null` when nothing waits on a person. Reading it takes the same access as reading the run.

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects/<projectId>/runs/<runId>/ask" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "ask": { "askId": "...", "question": "...", "expiresAt": 1758210000000, "taskId": "..." } }
```

Send the answer to `POST /api/v1/projects/{id}/runs/{runId}/asks/{askId}`. Tale records it, resumes the run in the same transaction, and puts the answer on the task timeline as the answerer’s own comment. For a `questions` set, send one line per question the way the app does: `<question> → <picked label>; <typed text> (in their own words)`.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/runs/<runId>/asks/<askId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "answer": "Book it in February.", "actor": { "email": "reviewer@example.com" } }'
# → 200 { "ok": true, "askId": "...", "runId": "...", "answeredBy": "<userId>", "actorUserId": "<userId>", "taskId": "..." }
```

A project run needs write access to an active project; an organization run needs membership. Without `actor`, the key answers as itself and `answeredBy` reads `api-key:<userId>`. A question that was already answered or closed returns **409** `HUMAN_ASK_NOT_PENDING`, one past its deadline **409** `HUMAN_ASK_EXPIRED` — the run then fails with `failureCode: "ask_expired"` — and a question this run did not ask **404** `HUMAN_ASK_NOT_FOUND`. A blank answer returns **400** `EMPTY_ANSWER`.

### Decide a task’s review

`GET /api/v1/projects/{id}/tasks/{taskId}/review` answers the task’s status and its pending `TaskReview`, or `review: null`. `POST` on the same path decides it — here `actor` is required, because a review is always a person’s decision:

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/review" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "decision": "approve", "actor": { "email": "reviewer@example.com", "userId": "<userId>" } }'
# → 200 { "task": { "id": "...", "status": "done" }, "decision": "approve", "approvalId": "...", "actorUserId": "<userId>" }
```

`approve` is the board’s move to Done: the member’s own project access and the organization’s `review_policy` apply exactly as there (**403** `REVIEW_INDEPENDENT_REVIEWER_REQUIRED` or `REVIEW_COMPETENCE_REQUIRED` when the policy refuses them), the review is recorded as approved by the member, and the task becomes `done`; a task with open subtasks returns **409** `TASK_HAS_OPEN_SUBTASKS`. `request_changes` needs `comment` and `workflowSlug`: it withdraws the review, puts the comment on the timeline and starts the workflow again on the task, which reads the comment as feedback; the answer carries the `runId` to poll, with `started: false` when a live run was reused. A task that is not in review returns **409** `TASK_NOT_IN_REVIEW`. Every decision is audited as `task.review_relayed`, naming the member and the key that relayed for them.

### Name the member the gesture is for

`actor.email` names the member by e-mail. Tale resolves it against the organization with the same rule as the notification export: exactly one active membership whose address is verified. No such member returns **404** `ACTOR_NOT_FOUND`, two **409** `ACTOR_AMBIGUOUS`, an unverified address **403** `ACTOR_UNVERIFIED`, a disabled membership **403** `ACTOR_DISABLED`. Every answer returns the resolved `actorUserId`; pin it as `actor.userId` on later calls, and an address that has since moved to another account returns **409** `ACTOR_REBOUND` instead of acting as its new holder. A member who may not see the project — or, on the review door, not write its task — returns **403** `ACTOR_FORBIDDEN`; the key holder's own access is checked first, so this code always speaks of the actor.

Naming an actor is a right of its own. An Owner or Admin key has it by role; any other key holder needs the `tale:rest.act-as` capability, granted and revoked exactly like the export capability in [Delegate the export without an Admin role](#delegate-the-export-without-an-admin-role), with `"competence":"tale:rest.act-as"` in the grant body. `GET /api/v1/me` answers it as `capabilities.actAs`; an `actor` sent without it returns **403** `ROLE_FORBIDDEN` before any member is looked up. The member’s own permissions still decide what the relayed gesture may do.

## Send a message, then poll the turn

Project chat follows the same 202-then-poll shape. Use a project you can read, create a thread, post a message, poll the generation, then read the messages:

### Choose a callable model

List models before sending a message. Each entry carries what a client needs to choose — `contextWindow`, `maxOutputTokens`, `capabilities` (`tools`, `vision`, `reasoning`), `pricing` when the catalog publishes one, `tags` — and `default: true` marks the organization’s pick for this key holder; it appears only when the organization pins a default model, so do not wait for it. Use an entry’s `id` as `model`; add its `providerSlug` when the same id is listed under more than one provider.

`maxOutputTokens` is omitted when the catalog declares no ceiling; the send route then has no catalog ceiling to enforce. Do not require this field when reading the model list.

The list respects the organization’s model-access policy and includes only models callable directly through REST; an empty list means no chat model is available to this key holder.

`capabilities` and `tags` describe the model, not what this surface can send it: the REST send is text only (`content`), so a `vision` model reads an image here only when the thread was continued from the app with an image attachment — a data URI pasted into `content` reaches the model as text and is answered as text, and nothing on the wire marks it; image input over REST is not offered in this version.

The list is the organization’s configured catalog, not a promise from the provider’s account: an operator excludes a model the provider’s plan does not cover through the credential’s model allowlist in Settings. The pair is checked on send, at the endpoint: an id the list does not carry returns **400**, `CHAT_MODEL_UNKNOWN`; an id several providers serve, with none named, **400**, `CHAT_MODEL_AMBIGUOUS` with the candidates in `data.providers`; a `providerSlug` the list does not carry **400**, `CHAT_PROVIDER_UNKNOWN`, and one that does not serve the chosen `model` **400**, `CHAT_MODEL_NOT_ON_PROVIDER`.

The 202 names the provider the turn runs on, and the turn never falls back to another provider behind your back.

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
# → 200 { "status": "queued", "messageId": "..." } … then { "status": "streaming", "messageId": "...", "text": "The quarter…", "textOffset": 0, "textLength": 12, "reasoning": "", "reasoningOffset": 0, "reasoningLength": 0, "cancelRequested": false, "updatedAt": 1774... } … then { "status": "idle", "lastMessageId": "<assistantMessageId>", "lastStatus": "complete" }

# 4. Read the reply by the id the 202 named
curl -sS "https://your-host.example.com/api/v1/projects/<projectId>/threads/<threadId>/messages/<assistantMessageId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "id": "<assistantMessageId>", "role": "assistant", "status": "complete", "finishReason": "stop", "parts": [ … ], "usage": { … }, … }
```

### Poll your accepted message

Keep the `messageId` returned by the send's `202`: this is the assistant message that will contain your result. Poll generation every two to five seconds and inspect its state:

Accepted chat messages share one oldest-first queue across the deployment’s organizations and keys. The background worker processes batches of up to `WORKER_CONCURRENCY` turns (default 5), and the next batch waits for the current batch to settle. Acceptance is not immediate execution; a quiet thread can wait behind work from other clients. The API does not expose queue position or an estimated start time.

| Generation state | Meaning and next action |
| --- | --- |
| `queued` | Accepted and waiting for a worker; keep polling. Until a worker opens the turn this poll is its only view: `GET .../messages` does not list the turn yet (the page reads complete without it) and `.../messages/{messageId}` can answer **404** for the id the send named |
| `streaming` | The provider is producing output; `text` and `reasoning` contain the current partial result |
| `idle`, matching `lastMessageId` | Your turn has settled; `lastStatus` describes its outcome |
| `idle`, different `lastMessageId` | The summary refers to another message; read your saved message ID directly before drawing a conclusion |

Read the result at `GET /api/v1/projects/{id}/threads/{threadId}/messages/{messageId}`. To browse the transcript newest first, use `GET .../messages?order=desc`; a cursor stays bound to the direction in which it was issued. A later turn can change the latest-message summary, so a different ID is not evidence that your earlier turn never ran.

Set a timeout for each poll request and a separate overall deadline for your client; 30 seconds per ordinary poll is a reasonable starting point. The server has no fixed total turn deadline. It abandons a provider request after 180 seconds without activity, and each received byte, including reasoning output, resets that timer. High reasoning effort can therefore keep a turn active before any answer text appears. If you no longer need the turn, call `DELETE .../generation` rather than merely stopping your polling loop.

For incremental updates, send the previous `textLength` as `since` and `reasoningLength` as `reasoningSince`. The unit is UTF-16 code units — JavaScript `String.length`, an emoji counting two; not code points — so echo the lengths the poll answered rather than counting characters yourself. The response's `textOffset` and `reasoningOffset` locate the returned slices: the value you sent, one lower when that would have split a surrogate pair (the slice then re-sends the whole character), or 0 when a completed tool round reset that stream. Reassemble by one rule, `held = held.slice(0, textOffset) + text`, and none of the three cases needs its own handling.

If the send response was lost, read `.../generation` before sending again. `queued` or `streaming` identifies the active turn. When idle, inspect the latest assistant message or find your newest user message by its `content`; without a saved message ID, do not assume an unrelated latest result belongs to the lost request.

### Retry a send safely

A send is safe to retry when you name it: send `Idempotency-Key: <your key>` and a repeat within 24 hours — a retried timeout, a lost 202 — returns **202** with what the first attempt answered, the same `messageId` included, and `"duplicate": true`, so no second turn runs or bills; the same key with a different body returns **409**, `IDEMPOTENCY_KEY_REUSED`. The key is scoped to the thread and the URL project, and a refused send (a thread still mid-turn) remembers nothing, so the same key sends once the poll says idle.

An optional `Idempotency-Key` must contain 1–255 printable ASCII characters after surrounding whitespace is removed. A header that is present but blank, too long, or contains other characters returns `400 INVALID_HEADER` with the header named in `data.issues`; nothing starts. Reuse the same trimmed value and body for a retry. Omit the header only when you do not want replay protection.

### Understand assistant behavior and token limits

A turn is the complete handling of one accepted message, including model rounds and tool calls. REST chat uses the built-in workspace assistant with its instructions, safety rules, and three retrieval tools. These add roughly 3,000 prompt tokens per model round, included in `usage.inputTokens`. A tool-using turn can take up to five rounds, each billing its full prompt. Requests for deliverables such as documents or reports are directed to Tasks.

Project threads can retrieve that project's files and the organization's knowledge hub, but not another project's files. Threads without a project can retrieve the hub only. The assistant chooses whether to search based on the question; naming a file or explicitly asking it to search helps express your intent, but no request field forces a retrieval call.

| Field | Behavior |
| --- | --- |
| `reasoningEffort` | `low`, `medium`, `high`, `extra`, or `max`; ignored when the model lacks `capabilities.reasoning` |
| `maxOutputTokens` | Budget for the whole turn across model rounds; must not exceed the model's declared ceiling from `/models` |

An excessive output budget receives `400 INVALID_BODY` naming the ceiling. Each round receives only the remaining budget; a round with no budget left does not start. Reasoning tokens count toward this budget and `usage.outputTokens`, and are billed at the output-token price. They can consume the entire allowance, leaving a billed `complete` response with no answer text and `finishReason: "length"`. Increase the output allowance or lower reasoning effort when your task needs room for a visible answer.

Thinking-budget providers using Anthropic-style extended thinking have one exception: a budget below 2,048 is raised to 2,048, allowing at least 1,024 for thinking and as much for the answer. Effort-based reasoning models, including the GLM and DeepSeek families, have no such floor.

Read `finishReason`, not just `status: "complete"` or the token count. The values are `stop`, `length`, `tool-calls`, `content-filter`, `cancelled`, and `other`; it is absent when the provider supplies none. When a round ends at the length cap, every tool call from that round is withheld, even if one call’s arguments are complete. Each withheld `tool-result` has `status: "invalid_args"`; its message distinguishes complete from truncated arguments. Final text can still look complete, so inspect the stopping reason and tool results.

An empty answer, or cancellation before any text, has no text part. `parts` can be empty or contain only reasoning and tool parts. Check for actual text before showing or exporting an answer.

Threads, messages, and generation status are visible only to their owning key holder. Sharing project membership does not reveal another user's chats. Use `GET /api/v1/projects/{id}/threads` to list yours and `GET /api/v1/projects/{id}/threads/{threadId}` to read one.

### Read language, status, usage, and message parts

`content` is trimmed; a blank prompt — nothing but whitespace and invisible format characters such as zero-width spaces — receives `400` without starting a turn (markdown that renders as nothing, an empty code fence say, is still a prompt). Optional `locale` is a BCP 47 language tag such as `de` or `en-GB`. It asks the assistant to answer in that language through system and message instructions. Organization-mandated instructions take precedence. Without it, the assistant uses the prompt's language.

Language is an instruction to the model, not a validated output guarantee. A model can answer in another language, especially with a short prompt and reasoning enabled; the response has no language-mismatch flag. If a specific language is required, inspect the answer before accepting it.

| Message status | Meaning |
| --- | --- |
| `pending` | Assistant row exists with empty `parts` while the turn runs; generation names its `messageId` |
| `complete` | Turn finished; inspect `finishReason` for truncation or other stopping conditions |
| `cancelled` | Stopped, with any partial output already received |
| `failed` | Failed, with `error` and `errorCode` when available |

| Usage field | Interpretation |
| --- | --- |
| `inputTokens`, `outputTokens` | Reported input and output counts |
| `reasoningTokens` | Share of output spent reasoning; absent means unreported, while `0` is a reported zero |
| `cachedInputTokens` | Share of input served from the provider's cache |
| `costEstimateCents` | Catalog estimate in fractional US cents, rounded to a millionth of a cent; absent without catalog pricing |
| `estimated: true` | Platform-estimated counts, typically when provider counts were lost on cancellation |
| `stepLimitHit: true` | The tool loop used its full round budget |

The usage ledger books the same catalog estimate. Cached input is priced at the normal input rate, so the estimate is an upper bound for a cached turn. Estimated usage includes the whole prompt, including assistant tools. A turn that fails before any counts are available has no `usage`.

`parts` is an ordered list discriminated by `type`: `text`, `reasoning`, `attachment`, `tool-call`, `tool-result`, `approval`, or `human-input`. The OpenAPI schema types each variant as its own named schema (`TextPart`, `ReasoningPart`, `AttachmentPart`, `ToolCallPart`, `ToolResultPart`, `ApprovalPart`, `HumanInputPart`) behind a `type` discriminator with an explicit mapping, so a generated client gets a class per kind. Treat future unknown variants as opaque rather than failing the whole message.

A `reasoning` part is thinking, not the final answer. It may repeat instructions supplied to the model, including organization and project instructions and retrieval trust rules. Display it separately and only to an audience allowed to see those instructions.

### Respect thread scope and access

For a personal chat with no project, use `/api/v1/threads` and its corresponding detail, messages and generation paths. Those URLs cannot address project threads. A wrong project URL returns **404**. Both kinds use the built-in assistant; `projectId`, `agentSlug` and `agentId` in create or message bodies answer **400**. Project readers, including Members, may create and send; an archived project refuses these writes with **403**.

An archived thread refuses a message with **409**, `CHAT_THREAD_ARCHIVED`, a sandbox thread with **409**, `CHAT_THREAD_NOT_DIRECT`, and a thread whose turn is still running — or whose accepted send is still queued — with **409**, `CHAT_TURN_IN_PROGRESS`; nothing is queued and the running turn keeps its `messageId`. Retry the last one once the poll says idle, never the other two.

### Rename, archive, delete, or stop a thread

The lifecycle is yours through the same URLs. `PATCH .../threads/{threadId}` with `{ "archived": true }` archives a thread out of the way and `false` restores it (a thread whose turn is running, or whose send is still queued, refuses the archive with **409** `CHAT_TURN_IN_PROGRESS` as the delete does — cancel first; restoring and renaming stay open mid-turn), and `{ "title": "Q3 review" }` renames it (send at least one of the two; a title is trimmed and 1–120 characters, on create and on rename alike); a thread created without a title is named by the assistant after its first message, and the thread’s `title` carries the name either way.

Archiving stamps `archivedAt` on the thread and leaves `updatedAt` alone — `updatedAt` is the last message activity, so a sync that watches it must read `archived` and `archivedAt` to see an archive or a restore. `DELETE .../threads/{threadId}` moves it to the trash (**409**, `CHAT_TURN_IN_PROGRESS` while a turn runs or a send is still queued); `DELETE .../threads/{threadId}/generation` asks the running turn to stop — **202** `{ "status": "cancelling", "messageId": "..." }`, then poll until idle; the stopped reply settles as `status: "cancelled"` with whatever had streamed.

A send that is still queued (the poll says `queued`) is stopped the same way: **202** naming the reply the send's 202 promised, the model is never called, and that reply settles as `cancelled` with empty `parts`. **404**, `CHAT_TURN_NOT_RUNNING` when nothing runs and nothing is queued — its `data.lastMessageId` and `data.lastStatus` name the newest assistant message the way an idle poll does, so a stop that lost the race against a fast model reads as "the reply is already there" without a second call. An archived project refuses all three with **403**.

### Recover from model and access failures

A model failure can appear as an assistant message with readable `error` text and, when available, `errorCode`. The model list is the organization’s configured catalog, not a promise from the provider’s account, so two codes mean the account rather than the request: `credit_exhausted` (the balance is spent) and `model_not_entitled` (the provider’s plan excludes this model). `error` is the provider's own answer prefixed with its HTTP status — a provider **429** can classify as `model_not_entitled` when the plan, not the rate, refused the model — so branch on `errorCode`, never on the sentence.

Pick another model or fix the account — waiting changes nothing, and neither is a `rate_limited`. The worker rechecks the accepted thread and project access before opening the turn. If the thread moves projects or access is lost while the request waits, it does not run or append an error in the new scope.

## Search a project's files

Use the project search URL when results must come from one project. It searches only that project's indexed files and requires read access, including for an archived project. Hub or team documents, other projects, websites and email attachments are outside this search. Omit `corpus` or set it to `"documents"`; any other corpus or a `projectId` body field returns **400**.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/knowledge/search" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "query": "Q1 filing deadline", "limit": 10 }'
```

### Interpret search scores and failures

The body requires `query` (trimmed before it is checked) and also accepts `limit` (1–50, default 10) and `minSimilarity` (0–1). `limit` is the size of the page, not of the search: the platform fuses a wider candidate pool, checks every candidate against its live document, and only then cuts the page — so `limit: 1` returns the best readable passage (at equal `fusedScore` a passage the keyword leg ranked precedes one only the vector leg found, then the lower row identity — an exact term is stronger evidence than a nearest neighbour).

`minSimilarity` floors the dense (vector) leg only, before fusion; there is no default on this endpoint, so without it the nearest passages answer however weak, and the keyword leg is never floored (the built-in assistant's search applies the organization's configured floor instead — `minSimilarity` in its [`embedding.json`](/self-hosted/configuration/data-residency#the-organizations-embedding-model), 0.45 when unset). Hits come back in fused order, best first.

`fusedScore` is that order key and nothing more: Σ 1/(60+rank) over the legs that ranked the passage, divided by the best possible for that many legs — a rank, so the best candidate of a one-leg search scores 1.0 however weak the leg found it; comparable only within one response, never a confidence, and not stable across searches. Every candidate is checked against its live document before fusion, so a passage you cannot see never holds a rank.

What you can threshold on is `similarity` — the dense leg's cosine on the embedding model's own 0..1 scale, for the hits that leg ranked; a hit only the keyword leg found carries `similarity: null` and its `keywordScore` — keep those, an exact identifier or phrase match is stronger evidence than any cosine (in code: `hits.filter(h => h.similarity === null ? h.keywordScore !== null : h.similarity >= floor)`); a scale, not a calibrated confidence: a high similarity does not prove relevance, and an unfamiliar or misspelt token can score above a term that appears in the text, so a hit the keyword leg did not also match (`matchedLegs` without `documents:keyword`) deserves a second look before you trust it — beside `keywordScore` (the BM25 weight, unbounded, `null` when only the vector leg found it) and `matchedLegs` (`documents:keyword`, `documents:dense`, `web:keyword`, `web:dense` — which legs ranked it; `legs` is their count, 2 when the keyword and the vector leg agreed).

Each hit carries its passage, its leg `score` (the first matched leg's own number) and its `source`; `diagnostics.cached` and `diagnostics.reranked` are reserved for a deployment that installs a semantic cache or a reranker — none ships, so both are always `false`; `diagnostics.legs` names every leg that ran with the admitted candidates it contributed, `0` when it ran and nothing survived (`documents:dense: 0` is a vector leg that found nothing in scope, never a missing one), and `diagnostics.dense` is `false` only when the corpus could not serve the vector leg at all, as `diagnostics.bm25` is for the keyword index; passages carry no control characters other than tab, line feed and carriage return; a passage repeated inside one document — an export of one line, a templated report — is indexed once, through its first occurrence, so a duplicate-heavy file neither crowds the vector leg nor ranks its copies one by one; a documents hit also carries `source.documentId` beside the blob `ref` the index keys it by: for a Hub hit (`source.projectId` null) it is the id `GET /api/v1/documents/{id}` takes, for a project hit the file id the project routes take (`GET /api/v1/projects/{projectId}/files/{documentId}/content`, `DELETE .../files/{documentId}`) — `/api/v1/documents/{id}` returns **404** for a project file.

A missing embedding model returns **409**, `EMBEDDING_NOT_CONFIGURED`; so does an embedding provider that refuses for account reasons — a spent balance, a spend limit, or a plan that excludes the model — as **409**, `EMBEDDING_CREDIT_EXHAUSTED`; a credential the provider rejects, or one it refuses the model, is **409**, `EMBEDDING_CREDENTIAL_REJECTED` — fix the provider settings. Neither is a rate limit: no wait lifts them, an admin has to act. Any other provider failure returns **503**, `EMBEDDING_UPSTREAM_ERROR`, with `Retry-After` — retry that one with backoff.

To search visible non-project Hub and team documents or registered websites instead, use `POST /api/v1/knowledge/search` with `corpus` set to `"documents"`, `"web"` or `"all"` (the default). That URL excludes project files and email attachments. Both URLs find file-backed documents only — a document created with inline `content` never indexes.

## Mirror an external system into a project

The Projects group is built for an unattended worker that mirrors an external system — a CRM, a practice-management tool — into Tale: find or create the client's project, prepare its folders, upload files, verify. Every call acts as the key holder: a project that user cannot see returns as if it did not exist, and writes need an editing role (Editor or above — Member is read-only here) plus edit access on the project.

These routes, and the Tasks routes below, refuse to guess the organization: a key whose user belongs to several organizations must send `X-Organization-Slug` on every call — a request without it returns **400**. Mint machine keys for a dedicated user with exactly one membership and the question never comes up; the examples keep the header anyway — it is always membership-checked, never ignored.

### Find or create the project

A project carries its audience in `teamIds` — the teams that may see it; empty means the whole organization. Read the ids from `GET /api/v1/teams` (every team, by name, with `member: true` on the ones the key holder belongs to — a key holder who is not an organization admin may only name those), send them on `POST /api/v1/projects` or replace the whole set with `PATCH /api/v1/projects/{id} { "teamIds": [...] }` (an admin verb). A repeated id collapses to one, re-asserting the audience the project already carries is a no-op that leaves `updatedAt` alone, and an archived project refuses the change like every other write (**403**, `PROJECT_ARCHIVED`) unless the same body restores it.

`externalItemId` is your key, not Tale's — an opaque string (your CRM's record id), unique per organization, never interpreted by the platform. It is stored and compared after NFC normalization and trimming, so a key handed over in NFD by a macOS filesystem finds the project a worker created in NFC from a CSV, and a trailing newline from a shell variable never makes a second project.

A legacy row whose key differed from another's only in normalization was released by the platform — its `externalItemId` is empty, the row that held the canonical spelling kept the key — so re-key it with `PATCH /api/v1/projects/{id}` when it is the one you meant. Look it up first; the lookup returns at most one project, and a match the key's user cannot see looks exactly like no match:

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects?externalItemId=crm-4711" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "projects": [] } — or [ { "id": "...", "name": "ACME Ltd", "externalItemId": "crm-4711" } ]
```

A match carries `archivedAt` when the project is archived — decide what your worker does with that case before it happens. Without `externalItemId`, the same route lists every project the key's user can see, newest first, keyset-paged like every other list — `{projects, isDone, continueCursor}`; pass `continueCursor` back as `?cursor=` until `isDone` (while more pages remain the answer also carries `cursor`, the same token under its pre-1.5 name — deprecated, read `continueCursor`; a lookup returns `isDone: true` with an empty `continueCursor`) — with archived projects left out unless you ask for them (`?archived=include`, or `?archived=only`).

Every row carries `createdAt` and `updatedAt`, so a worker can reconcile what it created:

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects?limit=50" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "projects": [ { "id": "...", "name": "ACME Ltd", "externalItemId": "crm-4711", "createdAt": 1774..., "updatedAt": 1774... } ], "isDone": true, "continueCursor": "" }
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

`key` (the task-identifier prefix) and `description` are optional — the key derives from the name when omitted. A second create with the same `externalItemId` — the same after NFC normalization and trimming — returns **409**; the same string in another organization is fine, uniqueness is per organization. A key that is blank once trimmed returns **400**, `INVALID_BODY`.

An explicit project `key` contains 2–6 letters or digits, starting with a letter, and is normalized to uppercase; invalid keys answer **400**, without truncation. A name that yields no valid key creates a keyless project. A derived key that collides is re-derived until it is free; an explicit key that collides returns **409**, `PROJECT_KEY_TAKEN` — supply an unused one. The same `externalItemId` twice is **409**, `PROJECT_DUPLICATE_EXTERNAL_ID`.

### Create folders

Folder creation is get-or-create: the same name under the same parent — compared without regard to case, so `inbox` and `INBOX` are one folder — returns the existing folder with its stored name and `created: false` (**200**) instead of a duplicate, so a worker re-runs its setup step blindly after a crash; two workers creating the same folder at once get one folder.

A name is a name, never a path: a `/` or `\`, a control character, `.` or `..` returns **400**, `FOLDER_NAME_INVALID`, the sentence naming the rule broken and `data.issues` naming `name` — the same rule a file name follows, and like a file name the folder name is stored trimmed and NFC-normalized — and `parentId` is either a folder of this project or omitted for a root folder (a blank one returns **400**, `INVALID_BODY`). Folder names carry no platform-reserved meanings — the layout is yours:

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/folders" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "2026-Q1" }'
# → 201 { "folder": { "id": "<folderId>", "name": "2026-Q1" }, "created": true }
```

`parentId` (a folder of this project) nests deeper; omit it for a root folder. A name is at most 128 characters, trimmed, and never a path — `a/b`, `.` and `..` answer **400**, `FOLDER_NAME_INVALID` — and a folder 20 levels deep takes no child (**400**, `FOLDER_DEPTH_EXCEEDED`).

The tree reads back one level at a time: `GET .../folders` lists the root folders, `GET .../folders?parentId=<folderId>` the children of one folder, and every folder carries its `parentId` (`null` at the root); `GET .../folders/{folderId}` resolves a single folder — the `folderId` every file in `GET .../files` carries — so a worker that did not build the tree can still discover it, and a path is the parent chain walked upward. A `parentId` or `folderId` that is not a folder of this project returns **404**, `FOLDER_NOT_FOUND`.

### Upload a file in two steps

Two REST calls surround one direct object-store upload: prepare the handoff, transfer the bytes, then bind them to the project. The shell example requires `jq`, an existing project folder, and a local file whose extension and MIME type are allowed. Run each command only after the previous one succeeds.

```bash
: "${TALE_URL:?Set TALE_URL to your Tale origin}"
: "${TALE_API_KEY:?Set TALE_API_KEY}"
: "${TALE_ORG_SLUG:?Set TALE_ORG_SLUG}"
: "${TALE_PROJECT_ID:?Set TALE_PROJECT_ID}"
: "${TALE_FOLDER_ID:?Set TALE_FOLDER_ID to a folder in this project}"
: "${FILE_PATH:?Set FILE_PATH to an existing local file}"
: "${FILE_MIME:?Set FILE_MIME, for example application/pdf}"

FILE_NAME=$(basename "$FILE_PATH")
FILE_SIZE=$(wc -c < "$FILE_PATH" | tr -d ' ')
UPLOAD_BODY=$(jq -n --arg name "$FILE_NAME" --arg type "$FILE_MIME" \
  --argjson size "$FILE_SIZE" '{fileName:$name,contentType:$type,size:$size}')
UPLOAD_JSON=$(curl --fail-with-body --silent --show-error \
  "$TALE_URL/api/v1/projects/$TALE_PROJECT_ID/uploads" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'Content-Type: application/json' --data "$UPLOAD_BODY")
UPLOAD_ID=$(printf '%s' "$UPLOAD_JSON" | jq -er '.uploadId')
UPLOAD_URL=$(printf '%s' "$UPLOAD_JSON" | jq -er '.url')
FILE_REF=$(printf '%s' "$UPLOAD_JSON" | jq -er '.s3Ref')
printf '%s' "$UPLOAD_JSON" | jq '{uploadId,method,expiresAt,maxBytes}'
```


#### Send the bytes before binding

The returned `url` is a presigned URL for a direct `PUT` to object storage. Send no `Authorization` header: the signature already authenticates the request, and adding a second authentication method is rejected. If preparation included `contentType`, the PUT's `Content-Type` must match it exactly. Omitting `contentType` during preparation leaves no required content-type header. Use the returned `s3Ref` as `fileId` when binding the upload.

Include `fileName` during preparation, for example `"fileName": "ledger-2026-q1.pdf"`, to check the format and organization policy before requesting a signed URL. A rejected file type or a name without an extension returns **400** with `UPLOAD_POLICY_REJECTED` or `UNSUPPORTED_FILE_TYPE`. Specifying a MIME type does not replace the required extension.

`maxBytes` reports the permitted size for the declared type: at most 100 MiB (104,857,600 bytes), or a stricter organization limit. Include the optional `size` to check the planned upload before transferring it. Exceeding the platform cap returns **400** `FILE_TOO_LARGE`; exceeding organization policy or volume quota returns **400** `UPLOAD_POLICY_REJECTED`. `data.limitBytes` identifies the limit.

This pre-check avoids transferring an oversized file. Binding still checks the actual stored byte count against the current limits. It does not compare that count with the declared `size`, so understating the declaration cannot bypass the upload limit.

Transfer the bytes to the returned URL. Do not send the Tale API key to this URL: the signature already authenticates the object-store request. Wait for a successful upload before binding.

```bash
curl --fail-with-body --silent --show-error --request PUT "$UPLOAD_URL" \
  --header "Content-Type: $FILE_MIME" \
  --upload-file "$FILE_PATH"
```

```bash
BIND_BODY=$(jq -n --arg upload "$UPLOAD_ID" --arg ref "$FILE_REF" \
  --arg folder "$TALE_FOLDER_ID" --arg name "$FILE_NAME" \
  '{uploadId:$upload,fileId:$ref,folderId:$folder,fileName:$name}')
curl --fail-with-body --silent --show-error \
  "$TALE_URL/api/v1/projects/$TALE_PROJECT_ID/files" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'Content-Type: application/json' --data "$BIND_BODY"
```

The binding response is `201 {file}` and includes the new document ID. Keep `file.id` for later listing, download, indexing, or deletion; it is different from `uploadId` and `s3Ref`.

#### Handle expiry, format policy, and abandoned uploads

The stored `mimeType` is resolved from the file extension, and downloads use it as `Content-Type`. A multipart media type or upload hint does not override the extension-based policy.

`uploadId` is single-use. Both it and the signed URL expire after 30 minutes; `expiresAt` is their shared deadline. After an interrupted upload, prepare a new one if that deadline has passed.

`fileName` must be a plain filename. Tale trims it and applies NFC normalization; path separators or control characters return **400**. An allowed extension is required during preparation and binding: `CON` and `attachment-4711` return `UNSUPPORTED_FILE_TYPE`, even when `contentType` is supplied.

Binding rechecks the upload policy. Supported extensions are `pdf`, `doc`, `docx`, `odt`, `ppt`, `pptx`, `xls`, `xlsx`, `csv`, `txt`, `md`, `json`, `yaml`, `yml`, `py`, `jpg`, `jpeg`, `png`, `gif`, `webp`, and `ac2` (Banana accounting ledger), subject to the organization's narrower policy. The `UNSUPPORTED_FILE_TYPE` message includes the sorted format list. Unsupported formats and excessive sizes return **400** with the relevant reason code.

If the bytes have not reached object storage, binding returns **404** `BLOB_NOT_FOUND` and leaves the upload ID usable. Complete the PUT, then bind the same upload again.

Without configured object storage, both preparation and binding return **503** `OBJECT_STORE_UNCONFIGURED`. Unbound blobs are cleaned up automatically: they become eligible 24 hours after the 30-minute upload deadline, and a later upload-preparation request in the same organization removes a batch of expired upload records and blobs. This also covers rejected bindings and clients interrupted between transfer and binding.

Until cleanup, these bytes remain in the bucket but do not appear in file lists or count against a quota.

#### Choose whether to index the file

Files that enter through this endpoint are project working material, not organization knowledge: they skip knowledge indexing by default (`skipRagIndexing` defaults to `true` on the bind; pass `false` to opt in), and they never appear under `/api/v1/documents` — that family stays the knowledge hub's surface.

A skipped file is still listed by the project's chat and reads **Not indexed** on the project's Knowledge tab: a search never finds it until it is indexed (**Index now** on its row, `POST /api/v1/projects/{id}/files/{documentId}/retry-indexing` from REST — the same core and the same 10-per-user-per-minute budget as the Hub document's retry, answering `{"status": "indexing"}` and lifting the opt-out, or `skipped` with its `reason` — or a bind with `skipRagIndexing: false`), but the assistant reads a plain-text file of up to 4 MiB on request — `rag_fetch` on its id serves the bytes as text rather than answering that the file is unindexed.

### Verify what landed

Choose the file scope with `folderId`: omit it for all files in the project, use `folderId=root` for unfiled files at the project root, or pass a folder ID for that folder’s files. A folder outside the project returns **404**, `FOLDER_NOT_FOUND`.

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects/<projectId>/files?folderId=<folderId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "files": [ { "id": "...", "fileName": "ledger-2026-q1.pdf", "folderId": "<folderId>", "mimeType": "application/pdf", "size": 48213, "indexing": { "status": "skipped" }, "createdAt": 1774... } ], "isDone": true, "continueCursor": "" }
```

Each row carries the landed `size` and the file's `indexing` state in the vocabulary `GET /api/v1/documents` speaks: a file bound with the default `skipRagIndexing: true` reads `skipped`, and project search does not find it until it is indexed — `POST .../files/{documentId}/retry-indexing`, then poll the single-file read until indexing settles. The listing returns `{files, isDone, continueCursor}`: while `isDone` is `false`, pass `continueCursor` back as `?cursor=` unchanged (it is an opaque signed token) and cap the page with `?limit=` (max 100); while more pages remain the answer also carries `cursor`, the same token under its pre-1.5 name — deprecated, read `continueCursor`.

To monitor one file, read `GET /api/v1/projects/{id}/files/{documentId}`. It returns `{file}` with `id`, `fileName`, `folderId`, `mimeType`, `createdAt`, and `size` in bytes (`null` when unknown), plus indexing state when available. Send its `ETag` as `If-None-Match` for `304` while unchanged; after `POST .../retry-indexing`, poll this row until indexing settles. You do not need to rescan the file list. Missing, trashed, non-file, or out-of-project records return the opaque `404 FILE_NOT_FOUND`.

```bash
curl --fail-with-body --compressed "$TALE_URL/api/v1/projects/<projectId>/files/<documentId>" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG"
```

### Delete what you no longer need

Nothing this endpoint creates has to stay forever. A file goes with `DELETE .../files/{documentId}` — permanently: its document row, its search-corpus rows and its blob are purged through the same lane every hard delete uses, so the answer is **204** or a refusal, never a silent no-op:

```bash
curl -sS --compressed -X DELETE "https://your-host.example.com/api/v1/projects/<projectId>/files/<documentId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 204
```

A folder goes with `DELETE .../folders/{folderId}`, and everything beneath it goes too — every file in it and in its subfolders is purged first (their corpus rows released at once, so project search stops matching them), then the subtree. A protected controlled record or a legal hold anywhere beneath refuses the whole delete with **409** before anything is removed; a purge the object store could not finish returns **503**, `PURGE_INCOMPLETE`, with nothing removed — retry it. Both deletes need edit access to an active project; a file or folder of another project, or one already gone, returns **404** (`FILE_NOT_FOUND`, `FOLDER_NOT_FOUND`).

#### Archive, rename, or delete the project

The project itself has a lifecycle too, for organization admins (**403**, `ROLE_FORBIDDEN`, for anyone else). `PATCH /api/v1/projects/{id}` with `{ "archived": true }` archives it — it stays readable through this endpoint, refuses every write with **403**, `PROJECT_ARCHIVED`, keeps its `externalItemId` taken, and `{ "archived": false }` restores it.

The same `PATCH` carries the identity a mirror propagates when the source record changes: `name` (trimmed, never blank), `description` (`null` clears it) and `externalItemId` (stored NFC-normalized and trimmed; `null` releases the key, another project's key returns **409**, `PROJECT_DUPLICATE_EXTERNAL_ID`, with the key in `data`) — for editors with project edit access on an active project, every field optional and at least one required. A body that restores and renames applies the restore first, one that renames and archives applies the archive last; renaming an archived project the body does not restore returns **403**, `PROJECT_ARCHIVED`.

When "ACME Ltd" becomes "ACME Group" in the CRM, `{ "name": "ACME Group" }` is the whole move — nothing under the project is touched. `DELETE /api/v1/projects/{id}` removes it and frees the key: by default a cascade — every document expires into the retention pipeline, your own chats are trashed, every task is retired and its live runs cancelled — or, with the body `{ "mode": "detach" }`, the documents and chats are released into the organization instead. The project's run history goes with it either way, finished runs included — unlike an automation delete, which keeps its runs.

Agents and folders go with the project either way, and a cascade draws on the same per-user budget the app's delete does (5 per minute):

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

### Create or update the mirrored task

Task creation is idempotent per `(projectId, externalSystem, externalId)`: the first call creates (**201**, `created: true`) a task in `backlog` — the mirror's intake column, where the app's own Create task defaults to To do — and a repeat returns with the same task (**200**, `created: false`). Both keys are stored and compared after NFC normalization and trimming — the same rule as a project's `externalItemId` — so a padded or differently normalized repeat is still the same task, and a key that is blank once trimmed returns **400**. Take `projectId` from the URL; sending it in the body returns **400**. Creating a task requires edit access to an active project.

`externalState` mirrors the source item's lifecycle: `closed` parks the task at `in_review` for a person to complete (only the workflow engine itself lands a close at `done`), and `open` reopens a task the mirror closed — one it parked at `in_review`, or a `done` one — back to `backlog`; a park a person or an agent made is theirs, `open` leaves it, and any move through the board ends the mirror's claim on a park it made. A cancelled task stays cancelled either way.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "externalSystem": "crm", "externalId": "case-991", "title": "Prepare the Q1 filing" }'
# → 201 { "task": { "id": "<taskId>", "created": true } }
```

Repeating an active task’s external reference updates its title and description; omitting `description` clears it. Labels change only when supplied. An archived task stays unchanged. The task id stays the same, and `runWorkflowSlug` does not start another run on that repeat. Keep the repeated payload stable when retrying after a lost response.

### Bind a setup folder and choose automation ownership

`description`, `labels`, `externalUrl`, and `setupFolderName` are optional; `title` takes up to 200 characters and `externalUrl` must be an absolute `http(s)` URL — a longer title or another scheme returns **400** rather than a silently altered task. `setupFolderName` binds the task to one of the project's root folders by name — matched without regard to case — and stores that folder's id as the task's `externalUrl`: the Setup-folder binding a folder-driven automation reads off its task input, resolved again on every repeat.

A name no root folder of the project carries returns **400**, `SETUP_FOLDER_MISSING`, and nothing is created; sent beside `externalUrl`, it returns **400**, `INVALID_BODY`. Labels keep their spelling: a name is trimmed and NFC-normalized, matched against the project's catalog without regard to case, created with the spelling you sent when it is new, and read back as stored in the order you sent — so `["Bug", "P1"]` reads back as `["Bug", "P1"]`, while `["bug"]` on a project that already has `Bug` wears that existing label (two names differing only in case are one label, never two).

Send `automationSlug` when the task belongs to an automation: it becomes the assignee, and the task modal's work panel — the Start button, run progress, and the operator questions a run asks — keys on that ownership (a later re-pick fills a missing attribution, but never overwrites an assignee). `runWorkflowSlug` starts a deployed workflow on a newly created task in the same call — the run starts inline, so the response carries its `runId` (the run id to poll; `executionId` repeats it and is deprecated), or `runId: null` if the slug has no deployed version or starting fails after the task is committed. A null run ID does not undo the saved task; inspect and correct the workflow, then use the explicit start route.

Start explicitly instead when you want to name the workflow in a separate call. The owning `automationSlug` must name an automation that exists — **404**, `AUTOMATION_NOT_FOUND`, otherwise — with a deployed version: one that is saved but not deployed returns **409**, `AUTOMATION_NOT_DEPLOYED`, naming it. A workflow bound to other projects returns **403**.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/start" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "workflowSlug": "vat-return" }'
# → 200 { "started": true, "runId": "<runId>", "executionId": "<runId>" }
```

### Check whether a task run started

Starting requires edit access to an active project and an active task — an archived task returns **403**, `TASK_ARCHIVED` (a task is archived from the board; this endpoint has no verb for it, and the task read carries `archivedAt` while it is, so check that before starting). It wraps the task as `{task: ...}` and needs no additional developer capability; the run log attributes the start to your key. Poll `GET /api/v1/projects/{id}/runs/{runId}` with the `runId` (`executionId` carries the same value and is deprecated).

The answer is **200** whether or not a run started, so branch on `started`, never on the status alone: with `started: false`, `reason: "already_running"` carries the in-flight run's `runId` — a task holds at most one live run, whichever automation started it, so that run may belong to another automation (its `name` says which); poll that run. A workflow bound to other projects returns **403**, `AUTOMATION_PROJECT_FORBIDDEN`. The `workflowSlug` names the automation as `GET /api/v1/automations` lists it — the `/` form (`billing/dunning`), never the `__` spelling the URL path takes — and must name one that exists — **404**, `AUTOMATION_NOT_FOUND`, otherwise — with a deployed version: one that is saved but not deployed returns **409**, `AUTOMATION_NOT_DEPLOYED`, naming it, the same two refusals the intake gives an `automationSlug`, judged before the execute budget is charged; `reason: "not_started"` is left for the one residual case, a deployment withdrawn between that check and the start.

Concurrent starts for the same task share the one in-flight run, whichever automation they name, including requests that arrive together. This is not `Idempotency-Key` support for task starts: once that run finishes, another start can create another run. Save the returned `runId` and inspect it before retrying an uncertain start.

### Comment and read task state

Report back and read state — the comment posts as the key holder, indistinguishable from the same person commenting in the app, @mentions included. Project readers, including Members, may comment on an active task in an active project; an archived task refuses the comment with **403**, `TASK_ARCHIVED`, the way an archived project does with `PROJECT_ARCHIVED`. Reading a task or its comments is also allowed after archival. Every task URL is judged left to right: a project that is missing or invisible returns **404**, `PROJECT_NOT_FOUND`, and only a task that is missing or belongs to another project returns `TASK_NOT_FOUND`.

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

### Read comments and download deliverables

Comment writes accept optional `bodyByLocale` alongside the canonical `body`, and comment reads return it when present. Supply equivalent nonblank translations for `en`, `de` and `fr`; additional language or language-region keys such as `nl`, `it` and `de-CH` are allowed. Each value is trimmed and limited to 10,000 characters, with at most 16 locales per comment. Render the reader's exact locale, then its base language, then `en`, then `body`. Attribution remains the key holder's. A plain-text edit in Tale clears the old translations so they cannot hide the edit.

Task and workflow agents receive instructions to preserve the language established by the task title and description, falling back to the organization's default agent language. Generated title-template words, quarter identifiers, source-document languages and the run starter's UI locale do not establish the task language. The same policy applies to operator questions, resumed turns and related task creation. This is model guidance; localized progress snapshots let clients select a translation independently of the canonical task language.

Read the run output and task comments to collect the automation's results. Whether it also creates files, and where it stores them, depends on the workflow; starting a task does not by itself put files in the example quarter folder.

Comments arrive in pages, newest page first and chronological within each page. `limit` defaults to 200 and allows at most 500. While `isDone` is `false`, pass `continueCursor` unchanged as `cursor` to read older comments. It is an opaque signed token, not a page number.

The content endpoint streams the bytes itself (**200**, no redirect to follow), named by an RFC 6266 `Content-Disposition`, so a plain `curl -o` lands the file and `--fail-with-body` turns a refusal into a non-zero exit instead of a file full of JSON.

`Range` is honoured: a single byte range (`bytes=0-1023`, `bytes=1024-`, `bytes=-512`) returns **206** with `Content-Range`; a range starting at or past the end of the file — what `curl -C -` sends once the local copy is complete — returns **416** with an empty body and `Content-Range: bytes */<size>` naming the size, so a resuming worker learns it is done; several ranges or a `Range` the server cannot read are ignored and the whole file returns **200**.

A `HEAD` returns the same headers a `GET` carries — `Content-Length`, `Content-Type`, `ETag`, `Last-Modified`, `Accept-Ranges` — without the bytes and ignores `Range`, so a poller checks for a new version with `curl -I` (not `curl -X HEAD`, which waits for a body) and sends the `ETag` back as `If-None-Match` to get **304** while nothing changed:

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

API refusals normally use a flat JSON envelope. A conditional `304`, a `HEAD` response, or a refusal from an intermediary can have no JSON body:

```json
{ "error": "Automation not found", "code": "AUTOMATION_NOT_FOUND" }
```

`error` is a sentence for humans; `code` is the stable value to branch on — every refusal the API itself makes carries one, and the OpenAPI document lists the full set as the `Error.code` enum. The set is additive: a new code is a minor change, so treat a value you do not know as a generic refusal of the status you got. Some refusals add `data` — `issues` for a refused body, `retryAfterMs` for a rate limit, `providers` for an ambiguous model. Branch on the code where one is named below, on the status otherwise:

Read the exact error enum without a key:

```bash
curl --fail --silent --show-error "$TALE_URL/openapi.json" \
  | jq -r '.components.schemas.Error.properties.code.enum[]'
```

**400: correct the request before retrying.** Invalid bodies return `INVALID_BODY` with `data.issues`. Each issue has a field path, such as `price` or `contacts.2.email`, and a short message suitable for display: `is required`, `must be a string`, `must not be blank`, `must be at most 200 characters`, or `must be one of "a", "b"`. Unknown keys are reported under their own names. Branch on `code`, not this human-readable wording.

Body validation rejects missing required values, incorrect types, unknown keys, malformed JSON, invalid UTF-8, NUL characters, unpaired UTF-16 surrogates, integers beyond 2^53 − 1, and numbers outside the field's permitted range. A search `limit` in the JSON body is rejected when out of range; it is not clamped. The API reads JSON regardless of `Content-Type` and does not return 415 for these bodies.

| Other 400 code | Meaning and recovery |
| --- | --- |
| `INVALID_CURSOR` | The token did not come from this list. Restart pagination without it. |
| `INVALID_LIMIT` | A query `limit` is not an integer. Valid integers outside the range are clamped instead. |
| `INVALID_QUERY` | Another query parameter is invalid. Query failures name the parameter in `data.issues`; none silently restart at page one. |
| `AUTOMATION_INPUT_INVALID` | Correct the input against the automation's `inputs` schema using `data.issues`. |
| `AUTOMATION_TRIGGER_INVALID` | Correct a trigger that cannot fire, including an impossible date such as `0 0 30 2 *`. |
| `CONTACT_IDENTITY_REQUIRED` | Preserve at least one contact identity field. |
| `DOCUMENT_RECORD_FROZEN`, `DOCUMENT_RECORD_REPLACEMENT_REQUIRED` | Follow the controlled-record replacement workflow instead of editing protected content directly. |
| `ORG_SLUG_REQUIRED` | Supply the organization for a key holder with multiple memberships. |
| `INVALID_HEADER` | Use 1–255 printable ASCII characters after trimming for `Idempotency-Key`; `data.issues` names the header. |
| `INVALID_URL` | Remove NUL bytes (`%00`) from the path or query. This check runs before routing and authentication. |
| `BODY_CHUNK_MALFORMED` | Correct malformed HTTP/1.1 chunk framing in the client or intermediary. The edge supplies its own `requestId` and no contract version. |
| `BODY_LENGTH_MISMATCH` | Under HTTP/2, the body ended before its declared `Content-Length`. The edge response has a fresh `requestId` and no `X-Tale-Api-Version`. |

- **401** — missing or invalid API key (`UNAUTHORIZED`), with a `WWW-Authenticate: Bearer` challenge.
- **403** — the holder lacks the required role (`ROLE_FORBIDDEN`, `KNOWLEDGE_ENTRY_FORBIDDEN`) or project edit access, a document's or project's `teamIds` names a team the holder is not in (`TEAM_ACCESS_DENIED`), the project or task is archived for a requested mutation (`PROJECT_ARCHIVED`, `TASK_ARCHIVED` — a project's `teamIds` included), an automation cannot run in this project, or `X-Organization-Slug` names an organization the key holder is no member of (`ORG_FORBIDDEN`).
- **404** — the resource is absent, invisible to the holder, owned by another thread user, or belongs to a different project than the URL names; each family names its own code (`PROJECT_NOT_FOUND`, `DOCUMENT_NOT_FOUND`, `THREAD_NOT_FOUND`, …), an `X-Organization-Slug` that names no organization returns `ORG_SLUG_INVALID`, and an unknown route returns `NOT_FOUND` — once the key is checked: keyless, the endpoint's **401** comes first, so a path this endpoint never served (`/api/v1/openapi.json`, say) returns **401** without a key and **404** with one; the document itself lives at `/openapi.json`, outside the endpoint and keyless.
- **405** — the route exists, but not for that verb (`METHOD_NOT_ALLOWED`); `Allow` lists the verbs it serves.
- **409** — the state refuses the action: no deployed version, a bound automation called without a project URL, a run still in flight on delete (`RUN_ACTIVE`), an `Idempotency-Key` reused with a different body (`IDEMPOTENCY_KEY_REUSED`), an archived thread or a turn already running, a duplicate — a contact's `email` or `externalId` (`CONTACT_DUPLICATE_EMAIL`, `CONTACT_DUPLICATE_EXTERNAL_ID`), a product's `name` or `externalId` (`DUPLICATE_PRODUCT_NAME`, `DUPLICATE_PRODUCT_EXTERNAL_ID`), a knowledge entry's topic (`KNOWLEDGE_ENTRY_DUPLICATE`), a project's `externalItemId` (`PROJECT_DUPLICATE_EXTERNAL_ID`) —, a superseded knowledge entry (`KNOWLEDGE_ENTRY_SUPERSEDED`), a stale `expectedUpdatedAt` (`CONTACT_STALE`, `PRODUCT_STALE`, `DOCUMENT_STALE`), a document that backs an active knowledge entry (`DOCUMENT_HAS_KNOWLEDGE_ENTRY` — delete or update the entry instead), a delivery retry on one that is not dead-lettered (`DELIVERY_RETRY_UNAVAILABLE`), a newer conversation content snapshot bound to a trashed contact (`CONVERSATION_CONTACT_TRASHED`), or search without an embedding model.
- **412** — a precondition failed and nothing was written: `If-Match` on a skill whose `SKILL.md` changed since you read it, or with nothing stored (`SKILL_STALE` — `data.etag` names the current tag, `null` when nothing is stored); `If-None-Match: *` on a skill slug that already has a bundle (`SKILL_EXISTS`); a document `If-Match` that no longer matches its read representation (`PRECONDITION_FAILED`, with the current tag in `data.etag`).
- **413** — the body is too large (`BODY_TOO_LARGE`; the sentence names the cap): every JSON body at its cap (1 MiB unless the operation says otherwise — the caps are listed above), the webhook trigger at its 256 KiB (262,144 bytes) cap. An uploaded file that breaks the size or type policy is refused at the bind with **400** and a reason code instead.
- **422** — a skill bundle the file layer cannot read — a planted symlink, a file over the 4 MiB staging cap, a `SKILL.md` that does not parse (`SKILL_MALFORMED`): answered by the reads and, on `PUT`, only for the bundle already stored under the slug — the body you send is validated as **400** (`INVALID_BODY`, `INVALID_SKILL`), so a JSON body alone never provokes it.
- **429** — rate limit exceeded (`RATE_LIMITED`). `error` describes the wait; `requestId` identifies the request. Wait for `Retry-After` in whole seconds or `data.retryAfterMs` in milliseconds before retrying. See [Rate limits](/develop/rate-limits).

| Status | Meaning and recovery |
| --- | --- |
| **414** | the request URL (path and query) exceeds 32 KiB (`URI_TOO_LONG`); the envelope carries a `requestId`. |
| **408** | the request did not finish arriving within 15 minutes, headers and body together (`REQUEST_TIMEOUT`); the envelope carries a fresh `requestId` (the timed-out request never got one of its own) and the connection is closed — retry on a faster link or in smaller pieces. |
| **431** | the request headers as a whole exceed the edge's 64 KiB budget; answered without the envelope and with no `X-Request-Id` (the edge's parser writes it before any route runs) on HTTP/1.1 (which lets a few KiB of slack through first — a URL or header just past the budget still reaches the platform and is judged by its rules, a 66 KiB URL answering **414**), and on HTTP/2, where the budget is exact, by closing the connection. |
| **500** | internal error (`INTERNAL_ERROR`); the envelope carries a `requestId` to quote when you report it. |
| **503** | a dependency the request needed is down: the embedding provider (`EMBEDDING_UPSTREAM_ERROR`, with `Retry-After`), the object store behind a file download (`OBJECT_STORE_UNAVAILABLE`, with `Retry-After`) or a deployment without one (`OBJECT_STORE_UNCONFIGURED`), a document purge that could not finish (`PURGE_INCOMPLETE`), or an object store that accepted a knowledge-entry write and never answered it within 30 seconds (`KNOWLEDGE_ENTRY_STORE_TIMEOUT` — nothing is written) — retry with backoff. |
| **502**, **503**, **504** | answered at the edge while the platform restarts or cannot be reached (`UPSTREAM_UNAVAILABLE`, with `Retry-After`, a fresh `requestId` and no `X-Tale-Api-Version`), on every machine endpoint — `/api/*`, `/events`, `/status.json`, `/openapi.json`, `/.well-known/*`; a browser navigation gets the maintenance page instead — retry with backoff. |

Unbinding a trigger from an existing automation (`DELETE .../triggers`) returns **204** whether or not a trigger was bound; an unknown automation returns **404**. Deleting a resource returns **404** when it is absent, including a contact already moved to trash, a product already deleted or a knowledge entry already deleted. A contact's `DELETE` is a move to the trash (`POST /api/v1/contacts/{id}/restore` brings it back); a product's `DELETE` is permanent — products have no trash and no restore, and the name and `externalId` are free for a new product at once, which is a new row with a new id. Deleting an active knowledge entry retires every version of its topic and moves the Hub document behind it to the trash — and drops that document's passages from the search corpus at once; deleting that document directly is refused.

Cancelling an unknown run also returns **404**; `{cancelled: false}` means the run exists but has already finished; the accompanying `status` identifies its terminal state.

## Versioning

Three numbers describe a running instance, and they mean different things. The build (`GET /api/health` returns it) is the deployment's release. The REST prefix, `/api/v1/`, is the compatibility line: a route under it is served until a `/api/v2/` exists and the retirement of `/api/v1/` has been announced in the release notes at least two minor releases ahead, with `Deprecation` and `Sunset` headers on the retiring routes in the meantime.

The contract's own version is `info.version` in the OpenAPI document at `/openapi.json` — semver for the wire: a minor bump for an additive change (a new operation, field, header or error code), a major one for a removal or a changed meaning — and every response names the version the instance implements in `X-Tale-Api-Version`, so a client that pins to a version can tell when the instance moved. The document describes the routes and request and response schemas served by the running instance, with `servers` set to that instance; `/docs` renders it.

Use it as the contract for your client, and read each release's notes under **API contract changes** — every wire change to this surface is listed there with the old and the new behaviour ([release notes format](/self-hosted/operate/release-notes/format)). Published notes are available on [GitHub Releases](https://github.com/tale-project/tale/releases).

A few endpoints live outside that document on purpose: `GET /api/health` is the unauthenticated liveness probe (`{"status":"ok","version":"<build>"}`), `GET /status` and `/status.json` the deployment's own [status page](/develop/status-page), `/openapi.json` and `/docs` the contract itself; the [WebDAV](/develop/webdav-api) and OpenID Connect surfaces (above) speak their own protocols.

## Where this fits

This page is the REST half of the outside surface. The [MCP endpoint](/develop/mcp-endpoint) exposes the same platform to MCP clients — automation authoring lives there, not in REST. The [Webhooks page](/develop/webhooks) covers the inbound trigger that starts runs without a key. If you are building inside the product — project agents, automations — the [Platform tab](/platform) is your day-to-day; this page is for outside.
