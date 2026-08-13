---
title: MCP endpoint
description: Connect an MCP client to Tale — one endpoint, 22 tools covering automation authoring, run and trigger management, and the organization's capability surface.
i18nLintExclude:
  - terminology-loanword
---

Tale is itself an MCP server. Point any MCP client — an agent harness, an IDE, your own SDK loop — at one endpoint and it can author and operate automations, search what the organization can do, invoke a capability, and retrieve knowledge, with the same API key the REST surface takes. Where REST is the connector seam for your code, the MCP endpoint is the seam for _models_: every tool answers text a model can read and act on.

Read this to connect a client and understand the tool inventory. The grammar for authoring automations is deliberately not duplicated here — the endpoint teaches it itself through `get_docs`.

## Connect a client

The endpoint speaks MCP protocol `2025-03-26` as JSON-RPC over HTTPS — plain JSON responses, no SSE stream, one message per request (a batch answers error `-32600`). Authenticate with an organization API key ([API keys](/platform/admin/api-keys) covers minting one):

```json
// POST https://your-host.example.com/api/v1/mcp
// Authorization: Bearer tale_...
{ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }
```

The server identifies as `tale-platform`. In a client that takes a config block, that is all you need:

```json
{
  "mcpServers": {
    "tale": {
      "url": "https://your-host.example.com/api/v1/mcp",
      "headers": { "Authorization": "Bearer tale_..." }
    }
  }
}
```

`tools/list` returns the full inventory; `GET` on the endpoint answers **405** — there is no event stream to subscribe to.

## The tools

Twenty-two tools, in three groups. The authoring tools take whole automation documents and validate everything themselves — their schemas are open on the wire, and `get_docs` is the reference a model reads first. The management and capability tools take simple arguments and declare real JSON schemas.

### Authoring

| Tool                  | What it does                                               |
| --------------------- | ---------------------------------------------------------- |
| `get_docs`            | The automation grammar and authoring guide, as text.       |
| `get_catalog`         | Every node type this deployment can execute.               |
| `search_catalog`      | Search the node-type catalog by keyword.                   |
| `validate_automation` | Validate an automation document without saving it.         |
| `run_automation`      | Run an automation document directly (mock or live mode).   |
| `test_automation`     | Run an automation's own acceptance tests.                  |
| `save_automation`     | Save an automation document as a new immutable version.    |
| `get_automation`      | Read one saved version (the latest when unversioned).      |
| `list_automations`    | The organization's automations with their latest versions. |
| `deploy_automation`   | Promote one saved version to be the live version.          |

### Run & trigger management

| Tool             | What it does                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `run_deployed`   | Run the deployed version and WAIT for the finished result — output, trace and effects in one answer.           |
| `start_run`      | Start the deployed version in the background and return a run handle immediately; poll get_run for the result. |
| `list_runs`      | Recent runs, newest first — of one automation or of the whole organization.                                    |
| `get_run`        | One run in full: status, output, trace and effects.                                                            |
| `cancel_run`     | Stop a run at its next node boundary.                                                                          |
| `list_versions`  | One automation's immutable version history.                                                                    |
| `list_triggers`  | What starts the automations (never the webhook secret).                                                        |
| `delete_trigger` | Unbind an automation's trigger; its versions and run history stay.                                             |
| `set_trigger`    | Bind what starts the automation (schedule/webhook/event).                                                      |

Pick `run_deployed` when the automation is quick and you want one call with the answer in it. Pick `start_run` when the run may take minutes — it returns a `runId` immediately, and `get_run` polls it. Both run live.

`start_run` also takes an optional `projectId` — the project the run operates in, so its task and document tools act there. Omit it for an organization-wide run, or, when the automation is bound to a single project, that one. A bound automation accepts only a project it is bound to.

### Capabilities & knowledge

| Tool                  | What it does                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `search_capabilities` | Search everything this organization can do — its automations, connector actions, skills and tools.                  |
| `invoke_capability`   | Invoke one capability by id. An action the organization gates returns a pending-approval result instead of running. |
| `get_knowledge`       | Retrieve passages from the organization's knowledge — its documents and its crawled web pages.                      |

This is the same registry a chat turn sees: one namespace over builtins, connector actions, skills, automations, and connected MCP tools. A capability the organization gates behind approval does not silently run — `invoke_capability` answers a pending-approval result the model can relay.

## What the key may do

The key proves who is calling; the key holder's role decides what the call may do, exactly as in the product:

- **Any member key** — every read tool, `run_automation` in mock mode, `search_capabilities`, `get_knowledge`.
- **Developer capability required** — `save_automation`, `deploy_automation`, `set_trigger`, `delete_trigger`, `cancel_run`, and live execution (`run_deployed`, `start_run`, `run_automation` in live mode).

A refused call is not a protocol error: the tool answers a readable refusal — `{"error": "...", "hint": "..."}` — so the calling model can adjust instead of crashing. That convention holds everywhere: validation problems, missing deployments, and role refusals all come back as data; `isError` is reserved for a call that actually threw.

## Where this fits

The MCP endpoint and the [REST API](/develop/api-reference) are one surface with two dialects — same key, same organization scoping, same run objects (`start_run` here and `POST .../runs` there produce the same durable run). Building an MCP server of your own that Tale consumes is the opposite direction — that is [MCP servers](/platform/connectors/mcp-servers) under connectors.
