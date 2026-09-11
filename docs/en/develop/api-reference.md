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
curl -sS "https://your-host.example.com/api/v1/automations" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

A successful response is a named list: `{ "automations": [ { "name": "billing/dunning", "latestVersion": 3, "deployedVersion": 2 } ] }`. List shapes vary by family: most answer a named array like this one, while the knowledge and chat resources — contacts, products, documents, knowledge entries, threads, websites — answer a `{ "page": [...], "isDone": ..., "continueCursor": ... }` page envelope. Where a page envelope paginates, pass `continueCursor` back as `?cursor=` and cap the page with `?limit=`: contacts, products, documents, knowledge entries, threads, and websites all page this way to the last page (`isDone: true` with an empty `continueCursor`). An automation's run listing is a bounded window instead — `?limit=` (1..200, default 50) picks how many of the newest runs you get. The Projects machine door travels lighter still — its section shows those shapes.

## Authentication

API keys are minted in the product by anyone with Admin or Developer permissions — [API keys](/platform/admin/api-keys) covers the panel. A key is shown once at creation and never again; it belongs to the user who minted it, and every call it makes acts as that user.

Pass the key as a bearer token: `Authorization: Bearer <key>`. Every request acts as the key holder in an organization they belong to. An explicit `X-Organization-Slug` header selects that organization and is always membership-checked. A user with one membership can omit it. A user with several must include it on every write, every `/api/v1/projects/...` call and every conversation call, reads included; otherwise the API answers **400**, `ORG_SLUG_REQUIRED`. Other reads can use the organization last active in the dashboard, and `GET /api/v1/me` answers the slugs a key may send. Every operation in the OpenAPI document declares the header. Project access and the operation determine the required permissions: project readers can chat and comment, while changing project resources or starting task workflows needs project edit access. Arbitrary live automation runs also require the developer capability. The sections below give the operation-specific rules.

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

Errors follow RFC 6749 and RFC 6750 — what a maintained client expects. `userinfo` answers **401** `invalid_token` with a `WWW-Authenticate: Bearer` challenge for an invalid or expired access token — every five-minute expiry walks this path, so treat it as a sign-in, not a retry — and **401** with the bare challenge when the token is missing; a token without the `openid` scope answers **403** `insufficient_scope`. The token and authorization endpoints answer `{ "error", "error_description" }`: a grant other than `authorization_code` is `unsupported_grant_type`, a malformed request `invalid_request`. Discovery lists `https://tale.dev/organization` under `claims_supported`; it also advertises the provider's introspection, revocation and end-session endpoints, which the flow above does not need.

For a reviewed client key, `POST /api/app/identity/clients/office-app/rotate-secret?orgId=<orgId>` with `{}` returns a new `client_secret` once and retires the old secret. `POST /api/app/identity/clients/office-app/status?orgId=<orgId>` with `{ "disabled": true }` blocks new authorizations; `false` restores the same client. Both require the same current organization, administrator session, Origin header and JSON content type as registration. Deleting an organization removes its clients and consent grants.

## Endpoint groups

For a project resource under `/api/v1`, put its project ID in the URL. These request bodies do not accept `projectId`; strict schemas reject it with **400**. The resource must belong to the named project and be visible to the key holder, otherwise the call answers **404**. Responses may include `projectId` as resource metadata. Organization catalogs, such as automation definitions and skill bundles, keep their organization paths.

