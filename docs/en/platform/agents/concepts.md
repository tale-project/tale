---
title: Agent concepts
description: An agent is the four-knob combination of instructions, knowledge, tools, and a model. This page hands you the mental model the rest of the agents section assumes.
---

An agent is the unit Tale reaches for when the same question is going to come back. It is the four-knob combination of instructions, knowledge, tools, and a model — the four things you change to make the agent behave differently. Editors and Developers build them; Members and other roles run them.

This page hands you the mental model the rest of the section assumes. Read it once before you build your first agent; come back to it when you can't remember whether a behaviour you want to change lives in the instructions, the knowledge, the tools, or the model.

## The four knobs

**Instructions** are the system prompt — the prose that frames every reply. Keep instructions short, opinionated, and concrete; long instructions get diluted in long conversations. Specify the voice, the constraints, and the refusal cases.

**Knowledge** is what the agent can reference. Bind documents, customers, products, vendors, or websites from the knowledge base; the agent retrieves chunks at reply time and cites them. Knowledge that is not bound is invisible to the agent — there is no implicit pull from the org's whole library.

**Tools** are what the agent can do beyond reply with text. Built-in tool families cover web, files, RAG over knowledge, code execution, sub-agent delegation, workflow invocation, MCP servers, and human input. Toggle them per agent — every tool you grant widens the trust boundary, so keep the list short.

**Model** is the LLM behind every reply. Pick the primary, set a fallback, and Tale resolves at request time. Switching the model does not re-train anything — the agent's other three knobs are the model's "memory" of the job.

## Skills as a bundle

A Skill packages instructions and (optionally) a sandbox script into a reusable bundle you can attach to an agent. Reach for a skill when the same pattern appears across multiple agents — a writing voice, a calculation, a multi-step task. Skills compose with the four knobs: an agent with three skills has the instructions of each skill plus its own.

The Skills concept page covers the trade-off between Skills and inline instructions in detail: see [Agent skills](/platform/agents/skills).

## Putting it together — a support-triage agent

A first useful agent is the support-triage one: it reads the inbound conversation, decides whether to answer directly, escalate to a human, or hand off to a specialist. The four knobs:

- Instructions: a one-paragraph voice + three explicit refusal cases.
- Knowledge: the product documentation and the FAQ folder; not the source code.
- Tools: RAG, web search, and the sub-agent tool for escalation. No code execution.
- Model: a capable model for the primary, a smaller one for the fallback when the primary is rate-limited.

The conversation then flows: user message → instructions frame the reply → knowledge retrieval finds three relevant chunks → tools either answer or delegate → the reply lands with citations.

## When to reach for it

A single agent is the right shape when the conversation stays in one domain and one voice. Reach for an [automation](/platform/automations/concepts) when the work is multi-step and you want approvals or scheduling in between; reach for a raw chat (no agent) when you are exploring an answer yourself and the model's defaults are fine.

| Use … when                                     | Agent | Raw chat | Automation |
| ---------------------------------------------- | ----- | -------- | ---------- |
| Same question recurs                           | ✓     |          |            |
| The voice or constraints matter                | ✓     |          |            |
| You need approvals or scheduling between steps |       |          | ✓          |
| You are exploring an answer one time           |       | ✓        |            |

## Build one

The four knobs are what every Tale agent is made of: change one of them and you have changed the agent's behaviour, change three and you have made a new product. The natural next read is [Build your first agent](/tutorials/editor/first-agent-end-to-end) — it walks the four knobs end to end on a fresh instance.
