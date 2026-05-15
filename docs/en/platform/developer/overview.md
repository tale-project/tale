---
title: What you can build
description: An orientation for agent and automation builders.
---

This section is for the people who set up the parts of the platform everyone else uses — the agents the rest of the team chats with, the automations that run in the background, the integrations that connect Tale to other systems, and the knowledge those agents and automations ground in. If you have a **Developer** seat (or an **Editor** seat for agent work), the pages below are your reference.

"Building" in Tale is mostly composition rather than coding. You decide what an agent should know, what it can do, and how it should behave — Tale handles the model calls, the conversation memory, the tool orchestration, and the run history. The mental model below is the small set of pieces you compose.

## The building blocks

### Agents

An agent is a customised AI assistant. You decide its system prompt, which AI model it uses, which knowledge it can search, which tools it can call, and how it should behave. Think of an agent as a named role — `Customer support`, `Sales research`, `Legal review` — each with its own rules, available across chat, automations, and the API.

See [Agent concepts](/platform/agents/concepts) for the mental model, [Create an agent](/platform/agents/create) for the step-by-step, and [Agent versions](/platform/agents/versions) for safely iterating on a live agent.

### Automations

An automation is a multi-step workflow that runs on a trigger — a schedule, an event, a webhook, or a manual run. Each step does one thing: call an API, query a database, ask an LLM, branch on a condition, loop over a list. Automations handle the work that has to happen without a human in the chat — nightly imports, inbound webhook fan-outs, scheduled summaries.

See [Automation concepts](/platform/automations/concepts) for the mental model, [Workflows](/platform/automations/workflows) for the editor, [Triggers](/platform/automations/triggers) for how they start, and [Execution logs](/platform/automations/execution-logs) for debugging runs.

### Knowledge

The knowledge base is what agents search to answer questions. You upload documents, point at websites for crawling, and import structured records — products, customers, vendors. Curating it well is what turns an agent that hallucinates into an agent that cites.

See [Structured data](/platform/knowledge/structured-data) and [Website crawling](/platform/knowledge/crawling).

### Integrations

Integrations connect Tale to the systems where your real data lives — REST APIs, SQL databases, email providers, Microsoft 365. Once configured, integrations are available as tools for agents to call and as action steps in automations. The difference between an agent that gives generic advice and an agent that updates a ticket in your support tool is one integration.

See [Integrations overview](/platform/integrations/overview) and [AI providers](/platform/admin/providers).

## Permissions

Building requires the **Editor** role for agents and the **Developer** role for automations, integrations, and API keys. The full permission matrix is at [Members and roles](/platform/admin/members-and-roles); if a tutorial fails on a missing button, role is the first thing to check.

## AI-assisted building

Every building block above can also be created from JSON files in your project directory. If you open the project in an AI-powered editor (Claude Code, Cursor, GitHub Copilot, Windsurf), the editor has full context about schemas and platform capabilities — describe what you want in plain language, and the editor generates the configuration. For complex workflows or fleets of agents, this is usually faster than the UI. See [AI-assisted development](/develop/ai-assisted-development) for the full setup.

## Where this fits

The Developer role is the build-and-integrate seat. The same person who builds the agents your Editors curate also wires up the integrations the agents call, the automations that run in the background, and the API keys that let external systems call into Tale. For the canonical permission matrix, see [Members and roles](/platform/admin/members-and-roles); for cross-system work (calling Tale from a script, receiving webhooks), the [Develop](/develop/api-reference) section is one tab over.
