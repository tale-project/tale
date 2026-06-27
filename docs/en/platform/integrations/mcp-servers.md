---
title: MCP servers
description: MCP servers are external processes that expose tools to Tale's agents over the Model Context Protocol. Admins register them under Settings > MCP servers; the per-tool approval rule decides what each agent may call.
---

An MCP server is an external process that exposes tools to Tale's agents over the Model Context Protocol. Where a first-party integration is a vendor-specific connector Tale ships, an MCP server is a generic bridge anyone can host — the protocol is open, the contract is one of tools and resources, and the org decides per server what its agents may reach. Admins register MCP servers under **Settings > MCP servers**; Developers and Editors point agents at them.

This page is the reference for what an MCP server brings into Tale, how registration works, how the per-tool approval rule shapes what an agent may call, and how MCP servers differ from first-party integrations. The protocol itself is documented upstream; what follows is the Tale-side surface.

## What an MCP server brings

An MCP server speaks the Model Context Protocol over HTTP or stdio. Once registered, Tale fetches the server's tool manifest — a list of named tools, their input schemas, and what each one does — and exposes the tools as a tool family on every agent the server is bound to. The agent calls the tool the same way it calls any other tool; the request travels through Tale to the MCP server, the server's reply travels back, and the agent uses it in the reply.

The server can also expose **resources** (read-only context the agent can pull) and **prompts** (named templates the agent can compose). Tools are the most common surface; resources and prompts are optional capabilities a server may or may not implement.

## Registering a server

Open **Settings > MCP servers** and click **Add server**. The form asks for:

- **Name** — a human label that appears on the agent's tool list and on every approval card.
- **Transport** — HTTP or stdio. HTTP servers carry a URL; stdio servers carry a command Tale spawns. The URL must be a valid `http://` or `https://` address — the form flags a malformed one inline before you can save.
- **Authentication** — none, bearer token, or OAuth. Tokens go into a secret field; OAuth walks the dance like a first-party integration.
- **Allowed agents** — which agents may bind to this server. The default is no agents; reach for **All agents** only when the server is generic enough that every agent benefits.

Saving the form triggers a handshake: Tale connects to the server, fetches the manifest, and stores it. A handshake failure surfaces the upstream error next to the row.

## The per-tool approval rule

The first time an agent calls a tool from an MCP server, Tale surfaces an approval card to the org's MCP approver pool (configured under **Settings > Governance > MCP approvals**). The approver decides whether the tool is allowed for that agent. Three outcomes:

- **Approve once** — the tool runs this time, and the next call surfaces the card again.
- **Approve for this agent** — the tool is allowed for this agent forever; subsequent calls run without a card.
- **Deny** — the tool is blocked for this agent; subsequent calls fail with an authorisation error.

The per-tool approval is per agent and per tool. Approving the `read_file` tool for the support agent does not approve it for the sales agent, and does not approve the `write_file` tool on the same server. This is intentional — every tool on every MCP server widens the trust boundary, and the per-tool decision is how the org keeps the boundary tight.

## What an MCP server is good for

Reach for an MCP server when you want an agent to reach into something no first-party integration covers — an internal API, a vendor without a Tale connector, a local script that does a calculation Tale's built-in tools cannot. The deployment is on you; Tale only talks to the server.

A common pattern is one MCP server per internal service the agents need. The server runs alongside the rest of the org's infrastructure, speaks MCP, and the team that owns the service also owns the contract.

## Disabling and removing a server

Each server has an enabled toggle on its row. Disabling stops Tale from calling it; the server's tools stop appearing in agent tool lists, and any agent that depended on them surfaces a configuration error. Removing the server deletes its manifest and revokes every per-tool approval that referenced it.

Re-adding a server with the same name starts from a clean slate — the manifest is re-fetched, and every per-tool approval has to be re-decided. There is no opaque carry-over of approvals across a delete-and-re-add.

## MCP servers versus first-party integrations

Both surfaces let an agent reach beyond Tale; the difference is who owns the connector. First-party integrations are vendor-specific, ship as part of Tale, and carry the credentials and the operation list Tale's team maintains. MCP servers are generic, hosted by you, and carry whatever tools the server's author chose to expose. Reach for an integration when one exists for the target system; reach for an MCP server when you need to host the bridge yourself.

## Where this fits

MCP servers are the open-ended extension surface for an agent's toolbelt — the lever for when no first-party integration covers what you need. The natural next read is [Integrations overview](/platform/integrations/overview) for the first-party catalogue, and [Agent tools](/platform/agents/tools) for how an MCP server's tools surface to the agent and the trust boundary they widen.
