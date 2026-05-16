---
title: Agent concepts
description: The four-knob mental model behind every Tale agent — instructions, knowledge, tools, and model — and when to reach for an agent over an automation.
---

An agent is a bundle of four things: **instructions** that govern how it behaves, **knowledge** that bounds what it can read, **tools** that decide what it can do, and a **model** that determines how it thinks. Everything else in the agent surface — versioning, conversation starters, worker URLs, delegation — is plumbing around those four. The audience is anyone building or reasoning about agents; once you can list the four for the agent you want, the build itself takes minutes.

This page is the mental model. The end-to-end build walks the same four tabs in order at [Create an agent](/platform/agents/create).

## Instructions

The instructions are the system prompt the model sees before every message in the conversation. They answer "who are you and what's your job?". Good instructions are short, specific, and list the rules the agent has to follow — what the agent is, what it can answer, what it must refuse, and how to format its replies.

A worked example:

> You are the support agent for Acme Corp. Answer questions about our products, shipping, and returns. Do not give medical or legal advice. Always respond in the user's language. Keep replies under 200 words.

Changing the instructions changes the agent's personality, scope, and output format. Treat them as the most load-bearing part of the agent — most quality wins come from rewriting instructions, not swapping models.

## Knowledge

Knowledge is the subset of the [knowledge base](/platform/workspace/knowledge-base) the agent can search. By default, agents can search everything the organisation has uploaded; you narrow this scope down by folder, by team, or by entity type (documents, products, customers, vendors).

Narrower knowledge means more relevant search hits — a support agent that only searches the customer-facing folder doesn't get distracted by internal engineering documents. Narrower also means lower cost, because fewer documents reach the model on each retrieval.

## Tools

Tools are the capabilities the agent can invoke during a conversation. Built-in tools include knowledge search, web search, document handling, and image analysis. Every integration you've configured (REST APIs, SQL, email) appears as a tool, as does every active [MCP server](/platform/integrations/mcp-servers).

You toggle each tool on or off per agent. A read-only research agent might have web search on and every write operation off. An agent that updates tickets in a support system has the support integration tool on and everything else off. The tool list is what separates an agent that can only talk from an agent that can act.

## Model

Every agent is tied to a model preset — **Fast**, **Standard**, or **Advanced**. Each preset maps to a specific AI model configured in your [AI providers](/platform/admin/providers). Fast is cheapest and quickest; Advanced is the most capable. Most agents end up on Standard; reach for Advanced when reasoning quality matters more than latency, and Fast for high-volume routine tasks where speed beats nuance.

## Putting it together

The four knobs combine into many agents from the same platform. Three worked shapes:

| Scenario         | Instructions                            | Knowledge                       | Tools                              | Model    |
| ---------------- | --------------------------------------- | ------------------------------- | ---------------------------------- | -------- |
| Friendly support | Helpful, concise, refuses out-of-scope. | Help-centre docs only.          | Knowledge search, customer lookup. | Standard |
| Sales research   | Dig deep, cite sources.                 | All docs + websites + products. | Knowledge search, web search.      | Advanced |
| Data exploration | Safe, explains queries.                 | All SQL connections.            | SQL integration, knowledge search. | Fast     |

## When to reach for it

Agents are the conversational primitive in Tale. Their sibling primitive is the **automation** — a multi-step program that runs without a human in the loop. The two solve different problems, and most teams end up running both.

| Use an agent when …                                          | Use an automation when …                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| A human is in the conversation asking questions.             | A scheduled trigger, an external webhook, or an internal event fires it. |
| The flow is open-ended — the next step depends on the reply. | The flow is deterministic — same steps every time, in the same order.    |
| Output is text or a small structured payload.                | Output is an effect on another system (record updated, email sent).      |
| Latency matters because someone is waiting.                  | Background latency is fine; correctness matters more.                    |

Many features mix the two: an agent that delegates a long-running job to an automation, or a workflow whose LLM step uses an agent's instructions. Pick the primary primitive based on whether the user is in the conversation when the work has to happen.

## Build one

Concepts done. The next page walks the create flow end to end — naming, picking a model, writing instructions, attaching knowledge, enabling tools, and publishing the first version. Start there: [Create an agent](/platform/agents/create).
