---
title: Using agents in chat
description: Pick specialised agents from the chat input to change how Tale answers.
---

An agent is a version of the AI tailored for a specific purpose — a support agent, a sales agent, a research agent, and so on. Each agent has its own instructions, knowledge access, and tool permissions. You pick which agent handles a conversation from the **agent selector** in the chat input.

## Switching agents

1. Click the **bot** icon in the bottom-left of the chat input.
2. A list opens with the default chat agent at the top, followed by any custom agents your team has built.
3. Click the agent you want. The conversation's title bar updates to show the active agent.

Each conversation remembers its selected agent. Starting a new chat resets to the default.

## Agent conversation starters

When you start a fresh conversation with an agent that has **conversation starters** configured, a row of clickable suggestions appears. Click one to send it as your first message — it's faster than typing, and it's a good way to discover what the agent is built for.

## Why switch agents?

- **Better answers on narrow topics** — a support agent has been pointed at support documents only, so it doesn't get distracted by unrelated knowledge.
- **Restricted tools** — a read-only research agent can't modify data, so you can ask it exploratory questions without worrying about accidental changes.
- **Different tone** — agents can be configured with different voices, output formats, and strictness.

## Handoffs (delegation)

Some agents are configured to **delegate** to other agents when the topic drifts. If you ask a general support agent a billing question, it might hand off to a specialised billing agent automatically. When that happens, the conversation shows a short note explaining the switch.

## Creating your own agent

If you have Editor permissions or higher, you can build agents for your team. See [Create an agent](/platform/agents/create).
