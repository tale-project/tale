---
title: MCP servers
description: Registering external MCP servers for agents to call is not part of this version — Tale's one MCP surface is the inbound endpoint under Settings > API > MCP.
---

This page used to describe an **Add MCP server** form: a transport, an authentication method, an allowed-agents list, and a discovered-tools table with per-tool approval flags. None of that exists in this version of Tale. There is no MCP servers panel, no registration form, and no agent toolbelt an external server could join — a capability that would route to an external MCP tool is refused at runtime with a readable reason. What ships is the opposite direction: Tale is itself an MCP server that clients outside it connect to.

<Note>

Outbound MCP servers are not available in this version. The former **Settings > MCP servers** address redirects to **Settings > Connectors**, which lists the connectors Tale ships and nothing MCP-specific.

</Note>

## The MCP surface that ships

Tale exposes one MCP endpoint per deployment at `/api/v1/mcp`, authenticated with an organization API key. Twenty-two tools sit behind it in three groups — authoring and deploying automations, running them and reading their runs, and searching and invoking what the organization can do. **Settings > API > MCP** shows your deployment's endpoint URL, the inventory in those three groups, and under **Try it** a copyable `tools/list` request. [MCP endpoint](/develop/mcp-endpoint) is the reference — protocol, tool table, and what each role's key may do; [API keys](/platform/admin/api-keys) covers minting the key.

<Frame caption="Settings > API > MCP — the endpoint URL to point a client at, the tool inventory in its three groups, and a request to try the key with.">

![The MCP page under Settings > API showing the MCP endpoint row with the deployment's URL ending in /api/v1/mcp and a copy button, three rows listing tool names by group — Authoring, Run & trigger management, Skills & knowledge — and a Try it row holding a curl request that calls tools/list with a bearer API key.](/images/platform/settings-mcp-endpoint.webp)

</Frame>

## Reach your own code from an agent today

Wrapping your own service so an agent can use it takes one of three shapes in this version. A [connector](/platform/connectors/overview) is the vendor-specific bridge Tale ships — reach for it when one exists for the target system. An [automation](/platform/automations/catalog) calls connector actions and runs your own JavaScript in `transform` nodes on a schedule or a webhook, and you upload it as a pack. A [project agent](/platform/projects/project-agents) holds **Secrets** — an API key handed to it as an environment variable — so it can call a service that has no connector straight from its sandbox.

## Where this fits

The MCP surface in this version points inward: external clients drive Tale, not the other way round. When a model outside Tale should author automations or search the organization's knowledge, connect it to the [MCP endpoint](/develop/mcp-endpoint); when an agent inside Tale should reach your code, use a connector, an automation, or a project agent's secrets — the [Connectors overview](/platform/connectors/overview) opens that path.
