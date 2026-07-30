---
title: Build your first agent
description: Walk a fresh org from "I want an agent" to a reviewed task result by turning the four knobs — instructions, knowledge, tools, model — in order on one instance.
---

A first agent is the smallest useful thing in Tale: instructions plus a model, sometimes with one tool or one document bound. This walk turns the four knobs in order — instructions, knowledge, tools, model — and leaves you with a published agent that turns a real task into a reviewable result. The shape generalises: every agent you build later is the same four moves with different choices.

You need an Editor role and a configured chat-tagged model on the org's provider. The conceptual side lives in [Agent concepts](/platform/agents/concepts); this walk is the end-to-end mechanic.

## Before you begin

Confirm three things. Your role is at least Editor — agent editing is gated to Editor and above. The org has a provider configured and at least one chat-tagged model on it; without that, the test reply at the end fails on the model call. You have a question in mind the agent should answer — pick something narrow enough that a paragraph of instructions can frame it, like "summarise an inbound contact message into one sentence plus a recommended next action".

## Step 1 — Write the instructions

Instructions are the system prompt — the prose that frames every reply. The first knob is the one most people overshoot. Open **Agents > New agent** and set:

- **Name** — `Triage assistant`
- **Instructions** — `You read a contact message and produce two lines. Line one: a one-sentence summary in plain English. Line two: a recommended next action — reply, escalate, or close. If the message is blank or off-topic, refuse and say so.`

Save as a draft for now; publishing comes after the other knobs. Short, opinionated, concrete instructions outperform long ones — keep the rules under a paragraph.

## Step 2 — Decide on knowledge

Knowledge is what the agent can reference at reply time. For this first agent, leave Knowledge empty: the job is reading the message, not retrieving anything. The Knowledge tab stays untouched.

If you wanted to add knowledge later — say, an escalation matrix the agent should consult — you would upload the document, open the agent's **Knowledge** tab, and bind it. The full mechanic is in [Agent with knowledge](/tutorials/editor/agent-with-knowledge).

## Step 3 — Pick the tools

Tools are what the agent can do beyond reply with text. For triage, no tools are needed: the agent reads input and writes output. Open the **Tools** tab and leave every toggle off. Every tool you grant widens the trust boundary; keep the list short.

If the agent should write the recommended action back to a CRM, you would toggle the corresponding connector tool on later — but not before the text-only version works.

## Step 4 — Pick the model and publish

Open the **Model** tab and pick the org default for the primary; set a smaller model as the fallback so the agent still runs when the primary is rate-limited. Save, then click **Publish**. The agent is now available to every project and automation with the right role — chat itself runs the built-in assistant only.

Create a task, paste a real contact message into its description, and assign it to `Triage assistant`. The run's result should land in two lines per the instructions — a one-sentence summary and a recommended action. If the format drifts, tighten the instructions and republish; this is the loop you spend the most time in.

## Where this fits

Four knobs, one published agent, one verified reply: the same shape every agent you build later follows. The next walks specialise on one knob each — [Agent with knowledge](/tutorials/editor/agent-with-knowledge) on the second knob, [Hand work to a worker](/tutorials/editor/delegate-between-agents) on the third.

For the concept page that names the four knobs and the trade-offs between them, see [Agent concepts](/platform/agents/concepts). For versioning and rollback once the agent matures, see [Agent versions](/platform/agents/versions).
