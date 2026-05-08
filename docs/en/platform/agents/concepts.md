---
title: Agent concepts
description: The mental model behind Tale agents — instructions, knowledge, tools, and models.
---

An agent is a bundle of four things: **instructions** (how it behaves), **knowledge** (what it can read), **tools** (what it can do), and a **model** (how it thinks). Everything else — versioning, webhooks, conversation starters — is plumbing around those four.

## Instructions

The instructions are the system prompt the model sees before every message in the conversation. They answer "who are you and what's your job?" Good instructions are short, specific, and list the rules the agent has to follow.

Example:

> You are the support agent for Acme Corp. Answer questions about our products, shipping, and returns. Do not give medical or legal advice. Always respond in the user's language. Keep replies under 200 words.

Changing instructions changes the agent's personality, scope, and output format.

## Knowledge

Knowledge is the subset of the [knowledge base](/platform/workspace/knowledge-base) the agent can search. By default agents can search everything the organisation has uploaded. You can narrow this down by folder, by team, or by entity type (documents, products, customers, vendors).

Narrower knowledge means more relevant search hits — a support agent that only searches the "Help Center" folder won't get distracted by internal engineering docs.

## Tools

Tools are capabilities the agent can invoke during a conversation. Built-in tools include knowledge search, web search, document handling, and image analysis. Integrations you've configured (REST APIs, SQL, e-mail) also appear as tools.

You can toggle each tool on or off per agent. A read-only research agent might have web search on but all write operations off. A billing agent might only have the billing integration available.

## Model

Every agent is tied to a model preset — **Fast**, **Standard**, or **Advanced**. Each preset maps to a specific AI model configured in your [providers](/platform/admin/providers). Fast is cheapest and quickest; Advanced is the most capable.

## Putting it together

These four knobs let you create many agents from the same platform:

| Scenario         | Instructions                           | Knowledge                      | Tools                             | Model    |
| ---------------- | -------------------------------------- | ------------------------------ | --------------------------------- | -------- |
| Friendly support | Helpful, concise, refuses out-of-scope | Help-centre docs only          | Knowledge search, customer lookup | Standard |
| Sales research   | Dig deep, cite sources                 | All docs + websites + products | Knowledge search, web search      | Advanced |
| Data exploration | Safe, explains queries                 | All SQL connections            | SQL integration, knowledge search | Fast     |

## Next

Ready to build one? Go to [Create an agent](/platform/agents/create).
