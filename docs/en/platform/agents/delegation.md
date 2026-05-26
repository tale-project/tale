---
title: Agent delegation
description: One agent can call another through the sub-agents tool. This page hands you the mental model for when to delegate, how timeouts propagate, and what stops a chain from looping.
---

Delegation is the move you make when one agent is the wrong shape for the whole job, but the right shape for one stage of it. The router agent reads the request, decides which specialist to hand off to, calls them through the sub-agents tool, and consolidates the reply. The pattern works for triage, routing, and any case where the right voice depends on the question.

This page hands you the mental model for when to delegate and how to keep the chain bounded. Read it before you wire your first multi-agent workflow; come back when a delegation chain stops returning and you need to know what cap fired.

## How delegation runs

A router agent's tool list includes the **sub-agents** tool. When the router calls it with the specialist's ID and a prompt, Tale starts a child conversation: the specialist sees only the prompt the router sent (not the router's whole history), runs to completion, and returns its final reply. The router reads the reply back as a tool result and continues — typically consolidating into one outbound reply.

The child conversation runs against the specialist's own four knobs: its instructions, its knowledge, its tools, its model. The router does not inherit any of them; the specialist does not see the router's. They share an org and a budget, nothing else.

## Timeouts and budget propagation

Two caps stop a chain from running forever:

- **Execution timeout** — set per agent in minutes. When the timeout fires, the in-flight tool call returns an error and the agent unwinds. Sub-agent calls run inside the parent's remaining timeout; a sub-agent cannot extend its parent's budget.
- **Token budget** — applied at the org or team level by governance policy. Token spend rolls up: a sub-agent's tokens count against the parent agent's run, which counts against the org's budget rule.

If a delegation chain hits a budget rule mid-call, the in-flight sub-agent's reply still comes back; the parent's next tool call is blocked. The execution log records the budget hit.

## Worked example — a router → specialist chain

A customer-support router agent has a short instruction and three tools: sub-agent for a billing specialist, sub-agent for a technical specialist, RAG over the support FAQ. On an inbound message:

1. The router decides between billing, technical, or "answer myself from the FAQ".
2. If billing: it calls the billing specialist with the customer's question and the customer ID. The specialist has tools to query the billing system; it returns a draft answer.
3. The router reads the draft, adds a one-paragraph framing, and replies.
4. The execution log shows the parent agent, the specialist call, and the FAQ retrieval (or absence thereof) for the audit trail.

## When to reach for it

| Use … when                                              | Delegation | Single agent | Workflow |
| ------------------------------------------------------- | ---------- | ------------ | -------- |
| The voice or knowledge depends on the question's domain | ✓          |              |          |
| One agent can cover the whole job                       |            | ✓            |          |
| Work has explicit stages with approvals between them    |            |              | ✓        |
| The chain has more than three hops                      |            |              | ✓        |

Delegation is the right shape when the routing decision is itself a job for an agent. A workflow is the right shape when the stages are fixed and you want approvals or scheduling between them.

## Build one

The cost of delegation is one extra call per hand-off; the benefit is the right knowledge and voice at each stage without one agent that knows everything. Keep chains short (two or three agents); for anything longer, an automation gives you the audit trail and the approval seams that delegation does not. The natural next walk is [Delegate between agents](/tutorials/editor/delegate-between-agents) — it builds a router → specialist chain end to end.