| Group             | Path                                    | What it covers                                                                                               |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Automations | `/api/v1/automations/...` | Organization definitions, versions, triggers and the projects each is installed in; delete a definition; start and list runs that have no project. |
| Project automations | `/api/v1/projects/{id}/automations/...` | List installed automations, install or uninstall one, start and list this project's runs. |
| Runs | `/api/v1/projects/{id}/runs/{runId}` or `/api/v1/runs/{runId}` | Status, output, trace, effects and `POST .../cancel`; use the project path for a project run. |
| Threads | `/api/v1/projects/{id}/threads/...` or `/api/v1/threads/...` | The key holder's project chats or chats with no project: list, create, read, archive or restore, delete, send messages, poll the turn and cancel it. |
| Models | `GET /api/v1/models` | Configured chat models available to the key holder in this organization, with context window, output cap, capabilities, price and the organization's default pick. |
| Agents | `/api/v1/projects/{id}/agents/...` | List, read, create, update and delete agents within the required project. |
| Skills | `/api/v1/skills/...` | List, read, create or update, and delete organization skill bundles. |
| Knowledge entries | `/api/v1/knowledge-entries/...`         | Topic-keyed facts: list, create, supersede, delete.                                                          |
| Knowledge search | `POST /api/v1/projects/{id}/knowledge/search` or `POST /api/v1/knowledge/search` | Search one project's indexed files, or visible non-project Hub documents and websites. |
| Documents         | `/api/v1/documents/...`                 | Knowledge-base documents: CRUD plus `POST .../retry-indexing`. Hub only — project files live under Projects. |
| Websites          | `/api/v1/websites/...`                  | Crawled sources: CRUD plus `.../pages`, `.../sync`, `.../search`.                                            |
| Browser sessions  | `/api/v1/browser-sessions/...`          | The warmed cookie pool behind [video ingestion](/self-hosted/configuration/video-ingestion): masked list, `POST .../import` for allowlisted operators. |
| Products          | `/api/v1/products/...`                  | Product catalog entries: CRUD.                                                                               |
| Contacts          | `/api/v1/contacts/...`                  | Contact records: CRUD plus `POST /api/v1/contacts/bulk`.                                                     |
| Conversations | `/api/v1/conversations/...` | Mirror external conversations into Inbox, read messages, claim replies and acknowledge delivery; exact schemas are in the running instance’s `/docs`. |
| Projects          | `/api/v1/projects/...`                  | The machine door for external workers: look up by external id, create, prepare folders, upload files.        |
| Tasks | `/api/v1/projects/{id}/tasks/...` | Idempotent task creation from an external ref, state reads, workflow starts and comments within the named project. |
| MCP               | `POST /api/v1/mcp`                      | The [MCP endpoint](/develop/mcp-endpoint) — same key, JSON-RPC instead of REST.                              |
| Webhook trigger | `POST /api/projects/{id}/automations/webhook/{token}` or `POST /api/automations/webhook/{token}` | Start a deployed automation using its token; the [Webhooks page](/develop/webhooks) covers project and non-project URLs. |

For contact updates, pass the last read `updatedAt` as optional `expectedUpdatedAt` in `PATCH /api/v1/contacts/{id}`. A concurrent edit returns **409**, `CONTACT_STALE`; reload the contact and merge your changes before retrying.

Skills support `org` and `team` visibility; `teams` must name teams in this organization. `private` skill visibility is retired.

For a hub document, send inline `content` to `POST /api/v1/documents`. Inline content is stored and readable but never indexed: knowledge search finds only documents backed by an uploaded file, and `POST .../retry-indexing` answers `{"status": "skipped", "reason": "content-only"}` for one without (the other skip reasons are `untracked-blob` and `rag-opt-out`). Its `fileId` alternative requires the key holder's own unbound Hub upload in the selected organization, created through the app; REST does not mint one. An upload already attached to any document, thread or conversation cannot be reused here. A missing upload, another user's upload or a bound upload answers **404**, `FILE_NOT_FOUND`. Project, chat and conversation uploads cannot become Hub documents through this route. Trashed or expired documents, including files from a deleted project, stay out of this Hub surface. `POST` and `PATCH` bodies are strict: `projectId` is refused with **400**. Create project files through the project upload and file routes below.

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

A project holds at most 50 agents. Names are unique within the project without regard to case, up to 120 characters; each equipment list allows 25 entries and instructions allow 20,000 characters. An invalid configuration, duplicate name or exceeded limit answers **400**. `model` must be a model the organization's catalog lists (name `modelProvider` when several providers serve it) and `tools` must name known tool grants — a wrong value answers **400** with `PROJECT_AGENT_MODEL_INVALID`, `PROJECT_AGENT_PROVIDER_UNKNOWN` or `PROJECT_AGENT_TOOL_UNKNOWN` naming what to fix, instead of an agent that fails at its first task. `secrets` contains organization secret names, never values; unknown names are pruned. Only organization Owners and Admins may change secret grants, so an editor's full save must preserve existing grants.

Project readers can read the roster; writes require project edit access and an active project. An invisible or missing project, or an agent ID from another project, answers **404**. A multi-organization key must include `X-Organization-Slug` on reads and writes. [Project agents](/platform/projects/project-agents) explains how these agents work on tasks; direct chat keeps using the built-in assistant.

## Automation names in URLs

