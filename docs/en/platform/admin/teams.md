---
title: Teams
description: Group members into teams to scope which documents, conversations, and agent knowledge each group sees by default.
---

Teams are how you slice an organisation into Engineering, Sales, Support, Legal — or whatever shape your company actually has — and decide which knowledge each slice sees by default. A team is a soft grouping: it does not change roles, it does not change permissions, and it does not gate sign-in. What it does change is which documents and conversations surface in each member's filtered views, which knowledge an agent will search, and which scope a Governance rule (a budget, a default model, a feature flag) applies to. The page lives under **Settings > Teams** and is Admin-only.

The same member can belong to any number of teams. Most organisations end up with three to ten — more becomes hard to maintain because every filter and every team-scoped Governance rule now has to be authored against more slices than anyone tracks.

## Create a team

Open **Settings > Teams** and click **Create team**. The dialog asks for two fields:

1. **Team name** — short, since it appears in filter menus across the UI. Required.
2. **Members** — the checklist below the name picks which members join the team. A member can be on any number of teams; if you leave the checklist empty, the Admin who created the team is added automatically so the team has at least one occupant.

Click **Create team**. The team appears in the table with its name, member count, and creation date. Members can be added or removed later from the team's detail row via **Members**.

## What teams actually scope

| Surface              | What team membership controls                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Documents**        | A document can be tagged to one or more teams at upload. Members see only documents tagged to their teams when a team filter is active.                                                 |
| **Conversations**    | A conversation can be assigned to a team. Team-scoped inboxes let Support see support threads and Sales see sales threads without cross-pollution.                                      |
| **Agents**           | An agent's **Knowledge** tab can be restricted to team-tagged knowledge, so a Support agent only searches Support-tagged content.                                                       |
| **Governance rules** | Budgets, default models, model access, and feature controls (see [Governance](/platform/admin/governance)) can be scoped per team. The precedence rule is user > team > role > default. |

Teams do _not_ control whether someone can _see_ the surface at all — that is the role's job. An Editor can always reach Conversations; what teams decide is which conversations are filtered in by default.

## Manage members of a team

Open a team's row and click **Members**. The drawer shows the team's current member list with a checklist of organisation members to add or remove. The member-checklist hint reminds the Admin that a member can be on multiple teams, and that the team will end up with the Admin themselves if no one else is selected.

## Team managers

Teams do not have formal manager roles — every member of the organisation has the same role across every team they belong to. For delegated team-level administration, use the org-level **Editor** role and scope that Editor's knowledge and agent access to their team via the same scoping table above. That keeps the role matrix in [Members and roles](/platform/admin/members-and-roles) authoritative and avoids a parallel permission system.

## External identity providers

When SSO or trusted headers are enabled, the external identity provider is the single source of truth for team membership. Tale reads the teams header (or the IdP group claim) on each sign-in and updates the user's team list to match. Edits made in **Settings > Teams** for those users will be overwritten on the next sign-in. See [Authentication](/self-hosted/admin/authentication) for the header names and the group-mapping configuration.

## Where this fits

Teams are the knowledge-and-conversation scoping layer. They do not change roles or permissions — those live on [Members and roles](/platform/admin/members-and-roles). Use teams to decide who sees which documents and which conversation channels by default; use roles to decide what each member can do. A team-scoped Governance rule (a tighter budget, a cheaper default model, a feature toggle) is how you compose the two systems without overlap.

When a team grows past the point a single Editor can curate alone, the natural next move is to split it; when it shrinks so far that two teams have the same members, fold them together. Both edits are cheap from this page.
