---
title: Teams
description: Organise members into teams and scope knowledge visibility.
---

Teams let you group members — Engineering, Sales, Support, Legal — and control which knowledge each group sees. A team is a soft grouping: it doesn't affect login, roles, or permissions. It _does_ affect which documents and conversations appear in each member's filtered views.

Team management lives in **Settings > Teams** and is Admin-only.

## Creating a team

1. Go to **Settings > Teams** and click **Add team**.
2. Enter a team name — keep it short, it appears in filter menus throughout the UI.
3. Optionally add a description.
4. Click Create.

Members are added separately via the team's detail page. The same member can belong to any number of teams.

## What teams affect

| Area                         | Team scoping                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Documents**                | A document can be tagged to one or more teams during upload. Members see only documents tagged to their teams when a team filter is active.      |
| **Conversations**            | Conversations can be assigned to a team. Team-based inboxes let Support see support threads and Sales see sales threads without cross-pollution. |
| **Agents**                   | An agent's Knowledge tab can be restricted to team-tagged knowledge so a Support agent only searches Support-tagged content.                     |
| **Budgets and model access** | Governance policies (see [Governance](/admin/governance)) can be scoped per team.                                                                |

## Team managers

Teams don't have formal manager roles — permissions are set by the org-level Role (Admin, Developer, Editor, Member). For delegated team-level administration, use the org-level Editor role and scope the editor's agent and knowledge access to their team.

## External identity providers

When SSO or trusted headers are used, the external IdP is the single source of truth for team membership. Tale reads the teams header on each login and updates the user's team list. See [Authentication](/admin/authentication) for details.
