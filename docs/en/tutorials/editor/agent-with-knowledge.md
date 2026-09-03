---
title: Build an agent with knowledge
description: Binding documents to an agent is not part of this version — knowledge is organization-wide, indexed under Knowledge, and the chat assistant and project agents read it from there.
---

This tutorial used to bind three documents to a fresh agent: create it under **Agents > New agent** with the RAG tool on, open its **Knowledge** tab, pick the documents, then chat with the agent and check the citations. None of those screens exist in this version of Tale — there is no agent editor, no per-agent **Knowledge** tab, and no agent to open a chat with. Knowledge itself is very much there; it belongs to the organization rather than to an agent, and every lane reads from that one pool.

<Note>

Per-agent document binding is not available in this version. Upload documents under **Knowledge**; the chat assistant searches them when a question calls for it, and a project agent reads them through the platform tools you equip it with.

</Note>

## Get answers from your documents today

Upload the documents under [Documents](/platform/knowledge/documents) and wait for indexing to finish — a document that has not finished indexing is not retrievable yet. Then ask the **chat assistant**: it searches the organization's knowledge with `rag_search` whenever the question calls for it, loads the passage it found with `rag_fetch`, and lists what it actually read under **Sources** below the reply — derived from the tool results, so a source card never claims reading that did not happen. When the knowledge base cannot be searched at all — no embedding model configured, the corpus not yet populated — the assistant says so instead of answering as if nothing existed. There is no way to narrow the assistant to three documents; it reads the organization's knowledge.

A **project agent** reads documents and knowledge entries through the platform tools you equip it with under **Skills, connectors & tools**, scoped to its project. Its **Instructions** are where the old tutorial's rule lives now — "answer only from the organization's documents, cite the title, refuse when nothing matches" — and the result comes back as a task comment at **In review**, where you check the citation before accepting. [Project agents](/platform/projects/project-agents) walks the equipment; [Build your first agent](/tutorials/editor/first-agent-end-to-end) creates one from scratch.

## Where this fits

Knowledge is a property of the organization in this version, not of an agent: you decide what is indexed, and chat, project agents, and the MCP endpoint's `get_knowledge` read from that one pool with their own access rules. [Agent knowledge](/platform/agents/knowledge) is the conceptual side; the [Knowledge overview](/platform/knowledge/overview) is where you shape the pool — documents, and the websites you crawl into it.
