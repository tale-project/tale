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
| Protocol revisions | `2026-07-28`, carried by every request; or `2025-11-25`, `2025-06-18` or `2025-03-26`, opened with `initialize` ([Protocol revisions](#protocol-revisions)) |

Use a client that supports a remote HTTP endpoint with custom headers. There is no SSE event stream, session deletion, or OAuth authorization flow. OAuth discovery URLs return JSON `404`; a client requiring that flow needs a different authentication configuration. A client that only launches local stdio servers cannot use this URL directly. [Use Tale from your editor or a script](/develop/use-tale-from-your-editor) has ready configurations for opencode and Claude Code.

Always send the organization header in reusable integrations. It is optional only when the key holder has one organization. With several memberships, omitting it returns `400 ORG_SLUG_REQUIRED`; an unknown slug returns `404 ORG_SLUG_INVALID`, and a non-member organization returns `403 ORG_FORBIDDEN`. Each of these refusals lists the slugs you can send in `data.organizations`.

### Initialize and retrieve the authoring reference

The examples assume `TALE_URL`, `TALE_API_KEY`, and `TALE_ORG_SLUG` are already set in your environment. `TALE_URL` is the application origin, without `/api/v1`.

```bash
curl --fail-with-body "$TALE_URL/api/v1/mcp" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"docs-client","version":"1.0.0"}}}'
```

The response identifies the server as `tale-platform` and reports the API contract version as `serverInfo.version`. Its `instructions` are a short guide to working with Tale that your client can hand to its model. Read `result.protocolVersion` and send that negotiated value as `MCP-Protocol-Version` on later calls. The next example uses `2025-11-25`; replace it if your initialization negotiated an older revision. A revision the endpoint does not speak returns `400` with JSON-RPC `-32022`, and `data.supported` lists the ones it does.

```bash
curl --fail-with-body "$TALE_URL/api/v1/mcp" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'MCP-Protocol-Version: 2025-11-25' \
  --header 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_docs","arguments":{}}}'
```

A successful `get_docs` result contains the automation reference as text and has no error flag set. Add `"arguments":{"topic":"triggers"}` for the triggers reference (each trigger kind's fields, the input its runs start with, and the events), `"validation"` for how to read a validation result and every issue code, or `"skill"` for the [Tale skill](/develop/use-tale-from-your-editor#tale-skill). To inspect tool schemas instead, send `method: "tools/list"`. Keep the JSON-RPC `id` so a client can match a result to its request.

### Transport and batches

| Request | Response behavior |
| --- | --- |
| One JSON-RPC message | One JSON-RPC result or error |
| Batch of up to 20 messages (2025 revisions only) | An array of responses; notifications have no response entry |
| Notifications only | HTTP `202` |
| `OPTIONS` | HTTP `204`, `Allow: POST, OPTIONS`; no key required |
| Any other HTTP method | HTTP `405`, `Allow: POST, OPTIONS` |

Every additional tool call, resource read or listing, or prompt in a batch consumes the same request budget as a separate call. If a batch exhausts its budget, the refused entry is JSON-RPC `-32000` with `data.retryAfterMs`; the enclosing HTTP response remains `200` and has no `Retry-After`. A single request rejected at the HTTP boundary gets REST `429`. Handle both cases using the [rate-limit guidance](/develop/rate-limits).

The endpoint supplies no CORS headers for browser key use. Keep the API key on a trusted server or in the MCP client's credential store. A request whose `Origin` header names a site the deployment does not accept is logged, and refused with `403` `ORIGIN_FORBIDDEN` where the operator enforces that check ([environment reference](/self-hosted/configuration/environment-reference#mcp-endpoint)). Coding agents in a terminal send no `Origin`.

### Protocol revisions {#protocol-revisions}

The endpoint serves two generations of the protocol on the same URL and key, and decides for each request which one it is. A client that speaks `2026-07-28` sends no `initialize`: every request carries its revision and the client's capabilities, so nothing is kept between requests.

| | `2025-11-25`, `2025-06-18`, `2025-03-26` | `2026-07-28` |
| --- | --- | --- |
| Start | `initialize`, then the negotiated revision in `MCP-Protocol-Version` | No handshake; `server/discover` returns what the server speaks |
| Every request | The JSON-RPC message | `params._meta` with `io.modelcontextprotocol/protocolVersion` and `io.modelcontextprotocol/clientCapabilities`; the headers `MCP-Protocol-Version` and `Mcp-Method`, plus `Mcp-Name` for `tools/call`, `resources/read` and `prompts/get` |
| Batches | Up to 20 messages | One message per request |
| Results | As described on this page | Also `resultType: "complete"` and the server under `_meta["io.modelcontextprotocol/serverInfo"]`; `server/discover`, the lists and `resources/read` add `ttlMs` and `cacheScope: "private"` |
| `initialize`, `ping` | Answered | HTTP `404` with JSON-RPC `-32601` |
| An address that reads nothing | `-32002` | `-32602` |

A request is served as `2026-07-28` when its `_meta` names a revision or its `MCP-Protocol-Version` header names `2026-07-28`. Its headers must repeat what the body says. A missing header, or one that names another revision, method, tool, prompt or address, is refused with HTTP `400` and JSON-RPC `-32020` before anything runs. Send an `Mcp-Name` value that is not plain ASCII as `=?base64?<Base64 of the UTF-8 text>?=`. A missing or malformed `_meta` returns `-32602` with HTTP `400` and names the keys under `data.missing` or `data.malformed`.

```bash
curl --fail-with-body "$TALE_URL/api/v1/mcp" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'MCP-Protocol-Version: 2026-07-28' \
  --header 'Mcp-Method: server/discover' \
  --header 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{"name":"docs-client","version":"1.0.0"}}}}'
```

The answer lists every revision under `supportedVersions` and carries the same capabilities and `instructions` as `initialize`, with the server under `_meta`. `ttlMs` says how long your client may reuse an answer: an hour for `server/discover`, the tool, prompt and template lists and the references; a minute for `resources/list` and the connector catalog; `0` for an automation or a run, because it can change with your agent's next save. Every answer belongs to the key that asked, so a cache must never share it with another key. The name in `io.modelcontextprotocol/clientInfo` is recorded with each call and with the changes the call makes, so a version an agent saves names the client that saved it.

## The tools

`tools/list` is the source for each tool's input schema, and a read tool also states its answer in `outputSchema`. Arguments are checked before execution: missing, mistyped, blank, or unexpected ones are refused with one tool result marked `isError`, whose `code` is `INVALID_ARGUMENTS` and whose `data.issues` lists every problem with its `path`, `code`, and `message`. The refusal never repeats an argument's value. Every result carries its answer as compact JSON text, and a read tool's successful answer also comes as `structuredContent`, the same object. The document passed to `validate_automation`, `run_automation`, `test_automation`, or `save_automation` is intentionally an open envelope: `get_docs` explains its grammar, and the engine validates its contents.

Tools also expose `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`. Hosts can use these annotations to explain a call, but they do not grant permission or guarantee safety. Reads are marked read-only; saving writes a version; deployment, deletion, installation and trigger changes can replace existing state; live runs can contact real services. Deploying, deleting, setting a trigger, installing an automation in projects, and answering a run's question also carry `_meta["anthropic/requiresUserInteraction"]`, so a client that honors it asks the person before every such call.

### Authoring {#authoring}

| Tool                  | What it does                                               |
| --------------------- | ---------------------------------------------------------- |
| `get_docs`            | The automation authoring reference — grammar, node kinds, capability nodes and the method table in this endpoint's own `tools/call` dialect — as text. |
| `get_catalog`         | Every node type this deployment can execute, with each capability's input schema, output signature, and `outputSchema`; `kind` narrows to one node kind and `compact: true` drops the schemas. |
| `search_catalog`      | Search the node-type catalog by keyword.                   |
| `validate_automation` | Validate an automation document without saving it: its errors and warnings, each with its location, plus the flow analysis and the inferred types. |
| `run_automation`      | Run an automation document directly against the deterministic mocks. |
| `test_automation`     | Run an automation's own acceptance tests — of a draft (`automation`), or of a saved version (`name`, `version`), whose verdict is then recorded on the version. |
| `save_automation`     | Save an automation document as a new immutable version; the answer lists its warnings. See [Save without losing work](#save). |
| `get_automation`      | Read one saved version — the latest when unversioned, `version: "deployed"` for the live one (`AUTOMATION_VERSION_UNKNOWN` while nothing is deployed): the document under `automation`, its `settings`, `taskContract` and `presentation`, `latestVersion`, `deployedVersion`, who saved it (`createdBy`) through which door (`createdVia`: `app`, `upload`, `mcp`, `managed` or `system`; `null` for a version saved before it was recorded) and with which client (`clientName`), its `projectIds` and its `trigger`. |
| `list_automations`    | The organization's automations with their latest and deployed versions and the projects each is installed in (`projectIds`). |
| `deploy_automation`   | Promote one saved version to be the live version; an older one rolls back. `expectedDeployedVersion` (the version you read as live, `null` for none) refuses the deploy with `AUTOMATION_DEPLOYMENT_STALE` when another went live meanwhile; the answer names the `previousVersion`. |
| `delete_automation`   | Delete an automation — every version, its trigger and its installations; its runs stay. `expectedLatestVersion` must be the latest version you read (`AUTOMATION_VERSION_STALE` otherwise); a run still going refuses the delete (`AUTOMATION_HAS_ACTIVE_RUNS`). |

Use the authoring loop in this order: read the grammar and catalog, validate the document, run it against mocks, run its acceptance tests, save a version, then deploy that version. A successful mock run verifies the simulated path; it does not prove vendor credentials, network access, or real effects.

#### Save without losing work {#save}

A version carries, beside the document, the `settings` form a task shows, the `taskContract`, and the `presentation` on the automations list. A save that leaves one of them out keeps the latest version's; `null` stores none (for `presentation`, the list then keeps showing the newest earlier one); a value is checked against the schema the app reads it with, and refused as `INVALID_ARGUMENTS` with every problem when it does not fit. The answer's `carried` names what was kept.

Pass `baseVersion`, the version your edit started from. When someone saved a newer version meanwhile, the save is refused with `AUTOMATION_VERSION_STALE` and `data.latestVersion`; read that version, merge your change and save again. Without `baseVersion` the save appends, and `baseVersionChecked: false` says the check was skipped. Save a new automation with `create: true`: a name that already exists is refused (`AUTOMATION_NAME_TAKEN`), so a new automation never becomes a version of another one. A save is refused the same way, `create` or not, when the name belongs to an automation you cannot see. `projectId` installs a new automation in a project you can edit with its first version; a save of an automation that exists ignores it.

#### Read a validation result {#validation-result}

`validate_automation` answers `valid`, `errors`, `warnings`, `analysis`, and `types`. Errors stop a save and a deployment; warnings never do. `save_automation` returns the `warnings` of the version it saved, and a refused save returns its `warnings` beside its `errors`, so you hear about both while you work.

| Issue field | What it holds |
| --- | --- |
| `code` | The stable value to branch on, such as `REF_UNKNOWN_FIELD` or `MAYBE_NULL` |
| `message`, `hint` | English sentences that stay stable between releases; show them, but branch on `code` |
| `nodeId` | The node the issue is about, when there is one |
| `at.pointer` | A JSON Pointer into the document you sent, such as `/nodes/2/input/to`; `""` is the whole document |
| `at.range` | `[start, end)` in UTF-16 code units inside the string at `at.pointer`, when the issue is one expression in a template, a condition, or code |
| `at.subject` | `key` when the pointer names a field that should not exist; `missing` when it names one that should exist and does not |
| `params` | The facts the message is built from, such as `node`, `field`, `ref`, `key`, and `suggestion` |
| `related` | Other places involved: the node a read depends on, the node whose condition or failure causes the issue, readers, or the members of a cycle |

`analysis.nodes.<id>` says whether a node is `reachable`, whether it `alwaysRuns`, how it can be skipped (`maySkip`), and whether its failure stops the run (`failureHandling: "halts"`) or lets the run go on (`"continues"`). `analysis.paths` lists the ways a successful run can go, up to 32 of them with `count` for all, and names the nodes whose failure ends a run. `types` gives the JSON Schema of the run input, of each node's output, and of the automation's result; `get_catalog` gives each capability's `outputSchema` the same way. [What Tale checks before a run](/platform/automations/concepts#checks) explains each family of checks.

`detail` chooses what comes beside the issues: `["analysis"]`, `["types"]`, or `[]` for the issues alone; left out, you get both. Some warnings compare the document with your organization instead of checking it: a skill no run of the automation can reach (`SKILL_UNKNOWN`), a connector nobody has connected (`CONNECTOR_NOT_CONNECTED`), a secret nobody has stored (`SECRET_UNKNOWN`, reported only to Owners, Admins and Developers), an agent runtime this deployment can't run (`HARNESS_UNKNOWN`), and an event trigger that waits for an event Tale doesn't raise (`EVENT_UNKNOWN`). They never stop a save; the [discovery tools](#discovery) list what exists.

### Run & trigger management {#management}

| Tool             | What it does                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `run_deployed`   | Run the deployed version live and WAIT for the finished result — output, trace and effects in one answer; a run that outlives the wait answers with its `runId` to poll. Takes the same optional `idempotencyKey` as `start_run`, on the same ledger the REST endpoint keeps: a repeat answers the first run with `duplicate: true` and starts nothing, whichever door started it. |
| `start_run`      | Start a run in the background and return a run handle immediately; poll get_run for the result. `mode: "live"` (the default) runs the deployed version for real; `mode: "mock"` runs any saved version — the latest when `version` is omitted — against the deterministic mocks, and the run is recorded in the run history like one started in the app. Takes an optional `idempotencyKey` — the REST endpoint's `Idempotency-Key`, the same ledger: the same key with the same arguments answers the first run's handle with `duplicate: true` and starts nothing, the same key with different arguments is refused (`IDEMPOTENCY_KEY_REUSED`). The `Idempotency-Key` HTTP header is refused on this endpoint (**400**, `INVALID_HEADER`) — a batch carries up to 20 calls, so the key rides in the tool arguments. |
| `list_runs`      | Recent runs the key may read, newest first — of one automation or across the organization's projects; each names its `projectId`. `mode` and `statuses` filter, and `nextCursor` (null on the last page) is the `cursor` of the next older page; pass it unchanged with the same filters. |
| `get_run`        | One run in full: status, output, trace, effects and `projectId` — a project run's id is the one `GET /api/v1/projects/{id}/runs/{runId}` takes. A run waiting on a person's answer (`waitingFor: "ask"`) names the question under `ask`: its `askId` and the question. `detail` picks what to answer beside the status; `detail: []` answers the status alone, for polling a long run. |
| `cancel_run`     | Stop a run at its next node boundary.                                                                          |
| `answer_run_ask` | Answer the question a waiting run asked a person (`get_run` answers it as `ask`, with the `askId` to pass); the run resumes on the answer, which is recorded as the key holder's. |
| `list_versions`  | One automation's immutable version history; each row says whether it is the `deployed` one, who saved it through which door (`createdVia`, `clientName`), and `deployedVersion` names the live one beside the list (`null` while nothing is deployed). `deployments` lists when versions went live, newest first, with what was live before. |
| `set_automation_projects` | Install an automation in projects (`add`) and remove it from others (`remove`) in one change; the answer names what was `added`, `removed` and `unchanged`. Removing it from a project it is not in is refused (`AUTOMATION_NOT_INSTALLED`). |
| `get_automation_metrics` | The organization's run figures for 7, 30 or 90 days (`periodDays`), live runs by default or mock ones: runs by outcome, success rate, average duration, a per-day series and the busiest automations, each against the window before. |
| `list_triggers`  | What starts the automations (never the webhook secret).                                                        |
| `delete_trigger` | Unbind an automation's trigger; its versions and run history stay.                                             |
| `set_trigger`    | Bind what starts the automation (schedule/webhook/event). A webhook's `token` is answered once, here, and never again — store it; `deployed` says whether deliveries will run: a trigger bound to an automation with no deployed version is stored and fires nothing until one is deployed. |

| Choose | When |
| --- | --- |
| `run_automation` | Try an unsaved document against deterministic mocks; `mode: "live"` is refused |
| `run_deployed` | Run the saved deployment live and wait up to 30 seconds; poll the returned `runId` if it continues |
| `start_run` | Start the saved deployment in the background and poll `get_run`; pass `idempotencyKey` to make a retry safe |
| `start_run` with `mode: "mock"` | Run a saved version — deployed or not — against the mocks, with a record anyone can open in the run history |

Both deployed-run tools use the durable runner with the same authorization and execution records. `start_run` accepts an optional `projectId`. A project-bound automation must run in a project where it is installed; a sole binding can be selected automatically. With no bindings, omission means organization scope. Read `projectIds` from `list_automations` and the actual `projectId` from the returned handle rather than guessing a REST polling URL.

### Discovery {#discovery}

| Tool | What it does |
| --- | --- |
| `list_models` | The models you may use, filtered by your model access: each with `providerSlug` (an `agent` node saves it as `modelProvider`), `lane` (`direct` when a provider serves it, `subscription` or `broker` when a member's subscription does), the `nodeTypes` it suits (an `llm` node takes only a directly served model) and the agent runtimes it is offered to (`harnesses`). `nodeType` and `harness` filter the list. |
| `list_harnesses` | The agent runtimes an `agent` node can name as `harness`, the `default` one that runs when it names none, and whether a subscription can serve each. |
| `list_skills` | The organization's skills; with `projectId`, also the team skills of that project, the ones a run in it can use. A project you can't read answers `PROJECT_NOT_FOUND`. |
| `list_connectors` | The connectors this deployment offers, whether your organization connected each (`connected`) and how many actions it has; `query` filters. `search_catalog` lists the actions. |
| `list_agent_secrets` | The names of the organization's agent secrets with a masked `preview`, never a value. Owners, Admins and Developers see them; anyone else gets an empty list with a `note`. |
| `list_projects` | The projects you can read: whether each is `writable` or `archived`, and the `automations` installed in it that you may see. `query` filters by name; `includeArchived` adds archived projects. |
| `list_events` | The events Tale raises, each with when it fires: what an event trigger can wait for. |

Each answer carries a `hint` that names the tool or the setting that changes it.

### Capabilities & knowledge {#capabilities}

| Tool                  | What it does                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `search_capabilities` | Search everything this organization can do — its deployed automations, by name and description.                     |
| `invoke_capability`   | Invoke one capability by id: a deployed automation, run live as `run_deployed` runs it. A step the organization gates for approval leaves the run waiting for a person to decide in Tale. |
| `get_knowledge`       | Retrieve passages from the organization's knowledge — its documents and its crawled web pages. `corpus` is `private` (documents), `public-web` (crawled pages) or `all`; the REST spellings `documents` and `web` are taken too. `query` is capped at 2000 characters. Each passage carries `text`, `source` (a title), `ref`, `corpus`, `chunkIndex`, `score`, `similarity` when the dense leg ranked it, `url` for a web page, and — for a document — the `documentId` that `GET /api/v1/documents/{id}` takes (a project file's id for a project hit) and its `projectId`, the same citation the REST search answers. |

The capability registry currently contains deployed automations. It does not include builtin tools, connector actions, skills, or external MCP servers. Invoking a deployed automation is the same live operation as `run_deployed`, and it waits up to 30 seconds for the run to finish the same way. When a step needs an [approval](/platform/approvals/concepts), the run waits for a person to decide in Tale: the answer's `output` is the run with `status: "waiting"`, and `get_run` shows `waitingFor: "approval"`. No tool approves or rejects it, so your client should tell the person rather than retry. Stopping the run with `cancel_run` withdraws the approval.

## Resources and prompts {#resources-and-prompts}

Besides tools, the endpoint serves resources, which a client reads by address, and prompts: ready-made requests a person starts work from. Both read what a tool already answers, for the same person and through the same checks.

### Read by address {#resources}

`resources/list` names the fixed resources, then every automation the key holder can see, 100 per page; follow `nextCursor` for the next page. `resources/templates/list` returns the address patterns, and `resources/read` returns a resource's contents.

| Address | Contents | Read like |
| --- | --- | --- |
| `tale://docs/authoring`, `tale://docs/triggers`, `tale://docs/validation`, `tale://docs/skill` | The references, as Markdown | `get_docs` with that `topic` |
| `tale://catalog/{kind}` (`transform`, `llm`, `agent`, `subautomation`, `connector`) | A core node kind's section of the reference, or the connector actions | `get_catalog` with that `kind` |
| `tale://automations/{name}` | The latest saved version, as JSON | `get_automation` |
| `tale://automations/{name}/versions/{version}` | One saved version; `{version}` is a number or `deployed` | `get_automation` with `version` |
| `tale://runs/{runId}` | One run with its output, trace and effects | `get_run` |

Write each `/` in an automation name as `%2F`: `tale://automations/billing%2Fdunning`. An address that reads nothing returns JSON-RPC `-32002` (`-32602` on `2026-07-28`) with the refusal's code in `data.code`, such as `AUTOMATION_NOT_FOUND`; an automation the key holder cannot see returns the same error as one that does not exist. A malformed address, such as a version that is not a number, returns `-32602`.

### Start from a prompt {#prompts}

`prompts/list` names three prompts, and `prompts/get` returns the message with what it is about attached as a resource. Claude Code lists them as `/tale:edit_automation` and so on.

| Prompt | Arguments | What it asks the agent to do |
| --- | --- | --- |
| `edit_automation` | `name` (optional) | Change the automation or create one, validate it, test it on the mocks and save it with `baseVersion`; it deploys nothing |
| `debug_failed_run` | `runId` | Explain why the run failed, reproduce the failure on the mocks and propose the smallest fix |
| `add_trigger` | `name`, `kind` (optional: `schedule`, `webhook` or `event`) | Decide what starts the automation, and ask before calling `set_trigger` |

Each argument is a single word, because clients such as Claude Code split arguments at spaces. An argument sent empty counts as left out. A prompt whose run or automation the key holder cannot read returns `-32602` with that read's code.

## What the key may do

| Operation | Required access |
| --- | --- |
| Reads, validation, mock runs (`start_run` with `mode: "mock"` included) and acceptance tests, capability search, knowledge retrieval | Organization membership, plus the resource's normal access rules |
| Answer a run's question | Organization membership; for a run in a project, edit access to that project |
| Agent secret names (`list_agent_secrets`) | Owner, Admin or Developer role; anyone else gets an empty list |
| Save, deploy, delete, install in projects, set/delete a trigger, cancel a run, or execute live | Developer capability, plus the resource's normal access rules |

The key identifies its holder; it does not expand that person's role or project access. An automation installed only in projects the key holder cannot read is left out of `list_automations`, and every read of it answers `AUTOMATION_NOT_FOUND`, as for one that does not exist. Live `invoke_capability` calls also pass through the execution checks.

Every change an MCP call makes to an automation — a version saved, a deploy, a delete, a trigger set or removed, an installation added or removed — is in the organization's audit log, marked as coming through MCP with the tool and the API key. In the event's details, **Source** reads Coding agent, and **Client** names the agent's app when the app sent its name ([Audit logs](/platform/admin/governance/audit-logs)).

Read `GET /api/v1/me` before configuring privileged tools: `capabilities.developer` reports the current role gate, while `deploymentEditor` is a separate operator allowlist and does not authorize MCP authoring. The MCP tool-error envelope below still applies; a REST capability check does not change JSON-RPC error handling.

### Distinguish a transport error from a refused tool

| Result | How to handle it |
| --- | --- |
| JSON-RPC `-32601` | Correct the unknown method; on `2026-07-28` it comes with HTTP `404`, also for `initialize` and `ping` |
| JSON-RPC `-32602` | Correct the tool name using `tools/list`, a prompt's name or arguments using `prompts/list`, or a resource address. With HTTP `400`, complete the `2026-07-28` `_meta` named in `data.missing` or `data.malformed` |
| JSON-RPC `-32002` | The resource address reads nothing; `data.code` names the refusal, such as `AUTOMATION_NOT_FOUND`. On `2026-07-28` the same answer has the code `-32602` |
| JSON-RPC `-32020` (HTTP `400`) | A `2026-07-28` request's headers do not repeat its body; send `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` as described in [Protocol revisions](#protocol-revisions) |
| JSON-RPC `-32022` (HTTP `400`) | Send one of the revisions in `data.supported`: in `MCP-Protocol-Version`, and on `2026-07-28` also in `_meta`. A 2025 revision is opened with `initialize` |
| Tool result with `isError: true` | Read its text payload's stable `code`, explanatory `error`, and actionable `hint`; `data` may contain field problems |
| `validate_automation` with `valid: false` | Normal validation result; inspect `errors` and where each one is ([Read a validation result](#validation-result)), even though `isError` remains false. Warnings never make a document invalid |
| Capability `output` with `status: "waiting"` | The run waits, for example for an approval a person gives in Tale; it has neither finished nor failed. Poll `get_run` and do not retry it |
| Capability result `refused` | Error result; correct the stated cause |

Tool refusal codes include `AUTOMATION_NOT_FOUND`, `AUTOMATION_VERSION_UNKNOWN`, `AUTOMATION_NOT_DEPLOYED`, `RUN_NOT_FOUND`, `AUTOMATION_INVALID`, `AUTOMATION_TESTS_FAILING`, `AUTOMATION_VERSION_STALE`, `AUTOMATION_DEPLOYMENT_STALE`, `AUTOMATION_NAME_TAKEN`, `AUTOMATION_HAS_ACTIVE_RUNS`, `AUTOMATION_NOT_INSTALLED`, `HUMAN_ASK_NOT_FOUND`, `HUMAN_ASK_NOT_PENDING`, `HUMAN_ASK_EXPIRED`, `EMPTY_ANSWER`, `INVALID_CURSOR`, `LIVE_MODE_UNAVAILABLE`, and `NOT_SUPPORTED`. The latter means the host does not support that run/version/trigger operation. `start_run` refuses a reused `idempotencyKey` with different arguments as `IDEMPOTENCY_KEY_REUSED`; `invoke_capability` refuses an id the registry does not hold — a saved-only automation is not in it — as `CAPABILITY_NOT_FOUND` and input its schema rejects as `CAPABILITY_INPUT_INVALID`; `get_knowledge` lifts the knowledge endpoint's own codes through (`KNOWLEDGE_UNAVAILABLE` when the search itself failed). Platform errors retain their own code, hint, and optional data; for example, missing developer access returns `FORBIDDEN_DEVELOPER_SETTINGS`. `INVALID_ARGUMENTS` lists every argument problem; a value outside an enumerated set is refused with the set named. `RATE_LIMITED` means the tool needed an execution and the key holder's [execution budget](/develop/rate-limits) is spent: wait `data.retryAfterMs`. `INTERNAL_ERROR` means the call failed unexpectedly; its `data.requestId` is the id to quote to whoever runs the deployment.

An unknown automation name is an error even for `list_versions`, `list_runs`, and `list_triggers`; an empty list means an existing automation has no matching items. The one exception is run history: a deleted automation keeps its runs, so `list_runs {name}` answers them for as long as they exist, and only a name that never ran is `AUTOMATION_NOT_FOUND`. `get_catalog` narrowed to a core node kind (`transform`, `llm`, `agent`, `subautomation`) answers an empty list with a `hint` pointing at `get_docs`, as `search_catalog` does, and the kind's own section of the reference as `reference`. Invalid documents passed to tools that need a valid one, search failures, and missing deployments set `isError: true`. Only the validation tool reports an invalid document as its ordinary verdict.

## Where this fits

REST and MCP share keys, organization scoping, and durable run objects. Use REST when you want explicit HTTP routes; use MCP when your client understands tool discovery and calls. Tale does not register or call external MCP servers through this endpoint.
