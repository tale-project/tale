---
title: API reference
description: How to call Tale from outside — authentication, the endpoint inventory, pagination, the async run and turn loops, and the error model.
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

## Sign in to an application with Tale

Tale is also an OpenID Connect issuer. A registered application sends you through Tale's native login and consent; it receives a signed identity with a verified email and membership in the one organization bound to its client. An API key does not authenticate a person for this flow.

Register the application with an active Owner or Admin session whose selected organization equals `TALE_ORG_ID`. `TALE_ORIGIN` is your Tale origin and `TALE_SESSION_COOKIE` is that session's cookie header. Use the application's exact HTTPS callback; HTTP is accepted only on loopback for local development:

```bash
curl -sS -X POST "$TALE_ORIGIN/api/app/identity/clients?orgId=$TALE_ORG_ID" \
  -H "Cookie: $TALE_SESSION_COOKIE" \
  -H "Origin: $TALE_ORIGIN" \
  -H "Content-Type: application/json" \
  -d '{"key":"office-app","name":"Office application","redirectUri":"https://office.example.com/api/auth/oauth2/callback/tale"}'
```

The first response is **201** with `{ "created": true, "client": { "client_id": "…", "client_secret": "…", … } }`. Store the secret in the application's secret environment. Repeating the same key and configuration returns **200**, `created: false`, and the same client ID without the secret. A changed callback or policy returns **409** so a rerun cannot silently redirect an existing integration.

| Purpose | Endpoint or requirement |
| --- | --- |
| Issuer | `https://your-host.example.com/api/auth` |
| Discovery | `GET /api/auth/.well-known/openid-configuration` |
| Authorization | `GET /api/auth/oauth2/authorize` |
| Code exchange | `POST /api/auth/oauth2/token`, `client_secret_post` |
| Signing keys | `GET /api/auth/jwks` |
| Current identity | `GET /api/auth/oauth2/userinfo`, bearer access token |
| Requested scopes | `openid profile email tale:organization` |

Use a maintained OIDC client with authorization code flow, S256 PKCE, one-use state and a nonce. Validate the issuer, audience, RS256 signature, expiry and nonce of the ID token, then require `email_verified: true`. The `https://tale.dev/organization` claim contains `{ "id", "slug", "role" }` for the registered organization. Tale rechecks current membership and native MFA enforcement before issuing tokens and when reading userinfo; the application remains responsible for its own account access policy. Codes expire after 60 seconds and can be redeemed once; access and ID tokens expire after five minutes. Dynamic registration, implicit grants and refresh tokens are disabled.

Access tokens serve only native userinfo; external resource audiences are disabled. Use native API keys for REST requests.

For a reviewed client key, `POST /api/app/identity/clients/office-app/rotate-secret?orgId=<orgId>` with `{}` returns a new `client_secret` once and retires the old secret. `POST /api/app/identity/clients/office-app/status?orgId=<orgId>` with `{ "disabled": true }` blocks new authorizations; `false` restores the same client. Both require the same current organization, administrator session, Origin header and JSON content type as registration. Deleting an organization removes its clients and consent grants.

## Endpoint groups

| Group             | Path                                    | What it covers                                                                                               |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Automations       | `/api/v1/automations/...`               | List, read versions, start runs, read run history, bind and unbind triggers.                                 |
| Runs              | `/api/v1/runs/{runId}`                  | One durable run in full — status, output, trace, effects — and `POST .../cancel`.                            |
| Threads           | `/api/v1/threads/...`                   | The key holder's chat threads: create, read messages, send a message, poll the turn.                         |
| Models | `GET /api/v1/models` | Configured chat models available to the key holder in this organization. |
| Agents | `/api/v1/projects/{id}/agents/...` | List, read, create, update and delete agents within the required project. |
| Skills | `/api/v1/skills/...` | List, read, create or update, and delete organization skill bundles. |
| Knowledge entries | `/api/v1/knowledge-entries/...`         | Topic-keyed facts: list, create, supersede, delete.                                                          |
| Knowledge search  | `POST /api/v1/knowledge/search`         | Semantic retrieval over the organization's indexed knowledge.                                                |
| Documents         | `/api/v1/documents/...`                 | Knowledge-base documents: CRUD plus `POST .../retry-indexing`. Hub only — project files live under Projects. |
| Websites          | `/api/v1/websites/...`                  | Crawled sources: CRUD plus `.../pages`, `.../sync`, `.../search`.                                            |
| Browser sessions  | `/api/v1/browser-sessions/...`          | The warmed cookie pool behind [video ingestion](/self-hosted/configuration/video-ingestion): masked list, `POST .../import` for allowlisted operators. |
| Products          | `/api/v1/products/...`                  | Product catalog entries: CRUD.                                                                               |
| Contacts          | `/api/v1/contacts/...`                  | Contact records: CRUD plus `POST /api/v1/contacts/bulk`.                                                     |
| Conversations | `/api/v1/conversations/...` | Mirror external conversations into Inbox, read messages, claim replies and acknowledge delivery; exact schemas are in the running instance’s `/docs`. |
| Projects          | `/api/v1/projects/...`                  | The machine door for external workers: look up by external id, create, prepare folders, upload files.        |
| Tasks             | `/api/v1/tasks/...`                     | Idempotent task creation from an external ref, state reads, workflow starts, comments.                       |
| MCP               | `POST /api/v1/mcp`                      | The [MCP endpoint](/develop/mcp-endpoint) — same key, JSON-RPC instead of REST.                              |
| Webhook trigger   | `POST /api/automations/webhook/<token>` | Start a deployed automation from outside; the [Webhooks page](/develop/webhooks).                            |

