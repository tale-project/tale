---
title: Agents in chat
description: How the agent picker works in Chat — which agents appear, what an agent brings to a reply, when a pick sticks, switching mid-chat, and sub-agent calls.
---

Picking an agent in Chat is the difference between asking a general assistant and asking something the organisation has shaped for a domain. The picker is the most-used control in the composer, and the rules behind it are worth ten minutes: which agents appear, what changes when you pick one, how long a pick lasts, and what happens to the conversation when you switch halfway through. This page covers the using side; building an agent is [Agent concepts](/platform/agents/concepts).

## The agent picker

Open the agent chip in the composer and the picker lists the agents you have access to, with a search field that filters by name as you type. The list is flat — agents are not sorted into types, and no entry answers on its own or hands the message to somebody else. Whichever agent the chip names is the one that answers your next message.

An agent's visibility decides whether it appears here at all. Turning visibility down does not disable an agent: automations can still run it and other agents can still delegate to it. It only keeps the picker short, which matters in an org that has accumulated dozens of utility agents nobody picks by hand.

## What an agent brings

An agent is a small, legible object. It carries a name and a description, the instructions that shape its replies, a visibility setting, the tools and skills it may call, and the scope of knowledge it may reach. That list is the whole of it.

<Note>

An agent does not carry a model. The model comes from the model picker beside it, chosen per turn — so the same agent can answer through a fast model in the morning and a stronger one when the question gets hard. [Chat basics](/platform/chat/basics) covers the model picker and its two groups.

</Note>

## When a pick sticks

Picking an agent before the first message makes it the agent for the chat — every following message goes to it until you change the pick. Picking one mid-chat applies from the next message onward. There is no gesture for "use this one once and revert": to hand the chat back, pick the other agent explicitly.

The transcript records which agent answered each message, so a chat with a mid-stream switch reads as two agents working the same problem rather than one agent changing its mind.

## Switching mid-chat

The agent's instructions, tools, and knowledge change with the picker. The conversation history does not. The incoming agent reads everything that came before — your messages, the previous agent's replies, and the tool calls in between — and continues from there.

That makes handoffs cheap. A generalist takes the first question, you switch to the specialist for the follow-up, and the specialist has the full context without anyone pasting a summary. It also means the incoming agent inherits any mistakes in the transcript, so when a thread has gone wrong, starting a fresh chat beats switching agents inside the broken one.

## Sub-agent calls

An agent that has been given a sub-agent tool can delegate part of a job without you picking anything. The delegation renders in the reply as a collapsed tool call — you see what was handed over and what came back, not a second conversation to read. The organisation's mandatory instructions are applied once, at the top of the turn, rather than re-applied inside every nested call, so a delegating agent cannot double the org's voice by nesting.

## Where each surface fits

Chat is one of three places an agent answers, and the differences are about ownership rather than capability.

| Use … when                                        | Chat | Projects | Conversations |
| ------------------------------------------------- | ---- | -------- | ------------- |
| Personal task, one-off question                   | ✓    |          |               |
| Shared workspace across a team, recurring threads |      | ✓        |               |
| Inbound from a contact channel (email, webhook)   |      |          | ✓             |

## Where this fits

Agents in chat is the user-facing half of the agents story — what the picker lists, what an agent brings to a reply, how long a pick lasts, and what survives a switch. The build-facing half is [Agent concepts](/platform/agents/concepts), which covers what to put in an agent's instructions, which tools to give it, and how to scope its knowledge. If the agent you keep wishing for is not in the picker, that is the page to read next; if you want to understand the reply itself, go back to [Chat basics](/platform/chat/basics).
