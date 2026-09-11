---
title: MCP endpoint
description: Connect an MCP client to Tale — one endpoint, 22 tools covering automation authoring, run and trigger management, and the organization's capability surface.
i18nLintExclude:
  - terminology-loanword
---

Tale is itself an MCP server. Point any MCP client — an agent harness, an IDE, your own SDK loop — at one endpoint and it can author and operate automations, search what the organization can do, invoke a capability, and retrieve knowledge, with the same API key the REST surface takes. Where REST is the connector seam for your code, the MCP endpoint is the seam for _models_: every tool answers text a model can read and act on.

Read this to connect a client and understand the tool inventory. The grammar for authoring automations is deliberately not duplicated here — the endpoint teaches it itself through `get_docs`.

## Connect a client

The endpoint speaks MCP protocol `2025-06-18`, or `2025-03-26` when the client proposes it, as JSON-RPC over HTTPS — plain JSON responses, no SSE stream. Send one message per request, or a JSON-RPC batch of at most 20 messages: it is answered as an array, a batch of notifications alone answers 202, and every tool call in a batch beyond the first draws from the same request budget as a request of its own. Authenticate with an organization API key ([API keys](/platform/admin/api-keys) covers minting one). A key whose holder belongs to more than one organization must also name the organization it means, on every request — the `X-Organization-Slug` header, membership-checked. Without it such a request answers **400** `ORG_SLUG_REQUIRED` rather than guessing from the dashboard; a single-organization key may omit the header.

```json
// POST https://your-host.example.com/api/v1/mcp
// Authorization: Bearer tale_...
// X-Organization-Slug: acme
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": { "name": "my-client", "version": "1.0.0" }
  }
}
```

The server identifies as `tale-platform`. In a client that takes a config block, the two headers are all you need:

```json
{
  "mcpServers": {
    "tale": {
      "url": "https://your-host.example.com/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer tale_...",
        "X-Organization-Slug": "acme"
      }
    }
  }
}
```

`tools/list` returns the full inventory; any verb but `POST` answers **405** with an `Allow: POST` header — there is no event stream to subscribe to and no session to delete. Your deployment's endpoint URL, the organization slug, the same inventory in its three groups, and a copyable `tools/list` request with both headers in place sit under **Settings > API > MCP**.

## The tools

Twenty-two tools, in three groups, each with a real JSON schema the endpoint holds a call to — arguments that do not match answer JSON-RPC error `-32602` naming the field, never a silently empty result. The four tools that take a whole automation document — validate, run, test, save — declare their call envelope (`automation`, plus `input`, `mode` or `message` where they apply) and leave the document itself open: its grammar is what `get_docs` teaches, and the engine validates it in band.

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
| `get_automation`      | Read one saved version (the latest when unversioned).      |
| `list_automations`    | The organization's automations with their latest and deployed versions and the projects each is installed in (`projectIds`). |
| `deploy_automation`   | Promote one saved version to be the live version.          |

### Run & trigger management

| Tool             | What it does                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `run_deployed`   | Run the deployed version live and WAIT for the finished result — output, trace and effects in one answer; a run that outlives the wait answers with its `runId` to poll. |
| `start_run`      | Start the deployed version in the background and return a run handle immediately; poll get_run for the result. |
| `list_runs`      | Recent runs the key may read, newest first — of one automation or across the organization's projects; each names its `projectId`. |
| `get_run`        | One run in full: status, output, trace, effects and `projectId` — a project run's id is the one `GET /api/v1/projects/{id}/runs/{runId}` takes. |
| `cancel_run`     | Stop a run at its next node boundary.                                                                          |
| `list_versions`  | One automation's immutable version history.                                                                    |
| `list_triggers`  | What starts the automations (never the webhook secret).                                                        |
| `delete_trigger` | Unbind an automation's trigger; its versions and run history stay.                                             |
| `set_trigger`    | Bind what starts the automation (schedule/webhook/event).                                                      |

Pick `run_deployed` when the automation is quick and you want one call with the answer in it — it waits up to 30 seconds for the run, then hands you the `runId` instead of a half-finished result. Pick `start_run` when the run may take minutes — it returns a `runId` immediately, and `get_run` polls it. Both run live on the same durable runner, so both authorize, execute and record the run identically. `run_automation` is the authoring loop's tool: it runs an unsaved document against the deterministic mocks, and `mode: "live"` answers a refusal that points you at `run_deployed` — an unsaved document has no live lane.

`start_run` also takes an optional `projectId` — the project the run operates in, so its task and document tools act there. Omit it for an organization-wide run, or, when the automation is bound to a single project, that one. A bound automation accepts only a project it is bound to. The handle it returns names the `projectId` the run got, and `list_automations` shows each automation's `projectIds`, so a client never has to guess which project URL reads the run back on the REST side.

### Capabilities & knowledge

| Tool                  | What it does                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `search_capabilities` | Search everything this organization can do — its deployed automations, by name and description.                     |
| `invoke_capability`   | Invoke one capability by id. An action the organization gates returns a pending-approval result instead of running. |
| `get_knowledge`       | Retrieve passages from the organization's knowledge — its documents and its crawled web pages.                      |

In this version the registry holds the organization's deployed automations — `invoke_capability` on one is the same act as `run_deployed`. Builtin tools, connector actions, skills, and external MCP servers are not part of this registry; an id that is not a deployed automation answers a readable refusal, not an error. A capability the organization gates behind approval does not silently run — `invoke_capability` answers a pending-approval result the model can relay.

## What the key may do

The key proves who is calling; the key holder's role decides what the call may do, exactly as in the product:

- **Any member key** — every read tool, `run_automation` (always against the mocks), `search_capabilities`, `get_knowledge`.
- **Developer capability required** — `save_automation`, `deploy_automation`, `set_trigger`, `delete_trigger`, `cancel_run`, and live execution (`run_deployed`, `start_run`).

A refused call is not a protocol error: the tool answers a readable refusal — `{"error": "...", "code": "...", "hint": "..."}`, where `code` is the stable value to branch on (`AUTOMATION_NOT_FOUND`, …) and `hint` what to do — so the calling model can adjust instead of crashing, and the result carries `isError: true` so a generic client can tell it from success without parsing the text. That convention holds everywhere: validation problems, missing deployments, role refusals and a knowledge base that could not be searched all come back as data with the flag set, exactly like a call that threw. A capability that answers `pending` — a memory saved for a human's approval — is an outcome, not a failure, and keeps `isError` false; a `refused` capability (an unknown id, arguments its schema rejects, no deployment) is a failure and carries the flag.

## Where this fits

The MCP endpoint and the [REST API](/develop/api-reference) are one surface with two dialects — same key, same organization scoping, same run objects (`start_run` here and `POST .../runs` there produce the same durable run). Tale does not connect to MCP servers of its own in this version — the endpoint is its one MCP surface, and the direction is always inward: your client drives Tale.
