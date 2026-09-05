---
title: API reference
description: How to call Tale from outside — authentication, the endpoint inventory, pagination, the async run and turn loops, and the error model. The single source of truth for the REST surface.
i18nLintExclude:
  - terminology-loanword
---

The Tale API is the surface integrators use when they are outside the product and want to script it: knowledge resources, projects with their files and tasks, automations and their runs, chat threads, agents, and skills, all as JSON over HTTPS with an API key in a header. The same key also opens the [MCP endpoint](/develop/mcp-endpoint) — this page covers the REST half.

This page is the canonical inventory of the surface, the auth model, and the error shape. Field-level request and response schemas live in the OpenAPI document your instance serves at `/docs` — load it there when you need every property; read this page to understand how the API behaves.

## A worked request

The shortest useful request — list the organization's automations — is one curl:

```bash
curl -sS "https://your-host.example.com/api/v1/automations" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

A successful response is a named list: `{ "automations": [ { "name": "billing/dunning", "latestVersion": 3, "deployedVersion": 2 } ] }`. List shapes vary by family: most answer a named array like this one, while the knowledge and chat resources — contacts, products, documents, knowledge entries, threads, websites — answer a `{ "page": [...], "isDone": ..., "continueCursor": ... }` page envelope. Where a page envelope paginates, pass `continueCursor` back as `?cursor=` and cap the page with `?limit=`: contacts, products, documents, knowledge entries, threads, and websites all page this way to the last page (`isDone: true` with an empty `continueCursor`). An automation's run listing is a bounded window instead — `?limit=` (1..200, default 50) picks how many of the newest runs you get. The Projects machine door travels lighter still — its section shows those shapes.

## Authentication

API keys are minted in the product by anyone with Admin or Developer permissions — [API keys](/platform/admin/api-keys) covers the panel. A key is shown once at creation and never again; it belongs to the user who minted it, and every call it makes acts as that user.

Pass the key as a bearer token: `Authorization: Bearer <key>`. The organization is resolved per request from the key user's memberships — a key reaches exactly the organizations its user belongs to, nothing else. An explicit `X-Organization-Slug` header always wins and is membership-checked: a slug the user is not a member of is refused. Without the header, a single-org user lands in their one organization. A multi-org user follows the organization last active in the dashboard only on reads — any write (`POST`/`PATCH`/`PUT`/`DELETE`), and every call on the Projects and Tasks routes, must name the organization, and a multi-org request without it answers **400**. What the key may _do_ follows the key holder's role: reads and mock runs need membership, while starting live work and editing what is deployed needs the developer capability. Where that matters, the endpoint notes below say so.

## Endpoint groups

| Group             | Path                                    | What it covers                                                                                               |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Automations       | `/api/v1/automations/...`               | List, read versions, start runs, read run history, bind and unbind triggers.                                 |
| Runs              | `/api/v1/runs/{runId}`                  | One durable run in full — status, output, trace, effects — and `POST .../cancel`.                            |
| Threads           | `/api/v1/threads/...`                   | The key holder's chat threads: create, read messages, send a message, poll the turn.                         |
| Agents            | `/api/v1/agents/...`                    | List, read, create or replace, delete the organization's agents.                                             |
| Skills            | `/api/v1/skills/...`                    | Same shape as agents, for skills.                                                                            |
| Knowledge entries | `/api/v1/knowledge-entries/...`         | Topic-keyed facts: list, create, supersede, delete.                                                          |
| Knowledge search  | `POST /api/v1/knowledge/search`         | Semantic retrieval over the organization's indexed knowledge.                                                |
| Documents         | `/api/v1/documents/...`                 | Knowledge-base documents: CRUD plus `POST .../retry-indexing`. Hub only — project files live under Projects. |
| Websites          | `/api/v1/websites/...`                  | Crawled sources: CRUD plus `.../pages`, `.../sync`, `.../search`.                                            |
| Browser sessions  | `/api/v1/browser-sessions/...`          | The warmed cookie pool behind [video ingestion](/self-hosted/configuration/video-ingestion): masked list, `POST .../import` for allowlisted operators. |
| Products          | `/api/v1/products/...`                  | Product catalog entries: CRUD.                                                                               |
| Contacts          | `/api/v1/contacts/...`                  | Contact records: CRUD plus `POST /api/v1/contacts/bulk`.                                                     |
| Projects          | `/api/v1/projects/...`                  | The machine door for external workers: look up by external id, create, prepare folders, upload files.        |
| Tasks             | `/api/v1/tasks/...`                     | Idempotent task creation from an external ref, state reads, workflow starts, comments.                       |
| MCP               | `POST /api/v1/mcp`                      | The [MCP endpoint](/develop/mcp-endpoint) — same key, JSON-RPC instead of REST.                              |
| Webhook trigger   | `POST /api/automations/webhook/<token>` | Start a deployed automation from outside; the [Webhooks page](/develop/webhooks).                            |

## Automation names in URLs

An automation's name is a `/`-separated path — `billing/dunning` — and a path cannot travel inside one URL segment. In every `/api/v1/automations/{name}/...` URL, write the name with `__` in place of each `/`:

```bash
curl -sS "https://your-host.example.com/api/v1/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Responses always carry the real name (`"name": "billing/dunning"`); the `__` form exists only in URLs. Agent and skill slugs are flat and need no encoding.

