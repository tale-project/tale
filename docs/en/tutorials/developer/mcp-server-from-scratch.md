---
title: Stand up an MCP server from scratch
description: Registering your own MCP server for agents to call is not part of this version — Tale is the MCP server, so point your client at the inbound endpoint instead.
---

This tutorial used to walk you through hosting a Model Context Protocol server and registering it under Settings so agents in the organization could call its tools. That direction does not exist in this version of Tale: there is no MCP servers panel, no registration form, and a capability that would route to an external MCP tool is refused at runtime with a readable reason. What ships is the opposite direction — Tale itself is an MCP server that your tools connect to.

<Note>

Outbound MCP servers are not available in this version. The former **Settings > MCP servers** address redirects to **Settings > Connectors**, which lists the connectors Tale ships and nothing MCP-specific.

</Note>

## Connect your client to Tale instead

Tale exposes one MCP endpoint per deployment at `/api/v1/mcp`, authenticated with an organization API key. Twenty-two tools sit behind it: authoring and deploying automations, running them and reading their runs, and searching and invoking what the organization can do. **Settings > API > MCP** shows the endpoint URL for your deployment, the tool inventory in those three groups, and — under **Try it** — a copyable request you can paste into a terminal:

```bash
curl -X POST https://your-host.example.com/api/v1/mcp \
  -H 'Authorization: Bearer <api-key>' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The protocol details, the full tool table, and what each role's key may do are on [MCP endpoint](/develop/mcp-endpoint); minting the key is [API keys](/platform/admin/api-keys).

## Reach your own code from Tale today

Wrapping your own service so an agent can use it takes one of three shapes in this version. A [connector](/platform/connectors/overview) is the vendor-specific bridge Tale ships — reach for it when one exists for the target system. An [automation](/platform/automations/catalog) calls connector actions and runs your own JavaScript in `transform` nodes on a schedule or a webhook, and you upload it as a pack. A [project agent](/platform/projects/project-agents) holds **Secrets** — an API key handed to it as an environment variable — so it can call a service that has no connector straight from its sandbox.

## Where this fits

The MCP surface in this version points inward: external clients drive Tale, not the other way round. When you want a model outside Tale to author automations or search the organization's knowledge, connect it to the endpoint; when you want an agent inside Tale to reach your code, use a connector, an automation, or a project agent's secrets. [MCP endpoint](/develop/mcp-endpoint) is the reference for the first path; [Connectors overview](/platform/connectors/overview) opens the second.
