---
title: MCP endpoint
description: Connect an MCP client, discover Tale tools, develop automations, and handle access checks and execution results.
i18nLintExclude:
  - terminology-loanword
---

Connect an MCP client when an agent needs to discover Tale's tools, retrieve knowledge, or build and run automations. The connection uses the same API key and organization scope as [REST](/develop/api-reference). Tale is the server in this connection: your external client calls Tale.

Start with `initialize`, inspect `tools/list`, then call `get_docs` before writing an automation. The deployment supplies its own supported grammar, so the client does not need to invent node types or configuration fields.

## Connect a client

### Prepare the connection

Create an [API key](/platform/admin/api-keys) and keep it in your client's secret configuration. The app's **Settings > API > MCP** page shows the endpoint, organization slug, and a copyable discovery request.

| Setting | Value |
| --- | --- |
| Endpoint | `https://your-host.example.com/api/v1/mcp` |
| Transport | HTTPS POST with JSON-RPC; plain JSON responses |
| Authorization | `Authorization: Bearer <api-key>` |
| Organization | `X-Organization-Slug: <slug>` |
| Protocol revisions | `2025-06-18`, or `2025-03-26` when proposed by the client |

Use a client that supports a remote HTTP endpoint with custom headers. There is no SSE event stream, session deletion, or OAuth authorization flow. OAuth discovery URLs return JSON `404`; a client requiring that flow needs a different authentication configuration. A client that only launches local stdio servers cannot use this URL directly.

Always send the organization header in reusable integrations. It is optional only when the key holder has one organization. With several memberships, omitting it returns `400 ORG_SLUG_REQUIRED`; an unknown slug returns `404 ORG_SLUG_INVALID`, and a non-member organization returns `403 ORG_FORBIDDEN`.

### Initialize and retrieve the authoring reference

The examples assume `TALE_URL`, `TALE_API_KEY`, and `TALE_ORG_SLUG` are already set in your environment. `TALE_URL` is the application origin, without `/api/v1`.

```bash
curl --fail-with-body "$TALE_URL/api/v1/mcp" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"docs-client","version":"1.0.0"}}}'
```

The response identifies the server as `tale-platform`. Read `result.protocolVersion` and send that negotiated value as `MCP-Protocol-Version` on later calls. The next example uses `2025-06-18`; replace it if your initialization negotiated the older revision. An unsupported header value returns `400`.

```bash
curl --fail-with-body "$TALE_URL/api/v1/mcp" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'MCP-Protocol-Version: 2025-06-18' \
  --header 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_docs","arguments":{}}}'
```

A successful `get_docs` result contains the automation reference as text and has no error flag set. To inspect tool schemas instead, send `method: "tools/list"`. The current inventory has 22 tools. Keep the JSON-RPC `id` so a client can match a result to its request.

### Transport and batches

| Request | Response behavior |
| --- | --- |
| One JSON-RPC message | One JSON-RPC result or error |
| Batch of up to 20 messages | An array of responses; notifications have no response entry |
| Notifications only | HTTP `202` |
| `OPTIONS` | HTTP `204`, `Allow: POST, OPTIONS`; no key required |
| Any other HTTP method | HTTP `405`, `Allow: POST, OPTIONS` |

Every additional tool call in a batch consumes the same request budget as a separate call. If a batch exhausts its budget, the refused entry is JSON-RPC `-32000` with `data.retryAfterMs`; the enclosing HTTP response remains `200` and has no `Retry-After`. A single request rejected at the HTTP boundary gets REST `429`. Handle both cases using the [rate-limit guidance](/develop/rate-limits).

The endpoint supplies no CORS headers for browser key use. Keep the API key on a trusted server or in the MCP client's credential store.

## The tools

`tools/list` is the source for each tool's input schema. Missing, mistyped, blank, or unexpected arguments receive JSON-RPC `-32602` before execution. The document passed to `validate_automation`, `run_automation`, `test_automation`, or `save_automation` is intentionally an open envelope: `get_docs` explains its grammar, and the engine validates its contents.

Tools also expose `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`. Hosts can use these annotations to explain a call, but they do not grant permission or guarantee safety. Reads are marked read-only; saving writes a version; deployment and trigger changes can replace existing state; live runs can contact real services.

### Authoring

| Tool                  | What it does                                               |
| --------------------- | ---------------------------------------------------------- |
| `get_docs`            | The automation authoring reference — grammar, node kinds, capability nodes and the method table in this endpoint's own `tools/call` dialect — as text. |
| `get_catalog`         | Every node type this deployment can execute; `kind` narrows to one node kind and `compact: true` drops the input schemas. |
| `search_catalog`      | Search the node-type catalog by keyword.                   |
| `validate_automation` | Validate an automation document without saving it.         |
| `run_automation`      | Run an automation document directly against the deterministic mocks. |
| `test_automation`     | Run an automation's own acceptance tests.                  |
| `save_automation`     | Save an automation document as a new immutable version.    |
| `get_automation`      | Read one saved version — the latest when unversioned, `version: "deployed"` for the live one (`AUTOMATION_VERSION_UNKNOWN` while nothing is deployed). |
| `list_automations`    | The organization's automations with their latest and deployed versions and the projects each is installed in (`projectIds`). |
| `deploy_automation`   | Promote one saved version to be the live version.          |

Use the authoring loop in this order: read the grammar and catalog, validate the document, run it against mocks, run its acceptance tests, save a version, then deploy that version. A successful mock run verifies the simulated path; it does not prove vendor credentials, network access, or real effects.

### Run & trigger management

