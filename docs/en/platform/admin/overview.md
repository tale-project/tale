---
title: Admin
description: Admin is the configuration plane — members, teams, providers, API keys, connectors, branding, governance.
---

Admin is the configuration plane of Tale. It covers the people who can sign in, the teams that group them, the AI providers behind every reply, the API keys that let external code talk to the org, the third-party connectors agents reach through, and the branding the rest of the org sees. Only Admins and Owners see the full Admin menu; Developers see a subset, and other roles do not see it at all.

These pages describe what each setting does and what it changes about the running product. Most are read once during setup and revisited when something changes — a new hire, a rotated key, a new provider. The role-and-permission story behind the whole menu lives in [Members and roles](/platform/admin/members-and-roles); start there, because every other Admin page references the role names it defines.

Prefer to watch first? Episode 9 tours the whole control room — providers, guardrails, audit, cost — in three minutes, captions included.

<Video src="/videos/en/tutorials/ep9-governance/ep9-governance.en.mp4" poster="/videos/en/tutorials/ep9-governance/ep9-governance.en.webp" captions="/videos/en/tutorials/ep9-governance/ep9-governance.en.vtt" lang="en" title="Episode 9 — Governance, cost & trust" caption="Episode 9 — Governance, cost & trust (3:01)">

</Video>

## Configuration areas

<CardGroup cols="2">

<Card title="Members and roles" icon="users" href="/platform/admin/members-and-roles">

The six roles and the resource-level matrix that says who can read, write, configure, and govern.

</Card>

<Card title="Teams" icon="users-round" href="/platform/admin/teams">

Group members into teams that share documents, projects, skills, and conversations.

</Card>

<Card title="Agents" icon="bot" href="/platform/admin/agents">

Every agent the org has, and where an Admin steps in when one needs governance.

</Card>

<Card title="AI providers" icon="cpu" href="/platform/admin/providers">

Store the credentials behind every reply and pick which models the org may call.

</Card>

<Card title="Connectors" icon="plug" href="/platform/admin/connectors">

Store and replace the credentials behind Slack, Gmail, Outlook, Google Drive, GitHub, Shopify, and more.

</Card>

<Card title="Enterprise SSO" icon="shield-check" href="/platform/admin/enterprise-sso">

Wire sign-in to your identity provider with SAML or OIDC.

</Card>

<Card title="API keys" icon="key" href="/platform/admin/api-keys">

Mint the keys external code uses to reach Tale's REST API.

</Card>

<Card title="Branding" icon="palette" href="/platform/admin/branding">

The logo, favicon, and accent colour the rest of the org sees.

</Card>

<Card title="Two-factor authentication" icon="smartphone" href="/platform/admin/two-factor-authentication">

Require a second factor for sign-in and manage enrolment across the org.

</Card>

<Card title="Changelog" icon="history" href="/platform/admin/changelog">

The in-product record of what shipped and when.

</Card>

<Card title="Governance" icon="scale" href="/platform/admin/governance/audit-logs">

Audit logs, policies and limits, guardrails, analytics, retention, and legal hold.

</Card>

</CardGroup>

## Where this fits

Admin is the surface every other tab assumes. Chat resolves a model through the providers configured here; agents call tools through the connectors configured here; the skill library and the inbox respect the team boundaries configured here. The natural first read is [Members and roles](/platform/admin/members-and-roles) — every other Admin page references the role names it defines.
