---
title: Build a custom tool
description: A Settings > Custom tools panel is not part of this version — this page shows the three places your own code reaches an agent today.
---

This tutorial used to define a tool under a **Settings > Custom tools** panel, wire it to an HTTPS endpoint, and toggle it on for an agent. None of that exists in this version of Tale: there is no custom-tool registry, no per-agent tool toggle, and the chat assistant's tools are fixed. What you can do is put your code where agents already look — a connector action, an automation node, or a secret a project agent uses to call your API.

<Note>

Custom tools are not available in this version. The chat assistant carries exactly three read-only tools — `rag_search`, `rag_fetch`, and `web_fetch` — and no screen adds a fourth.

</Note>

## Where your code reaches an agent

Pick by who should run it. A **project agent** works board tasks in its own sandbox; equip it on the project's **Agents** tab under **Skills, connectors & tools**, and add a **Secret** — an API key delivered as an environment variable — when the service you want it to call has no connector. The agent reads the vendor's docs and calls the API itself. [Project agents](/platform/projects/project-agents) walks the dialog.

An **automation** runs without a person in the loop. Its nodes call connector actions and run your own JavaScript in `transform` nodes, on a schedule or a webhook; author it on the canvas or [upload it as a pack](/platform/automations/catalog). [Automation concepts](/platform/automations/concepts) is the model underneath.

A **connector** is the shipped, vendor-specific bridge — GitHub, Gmail, Outlook, Slack and the rest. Reach for it first when one exists for your target; [Connectors overview](/platform/connectors/overview) lists what ships and what each needs.

## Where this fits

The seam between an agent and your domain has moved from a per-organization tool registry to the places work already runs: a project agent's equipment and secrets, an automation's nodes, and the shipped connectors. A model outside Tale that should drive these gets the [MCP endpoint](/develop/mcp-endpoint); the REST equivalent is the [API reference](/develop/api-reference).
