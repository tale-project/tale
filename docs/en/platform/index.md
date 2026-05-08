---
title: Platform overview
description: Product documentation for Tale — features, roles, and organisation admin. Applies identically to Cloud and self-hosted.
---

Platform is the complete product documentation for Tale. It covers every user-visible feature — chat, knowledge base, agents, automations, integrations — plus role-specific task guidance and all org-level admin settings (members, roles, teams, branding, governance, AI providers, analytics). Everything here applies identically whether you are on the managed [Cloud](/cloud) edition or running a [Self-hosted](/self-hosted) instance.

The only docs that do **not** live here are the edition-specific ones: Cloud billing, residency, and hosted SSO live under Cloud; instance installation, environment configuration, observability, and release notes live under Self-hosted. If a page describes a feature you see in the product UI, it is in this tab.

## By feature

- **[Chat](/platform/chat/basics)** — the conversational surface. Attachments, agents in chat, Arena Mode for side-by-side model comparison.
- **[Workspace](/platform/workspace/knowledge-base)** — knowledge base, conversations, approvals, canvas, prompt library, document comparison.
- **[Agents](/platform/agents/concepts)** — custom AI assistants: what they are, how to create one, how versions work.
- **[Automations](/platform/automations/concepts)** — multi-step workflows, triggers, execution logs.
- **[Knowledge](/platform/knowledge/structured-data)** — structured data and website crawling.
- **[Integrations](/platform/integrations/overview)** — connecting Tale to AI providers, data sources, and third-party tools.

## By role

Tale has six roles. Four have task-oriented guidance here; Owner is Admin plus a small set of lifecycle actions; Disabled has no product access.

- **[Member](/platform/member/overview)** — read-only: chat, browse knowledge, read conversations and approvals.
- **[Editor](/platform/editor/overview)** — Member plus content management and approval decisions.
- **[Developer](/platform/developer/overview)** — Editor plus agents, automations, integrations, API keys.
- **[Admin](/platform/admin/overview)** — Developer plus org settings.

## Organisation admin

Org-level settings apply equally to Cloud and self-hosted, except where noted. Canonical reference:

- [Members and roles](/platform/admin/members-and-roles) — the six-role permission matrix.
- [Teams](/platform/admin/teams) — scope knowledge and chat access.
- [AI providers](/platform/admin/providers) — configure OpenAI, Anthropic, Google, and self-hosted models.
- [Branding](/platform/admin/branding) — logos, colours, product name.
- [Governance](/platform/admin/governance) — content and policy controls.
- [Usage analytics](/platform/admin/usage-analytics) — per-user and org-wide activity.

For authentication setup (password, SSO, trusted headers), see [Self-hosted authentication](/self-hosted/admin/authentication) — the configuration surface is specific to self-hosted; Cloud handles it via the hosted admin UI.