An automation's name is a `/`-separated path — `billing/dunning` — and a path cannot travel inside one URL segment. In every `.../automations/{name}/...` URL, write the name with `__` in place of each `/`:

```bash
curl -sS "https://your-host.example.com/api/v1/automations/billing__dunning/versions" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Responses always carry the real name (`"name": "billing/dunning"`); the `__` form exists only in URLs. Skill slugs are flat and need no encoding. Project agents use their project ID and agent ID.

`GET /api/v1/automations` lists each automation with its `latestVersion`, `deployedVersion` and `projectIds` — the projects it is installed in, which the run routes below require. `DELETE /api/v1/automations/{name}` removes the automation, its versions, triggers and project bindings included, and answers **409** `AUTOMATION_HAS_ACTIVE_RUNS` while a run is in flight. Both need the developer capability.

## Start a run, then poll it

A run is durable and may take minutes, so starting one answers **202** with the run's identity, not its result:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "input": { "customerId": "cus_123" } }'
# → 202 { "runId": "...", "version": 2, "name": "billing/dunning", "mode": "live" }
```

Poll `GET /api/v1/projects/{id}/runs/{runId}` until `status` leaves `queued`/`running`/`waiting`; the finished run carries `output`, the per-node `trace`, and the `effects` it produced. `POST /api/v1/projects/{id}/runs/{runId}/cancel` stops a run at its next node boundary — work a node already completed is not undone.

`mode` defaults to `live`; arbitrary live runs and run cancellation require the developer capability. Project runs also require edit access to an active project, including `mode: "mock"`. Mock runs use deterministic mocks; a non-project mock run needs only membership. Starting a run needs no trigger. An automation with no deployed version answers **409** unless a saved version is explicitly selected for a mock run.

An unknown automation answers **404**. A live run can only use the deployed `version`; naming another saved version answers **409**. Use `mode: "mock"` to test another saved version. A missing body means `{}`, but malformed JSON answers **400** and starts nothing. When the automation declares an `inputs` schema, the input must match it before a run is created.

The project in the URL is the context for the run's task and document tools. An automation with project bindings can run only in a bound project. `GET /api/v1/projects/{id}/automations/{name}/runs` lists that project's history. For an automation with no bindings, `POST /api/v1/automations/{name}/runs` starts a non-project run; a bound automation answers **409** there. Global run lists and `/api/v1/runs/{runId}` expose only non-project runs. A project run requires its project URL for both reading and cancellation.

## Send a message, then poll the turn

Project chat follows the same 202-then-poll shape. Use a project you can read, create a thread, post a message, poll the generation, then read the messages:

List models before sending a message. Each entry carries what a client needs to choose — `contextWindow`, `maxOutputTokens`, `capabilities` (`tools`, `vision`, `reasoning`), `pricing` when the catalog publishes one, `tags` — and `default: true` marks the organization’s pick for this key holder. Use an entry’s `id` as `model`; add its `providerSlug` when the same id is listed under more than one provider. The list respects the organization’s model-access policy and includes only models callable directly through REST; an empty list means no chat model is available to this key holder. The pair is checked on send, at the door: an id the list does not carry answers **400**, `CHAT_MODEL_UNKNOWN`; an id several providers serve, with none named, **400**, `CHAT_MODEL_AMBIGUOUS` with the candidates in `data.providers`; a `providerSlug` the list does not carry **400**, `CHAT_PROVIDER_UNKNOWN`, and one that does not serve the chosen `model` **400**, `CHAT_MODEL_NOT_ON_PROVIDER`. The 202 names the provider the turn runs on, and the turn never falls back to another provider behind your back.

```bash
curl -sS "https://your-host.example.com/api/v1/models" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# No available model → 200 { "models": [] }
```

```bash
# 1. A thread of your own
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/threads" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" -d '{}'
# → 201 { "id": "<threadId>" }

# 2. Send a message — on this API the model is always explicit, never auto-selected
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/threads/<threadId>/messages" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "content": "Summarise this quarter for me.", "model": "<model-id>", "providerSlug": "<provider-slug>" }'
# → 202 { "threadId": "...", "status": "accepted", "model": "...", "providerSlug": "...", "poll": "/api/v1/projects/<projectId>/threads/<threadId>/generation" }

# 3. Poll until idle, then read
curl -sS "https://your-host.example.com/api/v1/projects/<projectId>/threads/<threadId>/generation" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "status": "streaming" } … then { "status": "idle" }
```