For contact updates, pass the last read `updatedAt` as optional `expectedUpdatedAt` in `PATCH /api/v1/contacts/{id}`. A concurrent edit returns **409**, `CONTACT_STALE`; reload the contact and merge your changes before retrying.

Skills support `org` and `team` visibility; `teams` must name teams in this organization. `private` skill visibility is retired.

For a hub document, send inline `content` to `POST /api/v1/documents`. Its `fileId` alternative requires an existing hub upload from the app; REST does not mint one, and project uploads cannot be used as hub uploads. Trashed or expired documents, including files from a deleted project, stay out of this hub surface.

## Manage a project's agents

Every agent belongs to a project. The project ID is required in the URL for every operation; responses include both `projectId` and the agent's `id`. These are the same agents managed in the project's **Agents** tab, with the same access rules.

| Operation | Route | Success |
| --- | --- | --- |
| List the roster | `GET /api/v1/projects/{id}/agents` | `200 {agents}` |
| Create | `POST /api/v1/projects/{id}/agents` | `201 {agent}` |
| Read | `GET /api/v1/projects/{id}/agents/{agentId}` | `200 {agent}` |
| Save full configuration | `PUT /api/v1/projects/{id}/agents/{agentId}` | `200 {agent}` |
| Delete | `DELETE /api/v1/projects/{id}/agents/{agentId}` | `204` |

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

`POST` and `PUT` require `name`, `harness`, `model`, `skills` and `connectors`. Optional fields are `modelProvider`, `tools`, `secrets` and `instructions`. A `PUT` saves the full configuration: omitted provider/instructions reset to `null`, and omitted tools/secrets reset to empty lists. It updates an existing agent; it does not create one at an unknown ID.

A project holds at most 50 agents. Names are unique within the project without regard to case, up to 120 characters; each equipment list allows 25 entries and instructions allow 20,000 characters. An invalid configuration, duplicate name or exceeded limit answers **400**. `secrets` contains organization secret names, never values; unknown names are pruned. Only organization Owners and Admins may change secret grants, so an editor's full save must preserve existing grants.

Project readers can read the roster; writes require project edit access and an active project. An invisible or missing project, or an agent ID from another project, answers **404**. A multi-organization key must include `X-Organization-Slug` on reads and writes. [Project agents](/platform/projects/project-agents) explains how these agents work on tasks; direct chat keeps using the built-in assistant.

## Automation names in URLs

An automation's name is a `/`-separated path — `billing/dunning` — and a path cannot travel inside one URL segment. In every `/api/v1/automations/{name}/...` URL, write the name with `__` in place of each `/`:

