---
title: Create an agent
description: The end-to-end build flow for a custom agent — name, model, instructions, knowledge, tools, conversation starters, delegation, and the webhook endpoint.
---

Creating an agent means picking values for the four knobs the concept page introduced — instructions, knowledge, tools, model — and giving the agent a name, a webhook endpoint, and the conversation starters that appear when someone opens a fresh chat with it. This page walks the create flow end to end. The audience is Editor role or higher; Members can use shipped agents but not build them.

The conceptual model is at [Agent concepts](/platform/agents/concepts). The iteration loop after the first publish — drafts, version history, rollback — is at [Agent versions](/platform/agents/versions). This page sits between the two.

## Create the agent

To start a new agent, open **Agents** in the sidebar and click **New agent**. The create dialog asks for three things:

| Field         | What goes in                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Display name  | The name shown in the agent selector and conversations. `Support agent`, `Sales research`.                                           |
| Internal name | URL-safe slug used in API calls and JSON file references. Auto-derived from the display name; override if a specific slug is needed. |
| Description   | Optional one-liner describing what the agent does. Shown in the agent picker tooltip.                                                |

Click **Create**. The next screen is the agent's configuration page with seven tabs: Instructions, Knowledge, Tools, Conversation starters, Delegation, Webhook, and Versions.

### File-based creation with AI assistance

To create agents by adding JSON files directly, open the project's `agents/` directory and add a new file. An AI-powered editor (Claude Code, Cursor, GitHub Copilot, Windsurf) opened on the project sees the agent schema and the platform's capabilities through the extracted reference code — describe the agent and the editor generates a valid configuration file. See [AI-assisted development](/develop/ai-assisted-development) for setup.

## Instructions tab

This is the most load-bearing tab. The instructions are the system prompt the model sees before every conversation; they define the agent's role, scope, tone, and output shape. The fields:

- **System Instructions.** Short, specific, and rule-listed. State who the agent is, what it can answer, what it must refuse, and how to format replies.
- **Model preset.** Pick **Fast**, **Standard**, or **Advanced**. Each preset maps to a specific AI model configured in [AI providers](/platform/admin/providers).
- **Structured responses.** When on, the agent formats answers with consistent structure (sections, lists) instead of free-form text.

Changes save automatically; a save indicator in the top-right shows the current status. The first save creates a draft version that runs in parallel with the published version (if there is one) — see [Agent versions](/platform/agents/versions).

## Knowledge tab

To scope what the agent can search, open the Knowledge tab and narrow the default (all organisation knowledge) down by folder, by team, or by entity type (documents, products, customers, vendors). Narrower scopes give more relevant search hits — a support agent searching only the help-centre folder doesn't get distracted by engineering documents — and cost less, because fewer documents reach the model.

To completely disable knowledge search for an agent (the agent answers purely from instructions and tools), turn off the **Knowledge search** tool on the Tools tab.

## Tools tab

To grant the agent access to a capability, open the Tools tab and toggle the relevant entry on. Built-in tools include knowledge search, web search, document handling, and image analysis. Every configured [integration](/platform/integrations/overview) and every active [MCP server](/platform/integrations/mcp-servers) appears here as a togglable group.

The tool list is what separates an agent that can only talk from an agent that can act. A read-only research agent has web search on and all write operations off; an agent that updates tickets has the integration tool on and everything else off.

## Conversation starters tab

To suggest first messages on a fresh chat, open the Conversation starters tab and add starter entries. Each starter has a **title** (the clickable suggestion) and a **prompt** (the message sent when clicked). Starters reduce the friction of writing the first message and they're a good way to demonstrate what the agent was built to handle.

An agent with no starters just shows an empty composer on a fresh chat — the feature is opt-in.

## Delegation tab

To let the agent hand off conversations to specialists when the topic drifts, open the Delegation tab and add target agents. For each target, name the topic or condition that triggers the hand-off; the agent then routes matching conversations to the chosen delegate. The hand-off shows in the transcript as a short note naming the new agent, and replies from that point onwards come from the delegate's instructions.

Delegation is opt-in. An agent with no delegation targets answers every topic itself.

## Webhook tab

Every agent gets a unique webhook endpoint. To call the agent from outside Tale — a chat widget on a marketing site, a slack-bot, an external workflow — POST a message and the conversation context to the webhook URL and the agent responds with the same shape it would have used in chat.

Add a webhook secret on this tab to verify request authenticity; Tale signs every callback with the secret and the receiver verifies the signature before trusting the body. The signature scheme and a worked example in cURL, Node, and Python are at [Webhooks](/develop/webhooks).

## Versions tab

To browse the agent's draft / publish history, open the Versions tab. The Versions tab shows every published version with timestamp and actor, plus the current draft. From here you can compare two versions side by side or roll back to a previous version — see [Agent versions](/platform/agents/versions) for the full lifecycle.

## Where this fits

This page is the build flow — name, model, instructions, knowledge, tools, starters, delegation, webhook, version. Most of the iteration on an agent happens _after_ this initial create: rewriting instructions as you learn what the agent gets wrong, narrowing knowledge as you see what it grounds in, toggling tools as the use case sharpens. The four knobs the concept page introduced are the four knobs you keep tuning.

For the iteration loop — drafting, publishing, rolling back live agents — [Agent versions](/platform/agents/versions) is the dedicated reference. To call this agent from outside the UI, [Webhooks](/develop/webhooks) and the [API reference](/develop/api-reference) cover the two non-UI surfaces.