`{"status": "idle"}` means no turn is running. Read `GET /api/v1/projects/{id}/threads/{threadId}/messages` for the reply. Lists, thread details, messages and generation status contain only the key holder's own threads in that project; another user's thread stays invisible even if you both belong to the project. List with `GET /api/v1/projects/{id}/threads` and read a thread with `GET /api/v1/projects/{id}/threads/{threadId}`.

`content` is trimmed before it is checked, so a blank prompt answers **400** instead of spending a turn; `locale` is a BCP 47 tag (`de`, `en-GB`) naming the language the assistant answers in. Every message carries a `status`: while a turn runs, its assistant row is already on the page as `pending` with empty `parts` — the row `.../generation` names as `messageId` — and settles to `complete`, or to `failed` with `error` and `errorCode`, when the turn ends, with the token counters in `usage`. `parts` is an ordered list discriminated by `type` — `text`, `reasoning`, `attachment`, `tool-call`, `tool-result`, `approval`, `human-input` — and the OpenAPI document types each kind. A `reasoning` part is the model’s thinking and may quote the assistant’s own instructions: display it as such, never as the answer. The vocabulary is additive, so render a kind you do not know as opaque.

For a personal chat with no project, use `/api/v1/threads` and its corresponding detail, messages and generation paths. Those URLs cannot address project threads. A wrong project URL answers **404**. Both kinds use the built-in assistant; `projectId`, `agentSlug` and `agentId` in create or message bodies answer **400**. Project readers, including Members, may create and send; an archived project refuses these writes with **403**. An archived thread refuses a message with **409**, `CHAT_THREAD_ARCHIVED`, a sandbox thread with **409**, `CHAT_THREAD_NOT_DIRECT`, and a thread whose turn is still running with **409**, `CHAT_TURN_IN_PROGRESS` — retry the last one once the poll says idle, never the other two.

The lifecycle is yours through the same URLs. `PATCH .../threads/{threadId}` with `{ "archived": true }` archives a thread out of the way and `false` restores it; `DELETE .../threads/{threadId}` moves it to the trash (**409**, `CHAT_TURN_IN_PROGRESS` while a turn runs); `DELETE .../threads/{threadId}/generation` asks the running turn to stop — **202** `{ "status": "cancelling" }`, then poll until idle; **404**, `CHAT_TURN_NOT_RUNNING` when nothing runs. An archived project refuses all three with **403**.

A model failure can appear as an assistant message with readable `error` text and, when available, `errorCode`. The model list is the organization’s configured catalog, not a promise from the provider’s account, so two codes mean the account rather than the request: `credit_exhausted` (the balance is spent) and `model_not_entitled` (the provider’s plan excludes this model). Pick another model or fix the account — waiting changes nothing, and neither is a `rate_limited`. The worker rechecks the accepted thread and project access before opening the turn. If the thread moves projects or access is lost while the request waits, it does not run or append an error in the new scope.

## Search a project's files

Use the project search URL when results must come from one project. It searches only that project's indexed files and requires read access, including for an archived project. Hub or team documents, other projects, websites and email attachments are outside this search. Omit `corpus` or set it to `"documents"`; any other corpus or a `projectId` body field answers **400**.

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/knowledge/search" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "query": "Q1 filing deadline", "limit": 10 }'
```

The body requires `query` and also accepts `limit` (1–50) and `minSimilarity` (0–1). Each hit carries its passage, its `score` and its `source`; a documents hit also carries `source.documentId` — the id the file and document routes take — beside the blob `ref` the index keys it by. A missing embedding model answers **409**, `EMBEDDING_NOT_CONFIGURED`; so does an embedding provider that refuses for account reasons — a spent balance, a spend limit, or a plan that excludes the model — as **409**, `EMBEDDING_CREDIT_EXHAUSTED`; a credential the provider rejects, or one it refuses the model, is **409**, `EMBEDDING_CREDENTIAL_REJECTED` — fix the provider settings. Neither is a rate limit: no wait lifts them, an admin has to act. Any other provider failure answers **503**, `EMBEDDING_UPSTREAM_ERROR`, with `Retry-After` — retry that one with backoff. To search visible non-project Hub and team documents or registered websites instead, use `POST /api/v1/knowledge/search` with `corpus` set to `"documents"`, `"web"` or `"all"` (the default). That URL excludes project files and email attachments. Both URLs find file-backed documents only — a document created with inline `content` never indexes.

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

An explicit project `key` contains 2–6 letters or digits and is normalized to uppercase; invalid keys answer **400**, without truncation. A name that yields no valid key creates a keyless project. A derived key that collides is re-derived until it is free; an explicit key that collides answers **409**, `PROJECT_KEY_TAKEN` — supply an unused one. The same `externalItemId` twice is **409**, `PROJECT_DUPLICATE_EXTERNAL_ID`.

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

The `uploadId` is single-use and expires after 30 minutes, and the presigned `url` expires with it — `expiresAt` is the one deadline for both — so a worker that crashed mid-upload mints a fresh handoff instead of retrying the old one. `fileName` is a plain name: a path separator or a control character in it answers **400**. Upload policy applies at the bind: an oversized blob or a type outside the allowlist is refused with **400** and a reason code.

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

The Tasks group turns an external item into a task on a project's board, starts a deployed workflow on it and reports back. A project-bound automation must be installed in this project first. Installing is idempotent: **201** on the first call, **200** when the binding exists. It requires the developer capability and edit access to an active project. Bind ahead of time if the worker's user lacks those permissions:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/automations/vat-return" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{}'
# → 201 { "name": "vat-return", "added": true }
```

