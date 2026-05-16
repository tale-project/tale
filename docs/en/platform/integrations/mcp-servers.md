---
title: MCP servers
description: Connect external Model Context Protocol servers so their tools and resources show up as agent tools.
---

A Model Context Protocol (MCP) server is an external process that publishes a catalogue of tools, resources, and prompts over a small standardised RPC. Tale registers one once and then makes its tools available to every agent in the organisation that opts in. Where a Tale [integration](/platform/integrations/overview) wraps a vendor's REST or SQL surface in a manifest you author and ship, an MCP server lets the third party publish the tool catalogue and Tale consumes it without writing a connector at all. This page is the reference for **Settings > MCP servers** and the schema behind it; the audience is Admin and Developer.

## A worked registration

The shortest path to a working MCP server is a public Streamable HTTP endpoint with an API key. Open **Settings > MCP servers > Add MCP server** and fill in:

```json
{
  "name": "example-tools",
  "displayName": "Example Tools",
  "transportType": "streamable_http",
  "url": "https://mcp.example.com/mcp",
  "authType": "api_key"
}
```

Save, paste the API key when the form asks for it, and the server moves into the `discovering` status. The discovery RPC calls `tools/list` on the server within seconds; the status flips to `active` and the discovered tools become available to enable on agents under **Agents > [agent] > Tools**.

## Transport types

Three transports cover where an MCP server can run. Pick by how Tale reaches it.

| Transport         | Reach for when …                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `streamable_http` | The server is a public HTTP service speaking the MCP Streamable HTTP transport. Default for hosted MCP servers.            |
| `sse`             | The server is an HTTP service speaking the older Server-Sent Events transport. Kept for compatibility with older servers.  |
| `stdio`           | The server is a local process Tale spawns by command. Only valid on self-hosted instances where Tale can launch processes. |

`streamable_http` and `sse` both need a `url`. `stdio` needs a `command`, optional `args`, and an optional `env` map for environment variables passed to the spawned process.

## Authentication

Three auth shapes cover the common cases.

| Auth type | What Tale stores                                                                                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`    | Nothing. The server is open or auth-free (typical for `stdio` transports running locally).                                                                                             |
| `api_key` | A single API key, passed on every request per the server's convention.                                                                                                                 |
| `oauth2`  | An OAuth 2.0 client config (token URL, optional authorisation URL, client id and secret, scopes, grant type) plus the access and refresh tokens Tale obtains after the flow completes. |

OAuth 2.0 supports two grant types. `client_credentials` is the server-to-server case; `authorization_code` is the case where an admin authorises Tale to act on behalf of an account, with a redirect to the authorisation URL when the integration is connected. In both cases Tale stores access and refresh tokens and refreshes the access token automatically before it expires. Every secret — API keys, client secrets, access tokens, refresh tokens — is encrypted at rest and scoped to your organisation.

## Status states

Every MCP server entry carries a status that mirrors the connection health.

| Status        | What it means                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| `discovering` | Initial state after registering. Tale is calling `tools/list` to populate the discovered-tools array.              |
| `active`      | Discovery succeeded and the server is reachable. Tools are available to enable on agents.                          |
| `inactive`    | An admin disabled the server. The discovered tool list is preserved, so re-enabling skips re-discovery.            |
| `error`       | The last connection attempt failed. The reason is in the last-error field; fix credentials or the URL and re-test. |

## Discovered tools

Once discovery completes, the server's tool catalogue lands in the **Discovered tools** section of the server detail. Each tool has a name, an optional description, an optional input schema (JSON Schema for parameters), and an optional **requires approval** flag.

The **requires approval** flag is the load-bearing field. When it is set, every invocation of that tool generates an approval card in the chat — the same flow as a `write` operation on a Tale-native integration. Reach for it on tools that touch billing systems, send messages on someone's behalf, or modify production data. The full doctrine — who can approve, how the card looks, how rejects propagate — is at [Approvals](/platform/workspace/approvals).

The discovered list is what agent owners pick from under **Agents > [agent] > Tools > MCP servers**. Enabling a server on an agent grants the agent access to that server's tools; per-tool granularity lives on the agent's tool configuration, not on the server registration.

## Where this fits

MCP servers are the "bring your own tool catalogue" path; [integrations](/platform/integrations/overview) are the "wrap a vendor we know about" path. They coexist — one agent can use both, and both show up in the same agent tool picker. Reach for an MCP server when the server already exists (a third party publishes one for their product) and for a connector when you control the wrapper and want Tale's read/write operation model and the **Configuration guide** UX.

To enable an MCP server's tools on a specific agent, open the agent and follow the **Tools** section of [Create an agent](/platform/agents/create). To audit which agents have which MCP tools enabled, the [Audit log](/platform/admin/governance#audit-log) records every enable and disable change with the actor and timestamp.