| Tool             | What it does                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `run_deployed`   | Run the deployed version live and WAIT for the finished result — output, trace and effects in one answer; a run that outlives the wait answers with its `runId` to poll. |
| `start_run`      | Start the deployed version in the background and return a run handle immediately; poll get_run for the result. Takes an optional `idempotencyKey` — the REST endpoint's `Idempotency-Key`, the same ledger: the same key with the same arguments answers the first run's handle with `duplicate: true` and starts nothing, the same key with different arguments is refused (`IDEMPOTENCY_KEY_REUSED`). The `Idempotency-Key` HTTP header is not read on this endpoint. |
| `list_runs`      | Recent runs the key may read, newest first — of one automation or across the organization's projects; each names its `projectId`. |
| `get_run`        | One run in full: status, output, trace, effects and `projectId` — a project run's id is the one `GET /api/v1/projects/{id}/runs/{runId}` takes. |
| `cancel_run`     | Stop a run at its next node boundary.                                                                          |
| `list_versions`  | One automation's immutable version history; each row says whether it is the `deployed` one, and `deployedVersion` names it beside the list (`null` while nothing is deployed). |
| `list_triggers`  | What starts the automations (never the webhook secret).                                                        |
| `delete_trigger` | Unbind an automation's trigger; its versions and run history stay.                                             |
| `set_trigger`    | Bind what starts the automation (schedule/webhook/event). A webhook's `token` is answered once, here, and never again — store it; `deployed` says whether deliveries will run: a trigger bound to an automation with no deployed version is stored and fires nothing until one is deployed. |

| Choose | When |
| --- | --- |
| `run_automation` | Try an unsaved document against deterministic mocks; `mode: "live"` is refused |
| `run_deployed` | Run the saved deployment live and wait up to 30 seconds; poll the returned `runId` if it continues |
| `start_run` | Start the saved deployment in the background and poll `get_run`; pass `idempotencyKey` to make a retry safe |

Both deployed-run tools use the durable runner with the same authorization and execution records. `start_run` accepts an optional `projectId`. A project-bound automation must run in a project where it is installed; a sole binding can be selected automatically. With no bindings, omission means organization scope. Read `projectIds` from `list_automations` and the actual `projectId` from the returned handle rather than guessing a REST polling URL.

### Capabilities & knowledge

| Tool                  | What it does                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `search_capabilities` | Search everything this organization can do — its deployed automations, by name and description.                     |
| `invoke_capability`   | Invoke one capability by id. An action the organization gates returns a pending-approval result instead of running. |
| `get_knowledge`       | Retrieve passages from the organization's knowledge — its documents and its crawled web pages. `corpus` is `private` (documents), `public-web` (crawled pages) or `all`; the REST spellings `documents` and `web` are taken too. `query` is capped at 2000 characters. |

The capability registry currently contains deployed automations. It does not include builtin tools, connector actions, skills, or external MCP servers. Invoking a deployed automation is the same live operation as `run_deployed`. If approval is needed, a `pending` result lets the client explain that a person must decide before execution continues.

## What the key may do

| Operation | Required access |
| --- | --- |
| Reads, validation, mock runs and acceptance tests, capability search, knowledge retrieval | Organization membership, plus the resource's normal access rules |
| Save, deploy, set/delete a trigger, cancel a run, or execute live | Developer capability, plus the resource's normal access rules |

The key identifies its holder; it does not expand that person's role or project access. Live `invoke_capability` calls also pass through the execution checks.

Read `GET /api/v1/me` before configuring privileged tools: `capabilities.developer` reports the current role gate, while `deploymentEditor` is a separate operator allowlist and does not authorize MCP authoring. The MCP tool-error envelope below still applies; a REST capability check does not change JSON-RPC error handling.

### Distinguish a transport error from a refused tool

| Result | How to handle it |
| --- | --- |
| JSON-RPC `-32601` | Correct the unknown method |
| JSON-RPC `-32602` | Correct the tool name or arguments using `tools/list`; a value outside an enumerated set is refused with the set named |
| Tool result with `isError: true` | Read its text payload's stable `code`, explanatory `error`, and actionable `hint`; `data` may contain field problems |
| `validate_automation` with `valid: false` | Normal validation result; inspect `errors`, even though `isError` remains false |
| Capability result `pending` | Normal approval outcome; do not treat it as completion or retry it as a failure |
| Capability result `refused` | Error result; correct the stated cause |

Tool refusal codes include `AUTOMATION_NOT_FOUND`, `AUTOMATION_VERSION_UNKNOWN`, `AUTOMATION_NOT_DEPLOYED`, `RUN_NOT_FOUND`, `AUTOMATION_INVALID`, `AUTOMATION_TESTS_FAILING`, `LIVE_MODE_UNAVAILABLE`, and `NOT_SUPPORTED`. The latter means the host does not support that run/version/trigger operation. `start_run` refuses a reused `idempotencyKey` with different arguments as `IDEMPOTENCY_KEY_REUSED`; `invoke_capability` refuses an id the registry does not hold — a saved-only automation is not in it — as `CAPABILITY_NOT_FOUND` and input its schema rejects as `CAPABILITY_INPUT_INVALID`; `get_knowledge` lifts the knowledge endpoint's own codes through (`KNOWLEDGE_UNAVAILABLE` when the search itself failed). Platform errors retain their own code, hint, and optional data; for example, missing developer access returns `FORBIDDEN_DEVELOPER_SETTINGS`.

An unknown automation name is an error even for `list_versions`, `list_runs`, and `list_triggers`; an empty list means an existing automation has no matching items. Invalid documents passed to tools that need a valid one, search failures, and missing deployments set `isError: true`. Only the validation tool reports an invalid document as its ordinary verdict.

## Where this fits

REST and MCP share keys, organization scoping, and durable run objects. Use REST when you want explicit HTTP routes; use MCP when your client understands tool discovery and calls. Tale does not register or call external MCP servers through this endpoint.