`GET /api/v1/projects/{id}/automations` lists the automations installed in that project. An automation without any project bindings can also run in an accessible project when the caller has the required edit permissions, but it is not part of that installed list. `DELETE /api/v1/projects/{id}/automations/{name}` uninstalls one again — **204**, or **404** `AUTOMATION_NOT_INSTALLED` when it was not installed there — under the same developer capability and edit access.

Task creation is idempotent per `(projectId, externalSystem, externalId)`: the first call creates (**201**, `created: true`), and a repeat answers with the same task (**200**, `created: false`). Take `projectId` from the URL; sending it in the body answers **400**. Creating a task requires edit access to an active project.

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "externalSystem": "crm", "externalId": "case-991", "title": "Prepare the Q1 filing" }'
# → 201 { "task": { "id": "<taskId>", "created": true } }
```

Repeating an active task’s external reference updates its title and description; omitting `description` clears it. Labels change only when supplied. An archived task stays unchanged. The task id stays the same, and `runWorkflowSlug` does not start another run on that repeat. Keep the repeated payload stable when retrying after a lost response.

`description`, `labels`, and `externalUrl` are optional; `title` takes up to 200 characters and `externalUrl` must be an absolute `http(s)` URL — a longer title or another scheme answers **400** rather than a silently altered task. Send `automationSlug` when the task belongs to an automation: it becomes the assignee, and the task modal's work panel — the Start button, run progress, and the operator questions a run asks — keys on that ownership (a later re-pick fills a missing attribution, but never overwrites an assignee). `runWorkflowSlug` starts a deployed workflow on a newly created task in the same call — the run starts inline, so the response carries its `executionId` (the run id to poll), or `executionId: null` when the slug names no deployed automation. Start explicitly instead when you want to name the workflow in a separate call. The owning `automationSlug` must name a deployed automation, otherwise the call answers **404**. A workflow bound to other projects answers **403**.

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/start" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "workflowSlug": "vat-return" }'
# → 200 { "started": true, "executionId": "<runId>" }
```

Starting requires edit access to an active project and an active task. It wraps the task as `{task: ...}` and needs no additional developer capability; the run log attributes the start to your key. Poll `GET /api/v1/projects/{id}/runs/{runId}`. With `started: false`, `reason: "already_running"` carries the in-flight run's `executionId`; poll that run. `reason: "not_started"` means the slug names no deployed automation.

Report back and read state — the comment posts as the key's minting user, indistinguishable from the same person commenting in the app, @mentions included. Project readers, including Members, may comment on an active task in an active project. Reading a task or its comments is also allowed after archival. Every task URL checks that the task belongs to the named project.

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/comments" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "body": "Filed. Confirmation 2026-8842." }'
# → 201 { "comment": { "id": "..." } }

