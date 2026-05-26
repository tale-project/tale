---
title: Agents in chat
description: How the agents picker works in Chat — which agents appear, what "Visible in chat" controls, one-shot versus sticky agents, switching mid-thread, and sub-agent calls.
---

Picking an agent in Chat is the difference between asking a generic Assistant and asking something the org has shaped for a domain. The agents picker is the most-used control in the composer; the rules behind which agent appears, when an agent persists, and what happens when you switch mid-chat are the subject of this page.

The picker is conceptually simple — type a name, hit enter — but the rules about visibility and stickiness cause most "why can I not see this agent" support tickets in the wild. Knowing the rules saves the round trip.

## The agents picker

Click **Select agent** on the composer (or the chip showing the currently picked agent) and the picker opens with **Search agents** at the top. The list shows every agent the user has access to that is marked **Visible in chat**; agents without that toggle exist in the org but never surface in the picker, which keeps the list short. **Add agent** at the bottom is a shortcut for Editors and above to create a new one — see [Create an agent](/platform/agents/create).

## "Visible in chat"

Every agent has a **Visible in chat** toggle on its instructions page. Turning it off does not disable the agent — automations and workflows can still call it; sub-agent calls from other agents still work — it just hides the agent from the chat picker. The reasoning: organisations end up with dozens of agents the average user never picks (utility agents called by other agents, agents bound to a specific workflow), and surfacing them all would drown the everyday picks.

## One-shot versus sticky

Picking an agent **before** the first message in a chat makes it sticky — every subsequent message in the same chat goes to the same agent. Picking an agent **mid-chat** applies it to the next message and everything after, until you switch again. There is no "use this agent once and revert" gesture; to revert to the generic Assistant, pick **Assistant** in the picker explicitly. The transcript keeps the per-message agent, so a chat with a mid-stream switch reads as two agents collaborating.

## Switching mid-thread

The agent's knowledge and tools change with the picker, but the conversation history does not. The new agent reads everything that came before — your messages and the previous agent's replies — and continues from there. This is useful for handoffs: a triage agent answers the first message, you switch to a specialist for follow-up, the specialist has the full context without anyone copy-pasting.

## Sub-agent calls

An agent's instructions can include a sub-agent tool; when it does, the primary agent can delegate part of the work without the user picking anything. Sub-agent calls render in the reply as collapsed tool calls — the user sees what was delegated and what came back, not a full second conversation. Delegation rules and the loop-prevention model live on [Agent delegation](/platform/agents/delegation).

## When to reach for each shape

| Use … when                                        | Chat | Projects | Conversations |
| ------------------------------------------------- | ---- | -------- | ------------- |
| Personal task, one-off question                   | ✓    |          |               |
| Shared workspace across a team, recurring threads |      | ✓        |               |
| Inbound from a customer channel (email, webhook)  |      |          | ✓             |

## Where this fits

Agents in Chat is the user-facing half of the agents story — what the picker does, what shows up, how stickiness works. The build-facing half is [Agent concepts](/platform/agents/concepts): the four knobs that determine what an agent does once picked. If you came here to build the agent you wish were in the picker, that is the next read.
