---
title: Agent knowledge
description: Binding documents, customers, products, vendors, and websites to an agent so it can cite them — and the difference between agent-bound knowledge and the Knowledge tab.
---

Knowledge bound to an agent is what the agent can reach for at reply time. Without a binding the agent is generic; with a binding it can answer questions about specific documents, customers, or websites and cite where the answer came from. This page covers the binding mechanic on the agent's **Knowledge** tab.

The knowledge sources themselves live in the [Knowledge](/platform/knowledge/overview) section — Documents, Customers, Products, Vendors, Websites. Binding is the act of giving one agent access to a subset of those sources; without binding, the agent cannot see them.

## A worked binding

Open an agent and click **Knowledge**. Click **Agent knowledge** and pick three documents from the org's library. Save. Open a chat with the agent and ask a question the documents answer. The reply streams in with citations — hovering shows the document title, clicking opens the document. The retrieval ran the RAG tool over the bound documents only; nothing else in the library was reachable.

## Source types

Five source types are bindable: **Documents** (PDFs, DOCX, etc. uploaded to the knowledge base), **Customers** (structured customer records), **Products** (structured product records), **Vendors** (structured vendor records), **Websites** (crawled site content). Each binds the same way — pick from a list. The agent's retrieval treats them differently under the hood: documents and websites are chunked and embedded; structured records are queried by field.

## Scoping

Knowledge bound to an agent is per-agent, not per-chat. Every chat that uses the agent gets the same bindings. To limit knowledge to a single chat, attach the file inline (see [Attachments](/platform/chat/attachments)). To limit knowledge to a Project, bind it to a [Project agent](/platform/projects/project-agents) instead.

## Where this fits

Agent knowledge is the answer to "this agent should know about this specific stuff". The wider Knowledge section is where the sources live; the binding is what wires an agent into a subset of them. The next read is [Knowledge overview](/platform/knowledge/overview) for the source side, or [Agent with knowledge](/tutorials/editor/agent-with-knowledge) for the end-to-end build on a fresh instance.
