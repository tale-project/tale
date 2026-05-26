---
title: Delegate between agents
description: Wire a router agent that hands off to a specialist agent through the sub-agents tool, then watch the chain run end to end in a single chat.
---

Delegation is the shape you reach for when one agent is the wrong scope for the whole job but the right scope for one stage of it. A router agent reads the request, picks a specialist, calls it through the sub-agents tool, and consolidates the reply. This walk builds a two-agent chain — router plus billing specialist — on a fresh instance.

You need an Editor role and a model with tool-calling support on the primary provider. The conceptual side lives in [Agent delegation](/platform/agents/delegation); this walk is the end-to-end mechanic.

## Before you begin

Confirm three things. Your role is at least Editor — agent editing is gated to Editor and above. The org has at least one chat-tagged model with tool-calling on it; without that, the router cannot emit a tool call. The execution-timeout budget on the agents you create is left at the default (a few minutes); short timeouts cut the chain off before the sub-agent replies.

## Step 1 — Create the specialist first

The specialist exists before the router because the router has to point at an ID that resolves. Open **Agents > New agent** and fill in:

- **Name** — `Billing specialist`
- **Instructions** — `You answer billing questions concisely. State the customer ID you are answering for in the first sentence. If the question is not about billing, refuse and ask the router to re-route.`
- **Tools** — leave everything off for this walk
- **Model** — the org default

Save and publish. Copy the agent's ID from the URL or the agent header — the router needs it in the next step.

## Step 2 — Create the router with the sub-agents tool

The router is the agent the user actually chats with. Open **Agents > New agent** again and configure:

- **Name** — `Support router`
- **Instructions** — `You triage incoming questions. For billing questions, delegate to the Billing specialist and frame their reply in one sentence. For anything else, refuse and explain why.`
- **Tools** — toggle **Sub-agents** on; pick `Billing specialist` from the dropdown
- **Model** — the org default

Save and publish. The router's tool list now contains one sub-agent: the specialist from Step 1.

## Step 3 — Run a delegation in chat

Open a chat with `Support router` and ask `My last invoice has a duplicate charge — what should I do?`. The reply renders in three pieces: a `sub_agent` tool-call card showing the router's call to the specialist, the specialist's reply inside that card, and the router's one-sentence framing below. Expand the card to see the prompt the router sent and the specialist's response back.

If the router refuses or answers itself instead of delegating, the instructions are not pushing it hard enough — add an explicit rule (`Always delegate billing questions; do not answer them yourself.`) and republish.

## Step 4 — Inspect the execution

Open **Automations > Executions** (or the chat's **History** tab, depending on how the org names the surface) and find the chat you just ran. The execution lists the parent run and the sub-agent run as nested rows: who triggered it, what each agent received, what each emitted, and how long each took. This is the audit trail you point at when a customer asks "what did the agent actually say".

## Where this fits

A router-plus-specialist chain is the smallest useful delegation: one routing decision, one specialist, one consolidated reply. The same shape scales — add a technical specialist beside the billing one, add a third tier for escalations, swap the router for a workflow when the stages get fixed.

For the trade-off between delegation and a workflow with approvals, see [Agent delegation](/platform/agents/delegation). For the four-knob mental model behind every agent, see [Agent concepts](/platform/agents/concepts).
