---
title: Agent knowledge
description: The agent's Knowledge tab — retrieval mode, team and organization document scopes, and agent-only uploads, and how they differ from tools and attachments.
---

Knowledge is what an agent can retrieve and cite at reply time. Without it the agent is generic; with it the agent answers from your documents and cites where the answer came from. The agent's **Knowledge** tab controls two things: _how_ the agent retrieves (the retrieval mode) and _what_ is in scope (which documents).

<Frame caption="The Knowledge tab — retrieval mode above, the document scopes and agent uploads below.">

![The agent editor's Knowledge tab showing the four retrieval modes, the team and organization document toggles, three indexed organization documents, and the agent documents upload area.](/images/platform/agent-editor-knowledge.webp)

</Frame>

## Pick a retrieval mode

Four modes trade cost against coverage. **Tool** lets the agent search on demand — retrieval runs only when the model decides it needs it. **Context** injects relevant knowledge into every response, whether the model would have asked or not. **Both** combines them, and **Off** disables the knowledge base for this agent entirely. Start with **Tool**; move to **Context** when the agent's whole job is answering from the documents and you want retrieval on every reply.

## Scope the documents

The knowledge base searches documents uploaded to your organization — the same library you manage under [Documents](/platform/knowledge/documents). Two switches set the scope: **Include team documents** covers the agent's assigned team, and **Include organization documents** covers documents not assigned to any team. The tab lists what each scope currently contains, with the index state per document — only **Indexed** documents are retrievable.

## Give the agent its own documents

**Agent documents** are uploads only this agent can access — click **Upload documents** and the files join this agent's retrieval scope without entering the shared library. Reach for them when the source belongs to the agent's job rather than the org: a triage playbook, a product-specific FAQ.

## How retrieval lands in the reply

When the agent retrieves, citations attach to the sentences they support — hovering shows the source, clicking opens it. Everything retrievable competes for relevance on every question, so keep the scope tight: a broad scope makes retrieval noisier, not smarter.

## When to reach for it

Structured records and live sources are tools, not knowledge — and files for a single conversation are attachments. The boundaries:

| Use…                                                | When the agent needs…                                   |
| --------------------------------------------------- | ------------------------------------------------------- |
| Knowledge (this tab)                                | To search and cite uploaded documents on every chat     |
| [Tools](/platform/agents/tools)                     | Customers, products, vendors, websites, or live systems |
| [Attachments](/platform/chat/attachments)           | A file that matters for one chat only                   |
| [Project agents](/platform/projects/project-agents) | Knowledge scoped to one Project                         |

## Where this fits

Agent knowledge is the answer to "this agent should answer from these documents". The wider [Knowledge](/platform/knowledge/overview) section is where the sources live and get indexed; this tab wires one agent into a scope of them. For the end-to-end build — upload, scope, ask, verify the citations — walk [Agent with knowledge](/tutorials/editor/agent-with-knowledge).
