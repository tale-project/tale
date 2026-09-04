---
title: Developer
description: Developer is the in-app developer surface — API keys for the REST API, the MCP endpoint, and the connector credentials a Developer-role user wires Tale to external code with.
---

Developer is the in-app surface for the people who wire Tale to the rest of their stack. It groups the levers that let external code talk to Tale and let Tale reach outside: API keys for the REST surface, the MCP endpoint that MCP clients connect to, and the connector credentials behind what agents and automations can call. People with the Developer role see these settings; Members and Editors do not.

This overview names what each page covers and points to the deeper reference. Developer-role users typically land here on their first day, mint the credentials they need, and come back when they extend the stack — rotating a key, pointing a new MCP client at the endpoint, connecting another service.

## What Developer covers

The Developer surface sits beside the rest of the org's settings but with a narrower audience. It assumes you know what a REST API is, what a webhook looks like, and what an MCP client does — the pages do not re-explain the underlying concepts; they explain how Tale exposes them. Two levers the earlier version had are not part of this one: registering external MCP servers and defining custom tools. Your own code reaches an agent through a project agent's **Secrets** or an automation's nodes instead — [MCP servers](/platform/connectors/mcp-servers) says what replaced the first; [Project agents](/platform/projects/project-agents) walks the dialog where the second now lives.

The same surface in the Cloud and self-hosted tabs differs only in deployment shape; the UI here is identical. The configuration-file side — environment variables and provider files — lives one tab over in the self-hosted documentation.

## Pages in this section

<CardGroup cols="2">

<Card title="API keys" icon="key" href="/platform/admin/api-keys">

Wire a script, a cron job, or an internal service to Tale's REST API. Shared with Admin under **Settings > API > REST**.

</Card>

<Card title="MCP endpoint" icon="network" href="/develop/mcp-endpoint">

Point an MCP client at Tale — the endpoint URL, the tool inventory, and a copyable request sit under **Settings > API > MCP**.

</Card>

<Card title="Connector credentials" icon="plug" href="/platform/admin/connectors">

Add, default, disable, and reconnect the credentials the shipped connectors act with — what agents and automations can reach outside Tale.

</Card>

</CardGroup>

## Where this fits

Developer is the bridge between Tale and the rest of the codebase the org runs. The natural first read depends on what you came to wire — for inbound (something outside calls into Tale) [API keys](/platform/admin/api-keys) and the [MCP endpoint](/develop/mcp-endpoint); for outbound (something inside Tale reaches outside) [Connector credentials](/platform/admin/connectors) and a project agent's [Secrets](/platform/projects/project-agents).
