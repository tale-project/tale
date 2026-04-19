---
title: What you can build
description: An orientation for agent and automation builders.
---

If you configure Tale for your team, this section is for you. "Building" means setting up the parts of the platform that everyone else uses — the agents they chat with, the automations that run in the background, the integrations that connect Tale to your other systems, and the knowledge the AI can search.

## The building blocks

### Agents

An agent is a customised AI assistant. You decide its system prompt, which AI model it uses, which knowledge it can search, which tools it can call, and how it should behave. Think of an agent as a named role — "Customer support", "Sales research", "Legal review" — each with its own rules.

See [Agent concepts](/platform/agents/concepts) for the mental model, [Create an agent](/platform/agents/create) for the step-by-step, and [Agent versions](/platform/agents/versions) for safely iterating on a live agent.

### Automations

An automation is a multi-step workflow that runs on a trigger — a schedule, an event, a webhook, or a manual run. Each step does one thing: call an API, query a database, ask an LLM, branch on a condition, loop over a list. Automations handle the work that happens without a human in the chat.

See [Automation concepts](/platform/automations/concepts) for the mental model, [Workflows](/platform/automations/workflows) for the editor, [Triggers](/platform/automations/triggers) for how they start, and [Execution logs](/platform/automations/execution-logs) for debugging runs.

### Knowledge

The knowledge base is what agents search to answer questions. You can upload documents, point at websites for crawling, and import structured records (products, customers, vendors). Curating the knowledge base well is what makes the AI's answers useful.

See [Structured data](/platform/knowledge/structured-data) and [Website crawling](/platform/knowledge/crawling).

## Integrations

Integrations connect Tale to the systems where your real data lives — REST APIs, SQL databases, e-mail, Microsoft 365. Once configured, integrations are available as tools for agents to call and as action steps in automations.

See [Integrations overview](/platform/integrations/overview) and [Bring your own model](/platform/integrations/providers).

## Permissions

Building requires the **Editor** role for agents and the **Developer** role for automations, integrations, and API keys. See [Members and roles](/platform/admin/members-and-roles) for the full permission matrix.

## AI-assisted building

All of the building blocks can also be created from JSON files in your project directory. If you open the project in an AI-powered editor (Claude Code, Cursor, GitHub Copilot, Windsurf), the editor has full context about schemas and platform capabilities — you can describe what you want in plain language and have the AI generate the configuration. See [AI-assisted development](/develop/ai-assisted-development).
