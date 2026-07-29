---
title: MCP servers
description: Register external tool servers under Settings > API > MCP — transport, authentication, the discovered tool list, and the per-tool approval flags that keep the trust boundary tight.
---

An MCP server is an external process that exposes tools to Tale's agents over the Model Context Protocol. Where an [connector](/platform/connectors/overview) is a vendor-specific connector Tale ships, an MCP server is a generic bridge anyone can host — an internal API, a vendor without a connector, a script that computes something Tale's built-in tools cannot. You host the server; Tale only talks to it.

<Frame caption="The Add MCP server form — a connection and an authentication method are the whole registration.">

![The Add MCP server dialog under Settings API MCP, filled in for a support-tickets server — display name Support Tickets, a one-line description, Streamable HTTP as the transport type, the server URL, and an authentication method of None — over the MCP page, where an Internal Wiki server is already registered.](/images/platform/settings-mcp-add-dialog.webp)

</Frame>

## Registering a server

Open **Settings > API > MCP** and click **Add MCP server**. The form takes:

- **Name** and **Display name** — the identifier, and the label agents and approval cards show.
- **Transport type** — **Streamable HTTP**, **SSE**, or **stdio**. The HTTP transports take a **URL** — the form flags a malformed one inline before you can save; stdio takes the command Tale spawns.
- **Authentication** — **None**, **API Key**, or **OAuth 2.0** (token URL, client ID and secret, scopes).
- **Allowed agents** — which agents may bind to this server. The default is no agents; reach for **All agents** only when the server is generic enough that every agent benefits.

**Save server**, then use **Test connection** on the row to verify the handshake — the row's status shows **Connected**, **Disconnected**, or **Error** with the upstream message.

## The discovered tools

Once connected, Tale fetches the server's manifest and lists it as **Discovered Tools** — each tool's name, description, and whether the server flags it **Requires approval**. Flagged tools ask in chat every time an agent calls them, with the exact arguments shown on the card; unflagged tools run like any built-in tool.

<Warning>

Every MCP tool widens what your agents can reach, and the approval flags come from the server's author — connecting a server means accepting its tool contract. Read the discovered list before pointing agents at a server you did not write.

</Warning>

## Using it from agents

A registered, active server's tools join the toolbelt agents can call; the request travels through Tale to your server and the reply comes back into the conversation. The server can also expose resources and prompts where its author implements them — tools are the common surface.

## Deactivating and removing

Each server row can be deactivated — its tools drop out of agent toolbelts until you activate it again, with the registration kept. Deleting the server removes the registration entirely after a confirmation; re-adding it later is a fresh registration with a fresh manifest fetch.

## MCP server or connector

Both let an agent reach beyond Tale; the difference is who owns the connector. Connectors are vendor-specific, shipped, and maintained in the catalog; MCP servers are generic and yours to run. Reach for the connector when one exists for the target system; reach for MCP when you need the bridge to be your own code.

## Where this fits

MCP is the open-ended extension surface of the agent toolbelt. The natural next reads are [Agent tools](/platform/agents/tools) for how tools surface on an agent, [Configure approvals](/platform/approvals/configure) for the flags that hold risky calls, and the [MCP server from scratch](/tutorials/developer/mcp-server-from-scratch) tutorial for building one end to end.
