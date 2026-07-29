---
title: Developer
description: Developer is the in-app developer surface — API keys, custom tools, agent webhooks, MCP servers. The pages here are what someone with the Developer role clicks through when they wire Tale to external code.
---

Developer is the in-app surface for the people who wire Tale to the rest of their stack. It groups the four levers that let external code talk to Tale and Tale talk to external code: API keys for the REST surface, custom tools that extend an agent's reach, agent webhooks for inbound triggers, and MCP servers for the external-process bridge. People with the Developer role see this menu; Members and Editors do not.

This overview names what each page covers and points to the deeper reference. Developer-role users typically land here on their first day, set up the credentials and tools they need, and come back when they extend the stack — adding a new MCP server, rotating a key, registering a new webhook.

## What Developer covers

The Developer surface sits beside the rest of the org's settings but with a narrower audience. It assumes you know what a REST API is, what a webhook looks like, and what an MCP server does — the pages do not re-explain the underlying concepts; they explain how Tale exposes them.

The same surface in the Cloud and self-hosted tabs differs only in deployment shape; the UI here is identical. The configuration-file equivalents of some of these features (env vars, JSON configs for custom tools) live one tab over in the self-hosted documentation.

## Pages in this section

<CardGroup cols="2">

<Card title="API keys" icon="key" href="/platform/admin/api-keys">

Wire a script, a cron job, or an internal service to Tale's REST API. Shared with Admin under Settings > API keys.

</Card>

<Card title="MCP servers" icon="server" href="/platform/connectors/mcp-servers">

Register an external MCP-protocol process and pick which of its tools the org's agents may call.

</Card>

<Card title="Agent tools" icon="wrench" href="/platform/agents/tools">

Extend an agent's toolbelt with a custom tool the org's agents can call.

</Card>

</CardGroup>

## Where this fits

Developer is the bridge between Tale and the rest of the codebase the org runs. The natural first read depends on what you came to wire — for outbound (something inside Tale calls outside) [Agent tools](/platform/agents/tools) and [MCP servers](/platform/connectors/mcp-servers); for inbound (something outside calls into Tale) [API keys](/platform/admin/api-keys).
