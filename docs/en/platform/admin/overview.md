---
title: Admin
description: Admin is the configuration plane — members, teams, providers, API keys, integrations, branding, governance. The pages here are what an Admin or Owner clicks through to set up an org and keep it running.
---

Admin is the configuration plane of Tale. It covers the people who can sign in, the teams that group them, the AI providers behind every reply, the API keys that let external code talk to the org, the third-party integrations agents reach through, and the branding the rest of the org sees. Only Admins and Owners see the full Admin menu; Developers see a subset, and other roles do not see it at all.

These pages describe what each setting does and what it changes about the running product. Most of them are read once during setup and then revisited when something changes — a new hire, a rotated key, a new provider, a new integration. The role-and-permission story behind the menu lives in [Members and roles](/platform/admin/members-and-roles); the page indexed below assumes that story and goes per-feature from there.

## Pages in this section

**[Members and roles](/platform/admin/members-and-roles)** — Admins and Owners read this when they invite people or scope access by role.

**[Agents](/platform/admin/agents)** — Admins and Owners read this to see every agent the org has and step in when one needs governance.

**[API keys](/platform/admin/api-keys)** — Admins and Developers read this when they wire external code or an internal service to Tale's REST API.

**[Integrations](/platform/admin/integrations)** — Admins read this when they install or rotate the credentials behind Slack, Gmail, Outlook, Microsoft 365, Google Drive, Confluence, WebDAV, GitHub, Shopify, Tavily, and MCP.

**[Providers](/platform/admin/providers)** — Admins read this when they connect OpenAI, Anthropic, Azure, or a local Ollama and pick which models the org may use.

**[Teams](/platform/admin/teams)** — Admins read this to group members into teams that share agents, prompts, and integrations.

## Where this fits

Admin is the surface every other tab assumes. Chat resolves a model through the providers configured here; agents call tools through the integrations configured here; the prompt library and the inbox respect the team boundaries configured here. The natural first read is [Members and roles](/platform/admin/members-and-roles) — every other Admin page references the role names it defines.
