---
title: Stand up an MCP server from scratch
description: Wire a Model Context Protocol server as a custom connector so any Tale agent in the org can call its tools.
---

A Model Context Protocol (MCP) server is a process that exposes a list of tools over a small JSON-RPC protocol. Tale registers an MCP server once at the org level; from then on, every agent whose tools tab includes that server can call its tools. This walk takes a brand-new MCP server from "empty repo" to "called by an agent in a chat" on one Tale instance.

You need a Developer role, a host that can run the MCP server (your laptop is fine for the walk; a managed service or container for production), and an HTTPS URL Tale can reach. Cloud orgs reach public URLs by default; self-hosted instances need network access to wherever the MCP server runs.

## Before you begin

Confirm two things. You have Node 20 or Python 3.11 installed — the official MCP SDKs target those runtimes. The Tale instance can reach your MCP server's URL — for local development, an `ngrok` tunnel or equivalent works; for production, host the server somewhere with a stable HTTPS endpoint. The conceptual side of MCP in Tale lives in [Agent tools](/platform/agents/tools); this walk is the wiring.

## Step 1 — Scaffold the server

The first move is generating the minimum MCP server — one tool, one handler. The official SDK does the protocol plumbing so you only write the tool.

```bash
npm create mcp-server@latest hello-tale
cd hello-tale
```

Open `src/index.ts` and replace the example tool with one that returns the current time in a named timezone:

```ts
server.tool(
  'current_time',
  'Return the current time in a given timezone',
  { timezone: z.string() },
  async ({ timezone }) => {
    const now = new Date().toLocaleString('en-US', { timeZone: timezone });
    return { content: [{ type: 'text', text: now }] };
  },
);
```

Run the server locally:

```bash
npm run start
```

The server listens on `http://localhost:3000/mcp` by default. The scaffold is in place; nothing in Tale knows about it yet.

## Step 2 — Expose it on HTTPS

MCP servers Tale can call need an HTTPS URL with a valid certificate. For local development, point an `ngrok` tunnel at port 3000 and copy the public URL the tunnel prints. For production, host the server behind your normal ingress — Caddy, Nginx, a managed function, anything that terminates TLS.

Verify the public URL responds to a health check:

```bash
curl -sS "https://abcd.ngrok.app/mcp/health"
```

A 200 confirms reachability. A 502 or timeout means the tunnel is not forwarding; restart it or check the firewall.

## Step 3 — Register the server in Tale

A reachable MCP server is invisible to Tale until you register it. Open **Settings > Connectors > MCP servers** and click **New server**. Fill in:

- **Name** — `Hello Tale time`
- **URL** — the public HTTPS URL from Step 2 (e.g. `https://abcd.ngrok.app/mcp`)
- **Auth** — bearer token if your server requires it, none for the walk

Click **Save**. Tale calls the server's `list_tools` method to discover the tool inventory; the panel shows `current_time` with its description. The server is now registered org-wide.

## Step 4 — Attach the server to an agent and call the tool

A registered server is reachable only by agents that opt in. Open any agent, click **Tools > MCP**, toggle **Hello Tale time** on, and save. Open a chat with the agent and ask "what time is it in Tokyo right now". The chat renders a `current_time` tool-call card; expanding it shows `{ "timezone": "Asia/Tokyo" }` and the timestamp your server returned, and the agent's reply uses the timestamp.

## Where this fits

An MCP server is the right shape when a tool needs to live outside Tale — code your team owns, a service in another network, a third-party API you wrap. Custom tools in [Build a custom tool](/tutorials/developer/build-a-custom-tool) are the right shape when the tool is one-off and lives inside one org's settings.

For the bigger picture of how tools widen what an agent can do, see [Agent tools](/platform/agents/tools). For wiring an connector that wraps a third-party API instead of your own code, [Connectors overview](/platform/connectors/overview) is the next read.
