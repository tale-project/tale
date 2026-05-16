---
title: Create an agent
description: The end-to-end build flow for a custom agent — naming, model, instructions, knowledge, tools, conversation starters, delegation, and the worker URL.
---

Creating an agent means picking values for the four knobs the concept page introduced — instructions, knowledge, tools, model — then giving the agent a name, a worker URL for external callers, and the conversation starters that appear on a fresh chat. The audience is Editor role or higher; Members can use shipped agents but not build them.

This page walks the build flow tab by tab. The conceptual model behind the four knobs is at [Agent concepts](/platform/agents/concepts). The iteration loop after the first publish — history snapshots, comparison, restore — is at [Agent versions](/platform/agents/versions). This page sits between the two.

## Create the agent

To start a new agent, open **Agents** in the sidebar and click **Create agent**. The create dialog asks for three things:

| Field        | What goes in                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Display name | The name shown in the agent selector and conversations. `Support agent`, `Sales research`.                                           |
| Name         | URL-safe slug used in API calls and JSON file references. Auto-derived from the display name; override when a specific slug matters. |
| Description  | Optional one-liner describing what the agent does. Appears in the agent picker tooltip.                                              |

Click **Continue**. The next screen is the agent's configuration page, which carries seven tabs: General, Instructions & model, Tools, Knowledge, Starters, Delegation, and Workers.

### File-based creation with AI assistance

To create agents by adding JSON files directly, open the project's `agents/` directory and add a new file. An AI-powered editor (Claude Code, Cursor, GitHub Copilot, Windsurf) opened on the project sees the agent schema and the platform's capabilities through the extracted reference code — describe the agent and the editor generates a valid configuration file. See [AI-assisted development](/develop/ai-assisted-development) for setup.

## Instructions & model

This is the most load-bearing tab. The **System instructions** field is the system prompt the model sees before every conversation; it defines the agent's role, scope, tone, and output shape. Keep it short, specific, and rule-listed — state who the agent is, what it can answer, what it must refuse, and how to format replies.

Two other fields live on this tab. The **Model** picker selects the AI model that backs this agent — pick from the models your organisation has configured under [AI providers](/platform/admin/providers); the picker also lets you add fallback models that run when the primary is unavailable. The **Structured responses** toggle lets the agent format substantial answers with `[[CONCLUSION]]`, `[[KEY_POINTS]]`, and `[[DETAILS]]` markers that render as rich UI sections in the chat; turn it off to force plain-text replies.

Changes save automatically; a save indicator in the top-right shows the current status.

## Tools

To grant the agent access to a capability, open the Tools tab and toggle the relevant entry on. Built-in tools include knowledge search, web search, document handling, and image analysis — each with a four-way retrieval-mode selector (**Off**, **Tool**, **Context**, **Both**) that decides whether the agent searches on demand, gets results auto-injected into every reply, or both. Every configured integration and every active [MCP server](/platform/integrations/mcp-servers) appears as a togglable group below the built-ins.

The tool list is what separates an agent that can only talk from an agent that can act. A read-only research agent has web search on and every write operation off; an agent that updates tickets has the support integration on and everything else off.

## Knowledge

To scope what the agent can search, open the Knowledge tab and narrow the default (all organisation knowledge) down by folder, by team, or by entity type (documents, products, customers, vendors). Narrower scopes give more relevant search hits — a support agent searching only the help-centre folder doesn't get distracted by engineering documents — and cost less, because fewer documents reach the model.

The Knowledge tab also lets you upload **agent documents** — files only this agent can access, useful for private style guides or response templates you don't want exposed to the rest of the organisation. To turn off knowledge entirely (the agent answers purely from instructions and tools), set **Retrieval mode** to **Off** on this tab.

## Starters

To suggest first messages on a fresh chat, open the Starters tab and add starter entries. Each starter has a **title** (the clickable suggestion) and a **prompt** (the message sent when clicked). Starters reduce the friction of writing the first message and they're a good way to demonstrate what the agent was built to handle.

An agent with no starters shows an empty composer on a fresh chat — the feature is opt-in.

## Delegation

To let the agent hand conversations off to specialists when the topic drifts, open the Delegation tab and pick target agents. For each target, name the topic or condition that triggers the hand-off; the agent then routes matching conversations to the chosen delegate. The hand-off shows in the transcript as a short note naming the new agent, and replies from that point onwards come from the delegate's instructions.

Delegation is opt-in. An agent with no delegation targets answers every topic itself.

## Workers

Every agent gets a unique **worker URL**. To call the agent from outside Tale — a chat widget on a marketing site, a Slack bot, an external workflow — POST a message and the conversation context to the worker URL and the agent responds with the same shape it would have used in chat. The Workers tab supports multiple worker URLs per agent so you can rotate credentials or scope different integrations to different keys.

The agent has to be published before its Workers tab activates — until then, the tab shows _Publish this agent to enable worker access_. The signature scheme and a worked example in cURL, Node, and Python live at [Webhooks](/develop/webhooks).

## History

To browse the agent's history of saved snapshots, open the **History** menu. The dialog lists every published snapshot with timestamp and actor; from there you can compare two snapshots side by side or restore a previous one as the new working state. See [Agent versions](/platform/agents/versions) for the full lifecycle.

## Where this fits

This page is the build flow — name, instructions, model, knowledge, tools, starters, delegation, workers. Most of the iteration on an agent happens _after_ this initial create: rewriting instructions as you learn what the agent gets wrong, narrowing knowledge as you see what it grounds in, toggling tools as the use case sharpens. The four knobs the concept page introduced are the four knobs you keep tuning.

For the iteration loop — drafting, publishing, rolling back live agents — [Agent versions](/platform/agents/versions) is the dedicated reference. To call this agent from outside the UI, [Webhooks](/develop/webhooks) and the [API reference](/develop/api-reference) cover the two non-UI surfaces.
