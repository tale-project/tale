---
title: Agent tools
description: There is no per-agent Tools tab in this version — the chat assistant carries a fixed read-only loadout, and project agents are equipped on their own dialog.
---

This page used to describe the agent editor's **Tools** tab: a catalog of per-tool switches grouped into category cards, with web search, **Run code**, and connected MCP servers among them. That tab is not part of this version of Tale. What an agent can do is decided in two other places — a fixed loadout for the chat assistant, and the equipment you give a project agent when you create it.

<Note>

The per-agent tool catalog is not available in this version. Chat carries three read-only tools and no switch adds a fourth; project agents are equipped on the project's **Agents** tab.

</Note>

## What agents can do today

The **chat assistant** has exactly three tools, fixed by design: `rag_search` searches the organization's knowledge, `rag_fetch` loads the full content of something it found, and `web_fetch` fetches a public page. Chat is for questions and retrieval; it produces no files and runs no code, so a deliverable — a document, a spreadsheet, a translated file — is made on a task instead.

A **project agent** is equipped in its dialog under **Skills, connectors & tools**: skills stage reference bundles into its sandbox, connectors broker a connected service, and platform tools let it read — and, when you grant a write tool, change — the organization's own tasks, contacts, products, documents, and knowledge, scoped to its project. **Secrets** hand it an API key as an environment variable for a service that has no connector. It runs in an isolated sandbox with a shell, so running code is part of the harness rather than a switch. [Project agents](/platform/projects/project-agents) walks the dialog.

An **automation** reaches the same connectors through its nodes and runs on a trigger instead of a request — [Automation concepts](/platform/automations/concepts) is the model. External MCP servers are not connected in this version; the one MCP surface is the [inbound endpoint](/develop/mcp-endpoint), which lets clients outside Tale drive it.

## The retired editor

Readers of the previous manual will remember the Tools tab below. It is shown only so the change is recognizable — no screen in this version renders it, and nothing on it can be toggled.

<Frame caption="The Tools tab of the earlier agent editor — a screen this version does not ship.">

![The agent editor's Tools tab scrolled to the category cards, with Knowledge at three of four tools checked and Files at seven of seven, while Conversations, Discussions, Analytics, and Tasks & projects have none granted.](/images/platform/agent-editor-tools.webp)

</Frame>

## Where this fits

Tools follow the lane: chat retrieves, a project agent acts inside its project with the equipment you gave it, and an automation acts on a trigger. Read [Project agents](/platform/projects/project-agents) for the equipment dialog and [Agent knowledge](/platform/agents/knowledge) for how retrieval is scoped in this version.
