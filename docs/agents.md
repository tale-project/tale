---
title: Agents
description: Create specialized AI assistants with custom instructions, knowledge, and tools.
---

Agents are specialized AI assistants you configure for specific tasks. Unlike the default chat agent, which is general-purpose, an agent has its own instructions, a defined set of knowledge it can access, a specific AI model, and optional tool restrictions.

## Creating an agent

1. Navigate to Agents in the sidebar.
2. Click New Agent.
3. Enter a Display Name shown in the agent selector and an Internal Name, a URL-safe slug used in API calls such as `support-agent`.
4. Optionally add a description, then click Create.
5. You will land on the agent configuration page where you can set up its Instructions, Knowledge, Tools, and Webhook.

## Instructions tab

This is the most important tab. It defines what the agent knows, how it behaves, and what it can do.

- System Instructions: the prompt sent to the model before every conversation. Use this to define the agent's role, tone, what topics it should and should not cover, and how it should format its answers.
- Model Preset: choose between Fast, Standard, and Advanced. Each tier maps to an AI model configured via environment variables (`OPENAI_FAST_MODEL`, `OPENAI_MODEL`, `OPENAI_CODING_MODEL`).
- Structured Responses: when on, the agent formats its answers with consistent structure such as sections and lists instead of free-form text.

Changes on this tab are saved automatically. A save indicator in the top-right shows the current status.

## Knowledge tab

Controls which parts of the knowledge base this agent can access. By default, agents can search all organization knowledge. You can restrict it to specific document folders, product categories, or team-scoped data.

## Tools tab

Controls which platform capabilities the agent can use. Toggle individual tools on or off. For example, a support-only agent might have web browsing turned off but customer lookup turned on.

## Conversation starters tab

Define suggested prompts that appear when users start a new conversation with this agent. Conversation starters help users discover what the agent can do and reduce the friction of writing a first message.

Each starter has a title and a prompt. The title is displayed as a clickable suggestion; the prompt is sent as the user's first message when clicked.

## Delegation tab

Configure agent-to-agent handoff rules. Delegation allows this agent to route conversations to other agents when the topic falls outside its scope. For example, a general support agent can delegate billing questions to a specialized billing agent.

## Webhook tab

Each agent gets a unique webhook endpoint. You can POST a message and conversation context to this URL to get a response from the agent without using the platform UI. This is useful for integrating the agent into external products or chat widgets.

You can add a webhook secret to verify that incoming requests are genuine.

## Versioning

Agents support versioning. When you edit an agent's instructions, a draft version is created. The live version keeps serving requests until you publish the draft. The version history dialog shows all past versions and lets you compare or roll back.
