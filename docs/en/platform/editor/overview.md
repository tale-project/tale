---
title: Editor
description: The content-curation seat — the knowledge base, conversations, approvals, structured data, and the agents the rest of the team uses. The Editor's task-oriented landing for the day-to-day.
---

An **Editor** in Tale is the content-curation seat. You are the person who decides what the AI knows and which pending actions go through — the documents, the products, the customers, the websites the rest of the organisation reads from, plus the customer conversations and approvals that need a human in the loop. Everything a Member can do, you can do; on top of that you write to the knowledge base, edit agents, and act on approvals. You do not publish automations, configure integrations, or change organisation settings — those are Developer and Admin territory.

The point of having a dedicated Editor seat is that knowledge curation is its own job. An agent built by a Developer is only as good as the documents it can ground in; an automation that produces a draft reply is only as useful as the Editor who reviews and sends it. This page is a task-oriented index for the Editor's day; the canonical permission matrix lives at [Members and roles](/platform/admin/members-and-roles).

## An Editor's day

A typical day starts in **Conversations** to clear the overnight customer threads — the ones the AI drafted a response for and the ones the AI flagged for review. From there the work shifts to **Approvals**: outputs from automations waiting for a human verdict. Mid-morning, a Developer hands off a freshly built agent that needs a knowledge tag and a couple of starter prompts; you open the agent in **Agents**, point its knowledge at the right team-tagged folder, and add the prompts. Later, a product team drops a new pricing PDF in the team chat; you upload it to the **Documents** view and tag it so the right agent picks it up on the next message.

The pages below are arranged in the order the day asks for them — knowledge first because every other surface depends on it, then the human-in-the-loop surfaces, then agents because tuning them is where curation meets behaviour.

## Pages in this section

- **[Knowledge base](/platform/workspace/knowledge-base)** — upload, edit, tag, and remove documents; the surface every grounded answer is sourced from.
- **[Website crawling](/platform/knowledge/crawling)** — point Tale at a website, schedule recrawls, watch the indexer fill the knowledge base.
- **[Structured data](/platform/knowledge/structured-data)** — products, customers, vendors; the rows agents ground against when an answer needs more than a document.
- **[Conversations](/platform/workspace/conversations)** — shared customer threads. Reply, close, reopen, archive, or mark as spam.
- **[Approvals](/platform/workspace/approvals)** — outputs from automations awaiting a human verdict; approve or reject and the workflow continues.
- **[Agents](/platform/agents/create)** — create, edit, and publish the agents the rest of the team picks in chat.
- **[Agent versions](/platform/agents/versions)** — iterate on a live agent without breaking the conversations and automations that already use it.

## What Editors cannot do

Creating or editing automations, configuring integrations and MCP servers, generating API keys, and every organisation-wide setting (members, branding, governance, providers) are gated to Developers and Admins. If you need one of those done, request it from someone with the right role — building an agent without an Editor on the team is harder than the reverse.

## Where to start

If you are stepping into the seat today, the smallest useful first move is to open the [knowledge base](/platform/workspace/knowledge-base), upload one document the team already references daily, and confirm the AI can answer a question from it. From there, [build your first agent end to end](/tutorials/editor/first-agent-end-to-end) is the tutorial that closes the loop between curated knowledge and an AI surface that uses it.
