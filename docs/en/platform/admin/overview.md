---
title: Administer
description: Organisation-level settings — members, authentication, providers, branding, governance, analytics.
---

Administration is the part of Tale that's invisible until something goes wrong. It's where you decide who can sign in and through which identity provider, which AI models the rest of the organisation is allowed to spend money on, what the product looks like to people from the outside, and how long conversations and logs are kept on disk. None of these are day-to-day decisions, but each of them shows up in someone else's day-to-day the moment it's wrong — a developer who can't reach Anthropic, an editor whose drafts disappeared, a member who can't sign in after the SSO migration.

The pages in this section are for the **Admin** and **Owner** roles; other roles cannot see the admin surface at all. They are deliberately ordered. [Members and roles](/platform/admin/members-and-roles) is the page to read first, because nothing else in admin is meaningful without an answer to "who can do what?". [Authentication](/self-hosted/admin/authentication) follows, since the question of _who can sign in at all_ is a stricter version of the same question. Provider configuration, branding, governance, and the rest layer on top.

If you are standing up a fresh organisation, read the pages in the order they appear in the sidebar. If you are auditing an existing one, jump straight to the page whose UI you are already in.

## Pages in this section

- [Members and roles](/platform/admin/members-and-roles) — who can do what, and how to add or remove them.
- [Teams](/platform/admin/teams) — grouping members for shared access to agents and knowledge.
- [Authentication](/self-hosted/admin/authentication) — password, SSO (Microsoft Entra), trusted reverse-proxy headers.
- [Providers](/platform/admin/providers) — the AI models available to the organisation.
- [Branding](/platform/admin/branding) — logo, colours, login wallpaper, product name.
- [Governance](/platform/admin/governance) — retention, data-subject requests, audit log.
- [Two-factor authentication](/platform/admin/two-factor-authentication) — TOTP and recovery codes.
- [Usage analytics](/platform/admin/usage-analytics) — per-user and org-wide activity.
- [What's new](/platform/admin/changelog) — the in-app changelog viewer for release-note communication.
