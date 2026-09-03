---
title: Agent knowledge
description: There is no per-agent Knowledge tab in this version — knowledge is managed organization-wide and reached through the chat assistant's retrieval tools and a project agent's platform tools.
---

This page used to describe a **Knowledge** tab on the agent editor with one setting — which corpus an agent's retrieval may read. That tab is not part of this version of Tale. Knowledge itself is very much there: the organization's documents and crawled websites are indexed under **Knowledge**, the chat assistant searches them whenever a question calls for it, and a project agent reads them through its platform tools.

<Note>

The per-agent knowledge scope is not available as a setting in this version. The persona file format still carries a `knowledge` field, but no screen sets it and chat does not run personas.

</Note>

## Where knowledge is decided today

The sources are organization-wide. Upload and organize files under [Documents](/platform/knowledge/documents), add sites to crawl under [Websites](/platform/knowledge/crawling), and read the [Knowledge overview](/platform/knowledge/overview) for how indexing works. Everything indexed belongs to your organization, so nothing an agent retrieves ever crosses into another tenant's material.

The **chat assistant** reaches that material through `rag_search` and `rag_fetch` — it searches when the question calls for it, loads the full passage it found, and answers from it. A document that has not finished indexing is not retrievable yet, so an assistant that seems to ignore an obvious source is usually waiting on the index. When the knowledge base cannot be searched at all — no embedding model configured, the corpus not yet populated — the assistant is told so in the tool result and says so, rather than answering as if nothing existed.

A **project agent** reads documents and knowledge through the platform tools you equip it with, scoped to its project: it never sees another project's board or files. [Project agents](/platform/projects/project-agents) covers the equipment; the [MCP endpoint](/develop/mcp-endpoint) gives a client outside Tale the same retrieval through `get_knowledge`.

## Where this fits

Knowledge is a property of the organization in this version, not of an agent: you decide what is indexed, and every lane — chat, project agents, the MCP endpoint — reads from that one pool with its own access rules. The [Knowledge overview](/platform/knowledge/overview) is the place to shape it; [Agent tools](/platform/agents/tools) covers the rest of what an agent can do.
