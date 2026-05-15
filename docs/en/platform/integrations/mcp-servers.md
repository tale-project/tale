---
title: MCP servers
description: Connect external Model Context Protocol servers to Tale so their tools and resources show up as agent tools.
---

A Model Context Protocol (MCP) server is an external process that exposes a set of tools, resources, and prompts over a small standardised RPC. Tale registers an MCP server once and then makes its tools available to every agent in the organisation that opts in. Where a Tale [integration](/platform/integrations/overview) wraps a vendor's REST or SQL surface in a Tale-authored manifest, an MCP server lets a third party publish its own tool catalogue — and Tale consumes it without writing a connector.

This page is the reference for the **Settings > MCP servers** screen and the on-disk schema behind it. The audience is Admins and Developers connecting an MCP server to an organisation. Members and Editors don't see this surface; they just see new tools appear on their agents.

## A worked example

The shortest path to a working MCP integration is to register a public Streamable HTTP server with API-key auth. To register the `example-tools` server at `https://mcp.example.com`, open **Settings > MCP servers**, click **Add MCP server**, and fill in:

```json
{
  "name": "example-tools",
  "displayName": "Example Tools",
  "transportType": "streamable_http",
  "url": "https://mcp.example.com/mcp",
  "authType": "api_key"
}
```

After saving, Tale prompts for the API key, stores it encrypted, and moves the server into the `discovering` state. The discovery RPC returns the server's tool list within seconds; the status flips to `active` and every discovered tool is now available to enable on agents at **Agents > [agent] > Tools**.

## Transport types

Tale supports three MCP transports. Pick by where the server runs and how Tale reaches it.

| Transport         | When to pick it                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `streamable_http` | The server is a public HTTP service speaking the MCP Streamable HTTP transport. The default for hosted MCP servers.                                                       |
| `sse`             | The server is an HTTP service speaking the older Server-Sent Events transport. Still supported for compatibility with older servers.                                      |
| `stdio`           | The server is a local process Tale spawns via a command (`command` + `args`). Only valid on self-hosted instances where the process can run alongside the Tale container. |

`streamable_http` and `sse` both need a `url`; `stdio` needs `command`, optional `args`, and optional `env` map for environment variables passed to the spawned process.

## Authentication

Three auth types cover the common shapes:

| Auth type | What Tale stores                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `none`    | Nothing. The server is open or auth-free (typical for `stdio` transports running locally).                                                                                                             |
| `api_key` | A single API key (`apiKeyEncrypted`), passed on every request per the server's convention.                                                                                                             |
| `oauth2`  | An OAuth 2.0 client config (`tokenUrl`, optional `authorizationUrl`, `clientId`, `clientSecretEncrypted`, `scopes`, `grantType`) plus the access/refresh tokens Tale obtains after the flow completes. |

OAuth2 supports two grant types: `client_credentials` for server-to-server, and `authorization_code` for flows where an admin authorises Tale to act on behalf of an account. The latter triggers a redirect to the `authorizationUrl` when the integration is connected; Tale stores both access and refresh tokens and refreshes the access token automatically when it expires.

All secrets — `apiKeyEncrypted`, `clientSecretEncrypted`, `accessTokenEncrypted`, `refreshTokenEncrypted` — are stored encrypted at rest, scoped to the organisation.

## Status states

Every MCP server entry carries a `status` field that mirrors the connection health.

| Status        | Meaning                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `discovering` | Initial state after registering. Tale is calling the server's `tools/list` RPC to populate `discoveredTools`.        |
| `active`      | Discovery succeeded and the server is reachable. Tools are available to enable on agents.                            |
| `inactive`    | The admin manually disabled the server. The discovered tool list is preserved; enabling it again skips re-discovery. |
| `error`       | The last connection attempt failed. The reason is in `lastError`; fix the credentials or the URL and re-test.        |

## Discovered tools

When discovery completes, the server's tool catalogue lands in the `discoveredTools` array. Each tool has a `name`, optional `description`, optional `inputSchema` (JSON Schema for parameters), and an optional `requiresApproval` flag.

`requiresApproval: true` makes every invocation of that tool generate an approval card in the chat — the same flow as a `write` operation on a Tale-native integration. Use it for tools that touch billing systems, send messages on someone's behalf, or modify production data. The full approvals doctrine is at [Approvals](/platform/workspace/approvals).

The discovered list is what agent owners pick from when enabling MCP tools at **Agents > [agent] > Tools > MCP servers**. Enabling an MCP server on an agent grants access to all of that server's tools; granularity at the per-tool level lives on the agent's tool config, not on the MCP-server registration.

## Where this fits

MCP servers are the "bring your own tool catalogue" path; [integrations](/platform/integrations/overview) are the "wrap a vendor we know about" path. They coexist — an agent can use both — and both show up in the same agent tool picker. Reach for MCP when the server already exists (a third-party publishes one for their product) and for a connector when you control the wrapper and want Tale's read/write semantics, the operations table, and the connector's setup guide.

To enable an MCP server's tools on a specific agent, open the agent and follow the [Tools section](/platform/agents/create) of the agent build flow. To audit which agents have which MCP tools enabled, the [Audit log](/platform/admin/governance) records every enable/disable change with the actor and timestamp.