## Start a run, then poll it

A run is durable and may take minutes, so starting one answers **202** with the run's identity, not its result:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "input": { "customerId": "cus_123" } }'
# → 202 { "runId": "...", "version": 2, "name": "billing/dunning", "mode": "live" }
```

Poll `GET /api/v1/runs/{runId}` until `status` leaves `queued`/`running`/`waiting`; the finished run carries `output`, the per-node `trace`, and the `effects` it produced. `POST /api/v1/runs/{runId}/cancel` stops a run at its next node boundary — work a node already completed is not undone.

`mode` defaults to `live`. A live run acts on the organization's behalf, so it needs a key whose holder has the developer capability; `{"mode": "mock"}` runs against deterministic mocks and needs only membership. Starting a run needs no trigger — the API key is the entitlement. An automation with no deployed version answers **409**; deploy a version whose tests pass and the same call goes through.

`projectId` names the project the run operates in — the project its task and document tools act on. Omit it and the run is organization-wide, except that an automation bound to a single project runs in that one automatically; an automation bound to several accepts only a `projectId` among them, and refuses any other.

## Send a message, then poll the turn

Chat is the same 202-then-poll shape. Create a thread, post a message, poll the generation, then read the messages:

```bash
# 1. A thread of your own
curl -sS -X POST "https://your-host.example.com/api/v1/threads" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Content-Type: application/json" -d '{}'
# → 201 { "id": "<threadId>" }

# 2. Send a message — on this API the model is always explicit, never auto-selected
curl -sS -X POST "https://your-host.example.com/api/v1/threads/<threadId>/messages" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "content": "Summarise this quarter for me.", "model": "<a model your org has configured>" }'
# → 202 { "threadId": "...", "status": "accepted", "model": "...", "poll": "/api/v1/threads/<threadId>/generation" }

# 3. Poll until idle, then read
curl -sS "https://your-host.example.com/api/v1/threads/<threadId>/generation" \
  -H "Authorization: Bearer $TALE_API_KEY"
# → 200 { "status": "streaming" } … then { "status": "idle" }
```

`{"status": "idle"}` means no turn is running — read `GET /api/v1/threads/{id}/messages` for the reply. A turn that fails before producing output still surfaces: the failure lands as an assistant message carrying the error, never silently. Threads listed and read over the API are the key holder's own; a second user's threads are invisible to your key even inside the same organization.

## Mirror an external system into a project

The Projects group is built for an unattended worker that mirrors an external system — a CRM, a practice-management tool — into Tale: find or create the client's project, prepare its folders, upload files, verify. Every call acts as the key's minting user: a project that user cannot see answers as if it did not exist, and writes need an editing role (Editor or above — Member is read-only here) plus edit access on the project.

These routes, and the Tasks routes below, refuse to guess the organization: a key whose user belongs to several organizations must send `X-Organization-Slug` on every call — a request without it answers **400**. Mint machine keys for a dedicated user with exactly one membership and the question never comes up; the examples keep the header anyway — it is always membership-checked, never ignored.

### Find or create the project

`externalItemId` is your key, not Tale's — an opaque string (your CRM's record id), unique per organization, never interpreted by the platform. Look it up first; the lookup answers at most one project, and a match the key's user cannot see looks exactly like no match:

```bash
curl -sS "https://your-host.example.com/api/v1/projects?externalItemId=crm-4711" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "projects": [] } — or [ { "id": "...", "name": "ACME Ltd", "externalItemId": "crm-4711" } ]
```

A match carries `archivedAt` when the project is archived — decide what your worker does with that case before it happens. An empty list means create:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "ACME Ltd", "externalItemId": "crm-4711" }'
# → 201 { "project": { "id": "...", "name": "ACME Ltd", "key": "ACME", "externalItemId": "crm-4711" } }
```

