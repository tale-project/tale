---
title: Administer
description: Organisation-level settings — members and roles, providers, branding, governance, two-factor, usage analytics, data subject requests, and the in-app changelog.
---

Administration is the part of Tale that stays invisible until something is wrong with it. It is where you decide who can sign in and through which identity provider, which AI models the rest of the organisation is allowed to spend money on, how the product looks to people on the outside, and how long conversations and logs survive on disk. None of those are daily decisions, but each one surfaces in someone else's day the moment it is wrong — a Developer who cannot reach Anthropic, an Editor whose drafts vanished, a Member locked out after the SSO migration.

The pages in this section are for the **Admin** and **Owner** roles; every other role is blocked from the admin surface at the server. They are deliberately ordered. [Members and roles](/platform/admin/members-and-roles) is the page to read first, because nothing else in admin has a meaningful answer until you have decided who can do what. [Authentication](/self-hosted/admin/authentication) comes next, since the question of _who can sign in at all_ is a stricter version of the same question. Providers, branding, governance, and the rest layer on top.

If you are standing up a fresh organisation, read the pages in the order they appear in the sidebar. If you are auditing an existing one, jump straight to the page whose screen you already have open.

## Pages in this section

- **[Members and roles](/platform/admin/members-and-roles)** — invite, edit, and remove members; the canonical six-role permission matrix the rest of the docs link into.
- **[Teams](/platform/admin/teams)** — group members for scoped access to documents, conversations, and agent knowledge.
- **[Authentication](/self-hosted/admin/authentication)** — password, Microsoft Entra ID SSO, and trusted reverse-proxy headers; how Tale decides whether a sign-in succeeds.
- **[AI providers](/platform/admin/providers)** — connect Tale to OpenAI-compatible endpoints and decide which models the organisation can call.
- **[Branding](/platform/admin/branding)** — app name, logo, favicon, and the brand and accent colours used across the running app.
- **[Governance](/platform/admin/governance)** — system prompt, default models, budgets, upload policy, retention, password and login policy, feature controls, and the three-layer guardrail stack.
- **[Two-factor authentication](/platform/admin/two-factor-authentication)** — enrol TOTP, manage backup codes, enforce the org-wide policy, reset a member who lost their device.
- **[Usage analytics](/platform/admin/usage-analytics)** — token, cost, and run analytics filtered by team, user, agent, and time range.
- **[Data subject requests](/platform/admin/data-subject-requests)** — file GDPR Art. 17 erasure requests with SLA tracking and audit-chained receipts.
- **[What's new](/platform/admin/changelog)** — the in-app changelog viewer that surfaces release notes after every upgrade.
