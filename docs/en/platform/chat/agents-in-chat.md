---
title: Using agents in chat
description: Pick specialised agents from the composer to scope knowledge, restrict tools, and route conversations through the right voice.
---

An agent is a version of the AI tailored for a specific job — a support agent, a sales-research agent, an internal-research agent, and so on. Each agent ships with its own instructions, knowledge scope, and tool permissions, and the chat composer lets you pick which agent answers a given conversation. Switching agents mid-conversation is allowed; the new agent reads the existing transcript before its first reply.

This page covers the runtime behaviour of agents inside chat. The mental model for what an agent _is_ lives at [Agent concepts](/platform/agents/concepts); building one is at [Create an agent](/platform/agents/create).

## Switch the active agent

To route a conversation through a specific agent, open the agent picker (the bot icon in the bottom-left of the composer), scroll to the agent, and click it. The conversation's title bar updates to show the active agent; the next message goes to the new agent's instructions, knowledge scope, and tools.

Each conversation remembers its selected agent. Starting a new chat resets the picker to the default chat agent that ships with Tale.

## Conversation starters

When the active agent has **conversation starters** configured, a row of clickable suggestions appears on a fresh conversation. Click one to send it as the first message — it's faster than typing the prompt by hand, and it's a good way to discover what the agent was built to handle. Starters are configured per agent on the **Agents > [agent] > Starters** tab; an agent with no starters just shows an empty composer on a fresh chat.

## Why switch

Three reasons readers reach for a non-default agent:

- **Better answers on narrow topics.** A support agent pointed at the support folder only doesn't get distracted by internal engineering documents.
- **Restricted tools.** A read-only research agent has all write operations toggled off, so exploratory questions stay safe.
- **Different voice or output shape.** Agents can be configured with distinct tones, output formats (JSON, Markdown, plain prose), and strictness.

The single biggest quality lever is the agent's instructions — most "the AI keeps doing X" complaints trace to a missing or wrong sentence in the system prompt, not a wrong model.

## Handoffs

Some agents are configured to **delegate** to other agents when the topic drifts. If a general support agent gets a billing question and has a billing-specialist agent registered as a delegation target, it can hand the conversation off automatically. The hand-off shows in the transcript as a short note naming the new agent, and replies from that point onwards are answered by the delegate's instructions.

Delegation is opt-in per agent. To enable it, open the agent's **Delegation** tab and pick which agents it can hand off to and under what conditions. See [Create an agent](/platform/agents/create) for the configuration surface.

## Where this fits

The agent picker is how the right specialist answers each question. To build a specialist, start with [Agent concepts](/platform/agents/concepts) for the four-knob mental model, then walk [Create an agent](/platform/agents/create) end to end. Editor role or higher is required to build agents; Members can use whatever the team has shipped.