`key` (the task-identifier prefix) and `description` are optional — the key derives from the name when omitted. A second create with the same `externalItemId` answers **409**; the same string in another organization is fine, uniqueness is per organization.

### Create folders

Folder creation is get-or-create: the same name under the same parent answers the existing folder with `created: false` (**200**) instead of a duplicate, so a worker re-runs its setup step blindly after a crash. Folder names carry no platform-reserved meanings — the layout is yours:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/folders" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "2026-Q1" }'
# → 201 { "folder": { "id": "<folderId>", "name": "2026-Q1" }, "created": true }
```

`parentId` (a folder of this project) nests deeper; omit it for a root folder. `GET .../folders` lists the root folders.

### Upload a file in two steps

An upload is a handoff, then a bind. Mint the handoff first — it answers where the bytes go:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/uploads" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "contentType": "application/pdf" }'
# → 200 { "uploadId": "...", "url": "https://...", "method": "PUT", "s3Ref": "...", "expiresAt": 1774... }
```

Every blob is object-store-backed, so `url` is always a presigned `PUT`: send the bytes there with that method, with a `Content-Type` header exactly matching the `contentType` you declared when minting — the declared type is signed into the URL, so the bucket refuses a PUT that carries a different one (omit `contentType` at mint and the PUT has no header requirement) — then bind the handoff's `s3Ref` back as `fileId`. The bind completes the upload:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/files" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "uploadId": "<uploadId>", "fileId": "<s3Ref>", "folderId": "<folderId>", "fileName": "ledger-2026-q1.pdf" }'
# → 201 { "file": { "id": "...", "fileName": "ledger-2026-q1.pdf", "folderId": "<folderId>", "projectId": "<projectId>" } }
```

The `uploadId` is single-use and expires after 30 minutes — a worker that crashed mid-upload mints a fresh handoff instead of retrying the old one. Upload policy applies at the bind: an oversized blob or a type outside the allowlist is refused with **400** and a reason code.

Files that enter through this door are project working material, not organization knowledge: they skip knowledge indexing by default (`skipRagIndexing` defaults to `true` on the bind; pass `false` to opt in), and they never appear under `/api/v1/documents` — that family stays the knowledge hub's surface.

### Verify what landed

```bash
curl -sS "https://your-host.example.com/api/v1/projects/<projectId>/files?folderId=<folderId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "files": [ { "id": "...", "fileName": "ledger-2026-q1.pdf", "createdAt": 1774... } ] }
```

The listing answers `{files, cursor?}`: a `cursor` in the response means more pages — pass it back as `?cursor=`, cap the page with `?limit=` (max 100).

## Materialize a task, then run it

The Tasks group closes the loop: the worker turns an external item into a task on the project's board, starts a deployed workflow on it, and reports back. One prerequisite when the automation is project-scoped: its binding set decides where it may run, so a freshly created project needs the automation bound to it once. That, too, is an API call — idempotent (**201** on the first bind, **200** when the binding already exists), and it requires the developer capability, the same gate the dashboard's binding panel applies. Mint the worker's key for a user with that capability, or bind ahead of time:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/automations/vat-return/projects" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "projectId": "<projectId>" }'
# → 201 { "name": "vat-return", "added": true }
```

An automation with no bindings at all is org-level and needs none of this — every project sees it. Unbinding stays a dashboard operation.