curl -sS "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "task": { "id": "<taskId>", "title": "...", "status": "in_progress", "externalId": "case-991", "labels": [], ... } }
```

And fetch the results. What the automation reported lands in the task's discussion; what it filed lands as files in the quarter's folder — both readable through the door. The discussion comes newest page first (`limit`, default 200, at most 500), chronological within the page; while `isDone` is `false`, pass `continueCursor` back as `cursor` to read the older comments. The content endpoint answers a **302** to a short-lived presigned URL for the stored blob, so follow redirects:

```bash
curl -sS "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/comments?limit=100" \
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
{ "error": "Automation not found", "code": "AUTOMATION_NOT_FOUND" }
```

`error` is a sentence for humans; `code` is the stable value to branch on — every refusal the API itself makes carries one, and the OpenAPI document lists the full set as the `Error.code` enum. The set is additive: a new code is a minor change, so treat a value you do not know as a generic refusal of the status you got. Some refusals add `data` — `issues` for a refused body, `retryAfterMs` for a rate limit, `providers` for an ambiguous model. Branch on the code where one is named below, on the status otherwise:

- **400** — malformed request: a missing required field, a wrong type, an unknown key, an unparseable body, a string carrying a NUL character — the envelope carries `code: "INVALID_BODY"` and lists every problem under `data.issues`, each naming the field (`price`, `contacts.2.email`; an unknown key is named as its own issue) and the reason, so fix what it names rather than what a sentence guessed; a `cursor` the list never answered (`INVALID_CURSOR`), a `limit` that is not a number (`INVALID_LIMIT`) or another query parameter the route refuses (`INVALID_QUERY`) — none is read as the first page; or a multi-org key that did not name its organization (`ORG_SLUG_REQUIRED`).
- **401** — missing or invalid API key (`UNAUTHORIZED`), with a `WWW-Authenticate: Bearer` challenge.
- **403** — the holder lacks the required role (`ROLE_FORBIDDEN`) or project edit access, the project or task is archived for a requested mutation (`PROJECT_ARCHIVED`), or an automation cannot run in this project.
- **404** — the resource is absent, invisible to the holder, owned by another thread user, or belongs to a different project than the URL names; each family names its own code (`PROJECT_NOT_FOUND`, `THREAD_NOT_FOUND`, …) and an unknown route answers `NOT_FOUND`.
- **405** — the route exists, but not for that verb (`METHOD_NOT_ALLOWED`); `Allow` lists the verbs it serves.
- **409** — the state refuses the action: no deployed version, a bound automation called without a project URL, an archived thread or a turn already running, a duplicate topic, email or `externalItemId`, a superseded knowledge entry (`KNOWLEDGE_ENTRY_SUPERSEDED`), a stale `expectedUpdatedAt` (`CONTACT_STALE`, `PRODUCT_STALE`), or search without an embedding model.
- **413** — the body is too large (`BODY_TOO_LARGE`): the webhook trigger at its 256 KB cap, the conversation routes at theirs. An uploaded file that breaks the size or type policy is refused at the bind with **400** and a reason code instead.
- **422** — a skill body the file layer cannot read (`SKILL_MALFORMED`).
- **429** — rate limit exceeded (`RATE_LIMITED`); the response carries `Retry-After` in whole seconds and `data.retryAfterMs` — see [Rate limits](/develop/rate-limits).
- **500** — internal error (`INTERNAL_ERROR`); the envelope carries a `requestId` to quote when you report it.
- **503** — a dependency the request needed is down: the embedding provider (`EMBEDDING_UPSTREAM_ERROR`, with `Retry-After`) or a document purge that could not finish (`PURGE_INCOMPLETE`) — retry with backoff.

Unbinding a trigger from an existing automation (`DELETE .../triggers`) answers **204** whether or not a trigger was bound; an unknown automation answers **404**. Deleting a resource answers **404** when it is absent, including a contact already moved to trash or a knowledge entry already deleted. Cancelling an unknown run also answers **404**; `{cancelled: false}` means the run exists but has already finished.

## Versioning

The current REST prefix is `/api/v1/`. The OpenAPI document at `/openapi.json` describes the routes and request and response schemas served by the running instance, with `servers` set to that instance; `/docs` renders it. Use it as the contract for your client.

## Where this fits

This page is the REST half of the outside surface. The [MCP endpoint](/develop/mcp-endpoint) exposes the same platform to MCP clients — automation authoring lives there, not in REST. The [Webhooks page](/develop/webhooks) covers the inbound trigger that starts runs without a key. If you are building inside the product — project agents, automations — the [Platform tab](/platform) is your day-to-day; this page is for outside.
