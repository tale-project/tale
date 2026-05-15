---
title: Agent concepts
description: The mental model behind Tale agents — instructions, knowledge, tools, and models.
---

An agent is a bundle of four things: **instructions** (how it behaves), **knowledge** (what it can read), **tools** (what it can do), and a **model** (how it thinks). Everything else — versioning, webhooks, conversation starters — is plumbing around those four. Once you can list the four for the agent you want, the build itself takes minutes.

## Instructions

The instructions are the system prompt the model sees before every message in the conversation. They answer "who are you and what's your job?". Good instructions are short, specific, and list the rules the agent has to follow.

Example:

> You are the support agent for Acme Corp. Answer questions about our products, shipping, and returns. Do not give medical or legal advice. Always respond in the user's language. Keep replies under 200 words.

Changing the instructions changes the agent's personality, scope, and output format. Treat them as the most load-bearing part of the agent — most quality wins come from rewriting instructions, not swapping models.

## Knowledge

Knowledge is the subset of the [knowledge base](/platform/workspace/knowledge-base) the agent can search. By default agents can search everything the organisation has uploaded. You narrow this down by folder, by team, or by entity type (documents, products, customers, vendors).

Narrower knowledge means more relevant search hits — a support agent that only searches the customer-facing folder won't get distracted by internal engineering docs. Narrower also means lower cost, since fewer documents reach the model.

## Tools

Tools are capabilities the agent can invoke during a conversation. Built-in tools include knowledge search, web search, document handling, and image analysis. Integrations you've configured (REST APIs, SQL, email) also appear as tools.

You toggle each tool on or off per agent. A read-only research agent might have web search on but all write operations off. An agent that updates tickets in a support system has the integration tool on but everything else off. The tool list is what separates an agent that can only talk from an agent that can act.

## Model

Every agent is tied to a model preset — **Fast**, **Standard**, or **Advanced**. Each preset maps to a specific AI model configured in your [providers](/platform/admin/providers). Fast is cheapest and quickest; Advanced is the most capable. Most agents end up on Standard; reach for Advanced when reasoning quality matters more than latency, and Fast for high-volume routine tasks where speed beats nuance.

## Putting it together

These four knobs let you create many agents from the same platform:

| Scenario         | Instructions                           | Knowledge                      | Tools                             | Model    |
| ---------------- | -------------------------------------- | ------------------------------ | --------------------------------- | -------- |
| Friendly support | Helpful, concise, refuses out-of-scope | Help-centre docs only          | Knowledge search, customer lookup | Standard |
| Sales research   | Dig deep, cite sources                 | All docs + websites + products | Knowledge search, web search      | Advanced |
| Data exploration | Safe, explains queries                 | All SQL connections            | SQL integration, knowledge search | Fast     |

## When to reach for it

Agents are the conversational primitive in Tale. Their sibling primitive is the **automation** — a multi-step program that runs without a human in the loop. The two solve different problems, and most teams end up with both.

| Use an agent when …                                         | Use an automation when …                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| A human is in the conversation asking questions             | A scheduled trigger, an external webhook, or an internal event fires it |
| The flow is open-ended — the next step depends on the reply | The flow is deterministic — same steps every time, in the same order    |
| Output is text or a small structured payload                | Output is an effect on another system (record updated, email sent)      |
| Latency matters because someone is waiting                  | Background latency is fine; correctness matters more                    |

Many features mix the two: an agent that delegates a long-running job to an automation, or a workflow whose LLM step uses an agent's instructions. Pick the primary primitive based on whether the user is in the conversation when the work has to happen.

## Build one

Concepts done. The next page walks the create flow end to end — naming, picking a model, writing instructions, attaching knowledge, enabling tools, and publishing the first version. Start there: [Create an agent](/platform/agents/create).