Task creation is idempotent per `(projectId, externalSystem, externalId)` — the first call creates (**201**, `created: true`), every repeat answers the same task (**200**, `created: false`) — so a worker that crashed after POSTing retries safely. `projectId` is required; this door never falls back to an org-wide default.

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/tasks" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "projectId": "<projectId>", "externalSystem": "crm", "externalId": "case-991", "title": "Prepare the Q1 filing" }'
# → 201 { "task": { "id": "<taskId>", "created": true } }
```

`description`, `labels`, and `externalUrl` are optional. Send `automationSlug` when the task belongs to an automation: it becomes the assignee, and the task modal's work panel — the Start button, run progress, and the operator questions a run asks — keys on that ownership (a later re-pick fills a missing attribution, but never overwrites an assignee). `runWorkflowSlug` starts a deployed workflow on a newly created task in the same call — the run starts inline, so the response carries its `executionId` (the run id to poll), or `executionId: null` when the slug names no deployed automation. Start explicitly instead when you want to name the workflow in a separate call:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/tasks/<taskId>/start" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "workflowSlug": "vat-return" }'
# → 200 { "started": true, "executionId": "<runId>" }
```

The run's input is the task itself, so starting needs membership and the task's visibility, not the developer capability — deploying the workflow was the privileged act, and the run log attributes the start to your key. Poll the run at the familiar `GET /api/v1/runs/{runId}`. `started: false` carries a `reason`: `already_running` answers the in-flight run's `executionId` instead of racing a duplicate — poll that one; `not_started` means the slug names no deployed automation.

Report back and read state — the comment posts as the key's minting user, indistinguishable from the same person commenting in the app, @mentions included:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/tasks/<taskId>/comments" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "body": "Filed. Confirmation 2026-8842." }'
# → 201 { "comment": { "id": "..." } }

curl -sS "https://your-host.example.com/api/v1/tasks/<taskId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "task": { "id": "<taskId>", "title": "...", "status": "in_progress", "externalId": "case-991", "labels": [], ... } }
```

And fetch the results. What the automation reported lands in the task's discussion; what it filed lands as files in the quarter's folder — both readable through the door. The discussion comes newest page first (`limit`, default 200, at most 500), chronological within the page; while `isDone` is `false`, pass `continueCursor` back as `cursor` to read the older comments. The content endpoint answers a **302** to a short-lived presigned URL for the stored blob, so follow redirects:

```bash
curl -sS "https://your-host.example.com/api/v1/tasks/<taskId>/comments?limit=100" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "comments": [ { "id": "...", "authorType": "agent", "body": "Return prepared — key figures…", ... } ], "isDone": false, "continueCursor": "312" }

curl -sSL "https://your-host.example.com/api/v1/projects/<projectId>/files/<documentId>/content" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -o report.md
# → the file bytes (Content-Disposition carries the filename)
```

## Error model

Every non-2xx response carries one flat envelope:

```json
{ "error": "Automation not found" }
```

Branch on the HTTP status; the message is for humans:

- **400** — malformed request: a missing required field, a wrong type, an unparseable body — or a multi-org key that did not name its organization (required on every write, and on all project and task routes).
- **401** — missing or invalid API key.
- **403** — the key is valid but its holder's role lacks the capability (live runs, trigger writes, cancels).
- **404** — the resource does not exist in your organization, belongs to someone else's thread, or is a project or task the key's user cannot see — deliberately indistinguishable from one that does not exist.
- **409** — the state refuses the action: no deployed version, a duplicate topic, email, or `externalItemId` (unique per organization — the same string in another organization is fine), a turn already running.
- **413** — the body is too large; only the webhook trigger returns it, at its 256 KB cap. An uploaded file that breaks the size or type policy is refused at the bind with **400** and a reason code instead.
- **429** — rate limit exceeded; the response carries `Retry-After` in whole seconds — see [Rate limits](/develop/rate-limits).
- **500** — internal error.

Two deletion semantics exist, on purpose. Unbinding an automation's trigger (`DELETE .../triggers`) answers **204** whether or not a trigger existed — it is an idempotent "make it so". Deleting a resource (`DELETE /api/v1/agents/{slug}`) answers **404** when nothing existed — you asked to remove a thing that is not there.

## Versioning

The API is versioned by URL prefix — today `/api/v1/` — and evolves additively inside it: new endpoints and new optional fields appear, existing shapes stay. A breaking change would ship under a new prefix. The OpenAPI document at `/docs` always describes the running instance.

## Where this fits

This page is the REST half of the outside surface. The [MCP endpoint](/develop/mcp-endpoint) exposes the same platform to MCP clients — automation authoring lives there, not in REST. The [Webhooks page](/develop/webhooks) covers the inbound trigger that starts runs without a key. If you are building inside the product — project agents, automations — the [Platform tab](/platform) is your day-to-day; this page is for outside.
