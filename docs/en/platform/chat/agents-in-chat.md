---
title: Agents in chat
description: How the agents picker works in Chat — which agents appear, what "Visible in chat" controls, one-shot versus sticky agents, switching mid-thread, and sub-agent calls.
---

Picking an agent in Chat is the difference between asking a generic Assistant and asking something the org has shaped for a domain. The agents picker is the most-used control in the chat; the rules behind which agent appears, when an agent persists, and what happens when you switch mid-chat are the subject of this page.

<Frame caption="The agent picker open over the chat — Auto, the installed agents, and the Catalog shortcut.">

![The agent picker open above the chat input, showing a search field, an Auto entry, the selected Assistant, an Automation Assistant entry, and a Browse automations button.](/images/platform/chat-agent-picker.webp)

</Frame>

## The agents picker

Click the agent chip on the chat (its accessible name is **Select agent**) and the picker opens with **Search agents** at the top. The list shows **Auto** — Tale routes each message to the best-fitting agent — followed by every agent you have access to that is marked **Visible in chat**; coding agents get their own **Coding agents** section when any are visible. Agents without that toggle exist in the org but never surface here, which keeps the list short. **Browse automations** at the bottom leads to the [Automations catalog](/platform/automations/catalog) — new agents arrive as part of an automation you install.

## "Visible in chat"

Every agent has a **Visible in chat** toggle on the **General** page of its editor. Turning it off does not disable the agent — automations and workflows can still call it, and sub-agent calls from other agents still work — it just hides the agent from the chat picker. The reasoning: organisations end up with dozens of agents the average user never picks (utility agents called by other agents, agents bound to a specific workflow), and surfacing them all would drown the everyday picks.

## One-shot versus sticky

Picking an agent **before** the first message in a chat makes it sticky — every subsequent message in the same chat goes to the same agent. Picking an agent **mid-chat** applies it to the next message and everything after, until you switch again.

<Note>

There is no "use this agent once and revert" gesture — to hand the chat back, pick **Assistant** (or **Auto**) in the picker explicitly. The transcript keeps the per-message agent, so a chat with a mid-stream switch reads as two agents collaborating.

</Note>

## Switching mid-thread

The agent's knowledge and tools change with the picker, but the conversation history does not. The new agent reads everything that came before — your messages and the previous agent's replies — and continues from there. This is useful for handoffs: a triage agent answers the first message, you switch to a specialist for follow-up, and the specialist has the full context without anyone copy-pasting.

## Sub-agent calls

An agent's instructions can include a sub-agent tool; when it does, the primary agent can delegate part of the work without you picking anything. Sub-agent calls render in the reply as collapsed tool calls — you see what was delegated and what came back, not a full second conversation. Delegation rules and the loop-prevention model live on [Agent delegation](/platform/agents/delegation).

## When to reach for each shape

| Use … when                                        | Chat | Projects | Conversations |
| ------------------------------------------------- | ---- | -------- | ------------- |
| Personal task, one-off question                   | ✓    |          |               |
| Shared workspace across a team, recurring threads |      | ✓        |               |
| Inbound from a contact channel (email, webhook)   |      |          | ✓             |

## Where this fits

Agents in Chat is the user-facing half of the agents story — what the picker does, what shows up, how stickiness works. The build-facing half is [Agent concepts](/platform/agents/concepts): the four knobs that determine what an agent does once picked. If you came here to build the agent you wish were in the picker, that is the next read.