```bash
curl -sS "https://your-host.example.com/api/v1/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Responses always carry the real name (`"name": "billing/dunning"`); the `__` form exists only in URLs. Skill slugs are flat and need no encoding. Project agents use their project ID and agent ID.

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

An unknown automation answers **404**. A live run can only use the deployed `version`; naming another saved version answers **409**. Use `mode: "mock"` to test another saved version. A missing body means `{}`, but malformed JSON answers **400** and starts nothing. When the automation declares an `inputs` schema, the input must match it before a run is created.

`projectId` names the project the run operates in — the project its task and document tools act on. Omit it and the run is organization-wide, except that an automation bound to a single project runs in that one automatically; an automation bound to several accepts only a `projectId` among them, and refuses any other.

## Send a message, then poll the turn

Chat is the same 202-then-poll shape. Create a thread, post a message, poll the generation, then read the messages:

List models before sending a message. Use an entry’s `id` as `model` and its `providerSlug` to select the provider. The list respects the organization’s model-access policy and includes only models callable directly through REST; an empty list means no chat model is available to this key holder.

```bash
curl -sS "https://your-host.example.com/api/v1/models" \
  -H "Authorization: Bearer $TALE_API_KEY"
# No available model → 200 { "models": [] }
```

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
  -d '{ "content": "Summarise this quarter for me.", "model": "<model-id>", "providerSlug": "<provider-slug>" }'
# → 202 { "threadId": "...", "status": "accepted", "model": "...", "poll": "/api/v1/threads/<threadId>/generation" }

# 3. Poll until idle, then read
curl -sS "https://your-host.example.com/api/v1/threads/<threadId>/generation" \
  -H "Authorization: Bearer $TALE_API_KEY"
# → 200 { "status": "streaming" } … then { "status": "idle" }
```

`{"status": "idle"}` means no turn is running — read `GET /api/v1/threads/{id}/messages` for the reply. A turn that fails before producing output still surfaces: the failure lands as an assistant message carrying the error, never silently. Threads listed and read over the API are the key holder's own; a second user's threads are invisible to your key even inside the same organization.

A failed turn keeps your submitted message and appends an assistant error. The REST message has readable `error` text and an `errorCode` when a classification is available. Direct threads use the built-in assistant. Optional `projectId` adds project context; agent selectors such as `agentSlug` or `agentId` are refused with **400**.

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

An explicit project `key` contains 2–6 letters or digits and is normalized to uppercase; invalid keys answer **400**, without truncation. A name that yields no valid key creates a keyless project. A key collision answers **409**; supply an unused key.

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

Repeating an active task’s external reference updates its title and description; omitting `description` clears it. Labels change only when supplied. An archived task stays unchanged. The task id stays the same, and `runWorkflowSlug` does not start another run on that repeat. Keep the repeated payload stable when retrying after a lost response.

`description`, `labels`, and `externalUrl` are optional. Send `automationSlug` when the task belongs to an automation: it becomes the assignee, and the task modal's work panel — the Start button, run progress, and the operator questions a run asks — keys on that ownership (a later re-pick fills a missing attribution, but never overwrites an assignee). `runWorkflowSlug` starts a deployed workflow on a newly created task in the same call — the run starts inline, so the response carries its `executionId` (the run id to poll), or `executionId: null` when the slug names no deployed automation. Start explicitly instead when you want to name the workflow in a separate call:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/tasks/<taskId>/start" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "workflowSlug": "vat-return" }'
# → 200 { "started": true, "executionId": "<runId>" }
```

The run’s input wraps the task as `{task: ...}`, so starting needs membership and the task's visibility, not the developer capability — deploying the workflow was the privileged act, and the run log attributes the start to your key. Poll the run at the familiar `GET /api/v1/runs/{runId}`. `started: false` carries a `reason`: `already_running` answers the in-flight run's `executionId` instead of racing a duplicate — poll that one; `not_started` means the slug names no deployed automation.

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

Unbinding a trigger from an existing automation (`DELETE .../triggers`) answers **204** whether or not a trigger was bound; an unknown automation answers **404**. Deleting a resource answers **404** when it is absent, including a contact already moved to trash or a knowledge entry already deleted. Cancelling an unknown run also answers **404**; `{cancelled: false}` means the run exists but has already finished.

## Versioning

The API is versioned by URL prefix — today `/api/v1/` — and evolves additively inside it: new endpoints and new optional fields appear, existing shapes stay. A breaking change would ship under a new prefix. The OpenAPI document at `/docs` always describes the running instance.

## Where this fits

This page is the REST half of the outside surface. The [MCP endpoint](/develop/mcp-endpoint) exposes the same platform to MCP clients — automation authoring lives there, not in REST. The [Webhooks page](/develop/webhooks) covers the inbound trigger that starts runs without a key. If you are building inside the product — project agents, automations — the [Platform tab](/platform) is your day-to-day; this page is for outside.
