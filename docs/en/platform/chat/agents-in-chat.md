---
title: Agents in chat
description: Pick a specialised agent from the composer to scope knowledge, restrict tools, and route conversations through the right voice.
---

An agent is a version of the AI tailored for a specific job — a support agent answering customer questions from the help-centre folder, a sales-research agent allowed to call the web, an internal-research agent with read-only access to engineering documents. Each agent carries its own instructions, knowledge scope, and tool permissions, and the chat composer lets you pick which agent answers a given conversation. The audience is anyone in the product: Members pick agents the team has shipped, Editors and Developers build new ones.

This page covers the runtime behaviour of agents inside chat — switching the active agent, reading conversation starters, watching delegation hand the conversation off to a specialist. The mental model for what an agent _is_ lives at [Agent concepts](/platform/agents/concepts); building one is at [Create an agent](/platform/agents/create).

## Switch the active agent

To route a conversation through a specific agent, open the agent selector (the bot icon in the bottom-left of the composer), scroll to the agent, and click it. The next message goes to the new agent's instructions, knowledge scope, and tools; the conversation header updates to show the active agent. Switching mid-conversation is allowed — the new agent reads the existing transcript before its first reply, so the context isn't lost.

Each conversation remembers its selected agent. Starting a new chat resets the picker to the default Assistant that ships with Tale.

## Conversation starters

When the active agent has **starters** configured, a row of clickable suggestions appears on a fresh conversation. Click one to send it as the first message — it's faster than typing the prompt by hand, and it's a good way to see what the agent was built to handle. Starters are configured per agent on the **Agents > [agent] > Starters** tab; an agent with no starters shows an empty composer.

## Why switch agents

Three reasons readers reach for a non-default agent. A narrower knowledge scope gives sharper answers — a support agent that searches only the help-centre folder doesn't get distracted by internal engineering documents. A trimmer tool list keeps exploratory questions safe — a read-only research agent with every write operation toggled off can't accidentally update a ticket. A different voice changes the output shape — agents can be configured with distinct tones, output formats (Markdown, JSON, plain prose), and strictness.

The single biggest quality lever is the agent's instructions. Most "the AI keeps doing X" complaints trace back to a missing or wrong sentence in the system prompt, not a wrong model.

## Delegation hand-offs

Some agents are configured to **delegate** to specialists when the topic drifts. If a general support agent receives a billing question and has a billing-specialist agent registered as a delegation target, it hands the conversation off automatically. The hand-off shows in the transcript as a short note naming the new agent, and replies from that point onwards come from the delegate's instructions.

Delegation is opt-in per agent. To enable it, open the agent's **Delegation** tab and pick which agents it can hand off to, with the topic or condition that triggers the hand-off. The configuration surface is documented at [Create an agent](/platform/agents/create).

## Where this fits

The agent picker is how the right specialist answers each question — instead of forcing one generic Assistant to cover every topic, you pick the agent built for the topic. Member roles can use whatever the team has shipped; Editor or higher is required to build a new agent.

To build a specialist, start with [Agent concepts](/platform/agents/concepts) for the four-knob mental model, then walk [Create an agent](/platform/agents/create) end to end.
