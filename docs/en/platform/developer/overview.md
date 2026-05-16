---
title: Developer
description: The build-and-integrate seat — agents, automations, integrations, MCP servers, and API keys. The Developer's task-oriented landing for the day-to-day.
---

A **Developer** in Tale is the build-and-integrate seat. You wire up the parts of the platform everyone else uses: the agents your Editors curate knowledge for, the automations that run in the background, the integrations that connect Tale to other systems, and the API keys that let scripts and webhooks call into Tale from the outside. Everything an Editor can do, you can do; on top of that you create and publish automations, configure integrations and MCP servers, and manage API keys. You do not change organisation settings — branding, governance, providers, member roles — those are Admin territory.

Building in Tale is mostly composition rather than coding. You decide what an agent should know, what it can do, and how it should behave; Tale handles the model calls, the conversation memory, the tool orchestration, and the run history. The mental model below is the small set of pieces you compose. The canonical permission matrix lives at [Members and roles](/platform/admin/members-and-roles) — read it when a tutorial fails on a missing button.

## A Developer's day

A typical Developer day starts in **Automations** to look at last night's runs — green is boring; red is the first thing to triage from the execution logs. From there the work splits two ways: the Editor team needs an agent updated with a new knowledge filter and a new tool, and an inbound webhook from the support system needs a new automation step. The agent edit is a single screen change in **Agents** and a publish; the new step is added in the workflow editor, tested in a dry run, and shipped behind a feature flag. Late afternoon, an Admin asks for an API key rotation; you create the replacement key, swap it on the external caller, and revoke the old one.

The pages below are arranged in the order the day asks for them — agents first because the question is usually "is the agent doing the right thing?", automations next because the question becomes "what about when no one is watching?", knowledge and integrations because those are the inputs to both.

## Pages in this section

- **[Agent concepts](/platform/agents/concepts)** — the four pieces every agent is made of (instructions, knowledge, tools, model) and the trade-offs each piece names.
- **[Create an agent](/platform/agents/create)** — the step-by-step from an empty `Agents > New` to a published agent the rest of the team can pick in chat.
- **[Agent versions](/platform/agents/versions)** — how to iterate on a live agent without breaking the conversations and automations that already use it.
- **[Automation concepts](/platform/automations/concepts)** — the mental model: workflow, step, trigger, run, branch, loop. Read once, refer back to.
- **[Workflows](/platform/automations/workflows)** — the visual editor where steps are added, wired, and dry-run.
- **[Triggers](/platform/automations/triggers)** — schedules, webhooks, events, manual runs; how an automation starts.
- **[Execution logs](/platform/automations/execution-logs)** — per-run inputs, outputs, branch decisions, and errors; the debugger you reach for when an automation went the wrong way.
- **[Structured data](/platform/knowledge/structured-data)** — products, customers, vendors; the rows agents ground against when an answer needs more than a document.
- **[Website crawling](/platform/knowledge/crawling)** — point Tale at a website, schedule recrawls, watch the indexer fill the knowledge base.
- **[Integrations overview](/platform/integrations/overview)** — REST, SQL, email, Microsoft 365; the systems where the real data lives.
- **[AI providers](/platform/admin/providers)** — Admin-owned but linked here because every agent's model selection draws from this catalogue.

## AI-assisted building

Every building block above can also be authored from JSON files in your project directory. If you open the project in an AI-aware editor (Claude Code, Cursor, GitHub Copilot, Windsurf), the editor has full context about the schemas and platform capabilities — describe what you want in plain language, and the editor generates the configuration. For complex workflows or fleets of agents, this is often faster than the UI. See [AI-assisted development](/develop/ai-assisted-development) for the setup.

## Where this fits

The Developer role is the build-and-integrate seat. The same person who builds the agents Editors curate also wires up the integrations the agents call, the automations that run in the background, and the API keys that let external systems call into Tale. For the canonical permission matrix, see [Members and roles](/platform/admin/members-and-roles); for cross-system work (calling Tale from a script, receiving webhooks), the [Develop](/develop/api-reference) section is one tab over.
