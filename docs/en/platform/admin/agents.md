---
title: Agents (admin view)
description: The org-wide agents list — every agent in the organisation, who built it, which model it runs, what knowledge it touches. Admins and Owners read this when they govern agents across the whole org rather than build one of their own.
---

The Admin agents view is the org-wide directory of every agent that exists in Tale, regardless of who built it. Editors and Developers see only the agents they have access to in their own area; Admins and Owners see all of them, plus the per-agent governance levers and the per-agent audit trail. This page covers the Admin surface — what the table shows, what an Admin can change, and what stays under the agent owner's control.

This page does not teach you how to build an agent. That is the Editor view under [Agents](/platform/agents/concepts). What follows is the supervisory side: how to find an agent, how to step in when one needs attention, and how the role boundaries hold when you do.

## What the table shows

Open **Settings > Agents** to land on the org-wide list. Each row names an agent and shows its primary model, its category, the team it belongs to (if any), and the date it was last edited. The list is searchable by name and filterable by category, team, and status (active or disabled). The default sort is most-recently-edited first — useful when you want to see what changed since the last time you looked.

Clicking a row opens the same agent editor an Editor or Developer would see, but with the Admin lens on: every tab is visible, every binding is editable, and the audit-log tab shows the full edit history with the actor and the diff for each save.

## What an Admin can do that an Editor cannot

Admins inherit every permission Editor and Developer carry on the agent surface. Beyond those, the Admin view adds three governance moves:

- **Disable an agent.** A disabled agent stops appearing in pickers and stops responding to new requests, but its conversations, executions, and audit trail are preserved. Re-enabling restores the previous behaviour. Reach for disable when an agent is misbehaving and you need to stop it without losing context.
- **Reassign ownership.** An agent's owner is the team or member responsible for it. Reassigning transfers the agent to another team or member; the previous owner loses write access unless they share the new team. Reach for reassignment when a team is reorganised or an owner leaves.
- **Apply a governance policy.** Admins can attach a governance policy to an agent — required approvals on writes, allowed tool families, allowed integrations. The policy overrides the agent's own configuration if there is a conflict; the agent's owner sees the policy as a read-only badge in the editor.

## What stays with the agent owner

Most everyday editing stays with whoever built the agent. Renaming, editing instructions, adjusting the knowledge bindings, toggling tools, switching models, publishing new versions — all of that happens in the agent editor under the owner's permissions. The Admin view is for stepping in, not for taking over. If you find yourself editing other people's agents routinely, the right answer is usually a governance policy that scopes the behaviour, not a manual edit.

## Audit and history

Every save on an agent lands in the audit log with the actor, the timestamp, and the field that changed. The Admin view exposes the per-agent slice of that log under the **History** tab in the agent editor. The same data is also reachable from the org-wide audit log under **Settings > Governance**.

## Where this fits

The Admin agents view is the supervisory complement to the Editor's build view — same agents, different lens. Most of the time you should reach for it only when something needs attention; the day-to-day work happens on the agent editor under [Agent concepts](/platform/agents/concepts). When the right answer is to scope behaviour for a class of agents rather than one of them, the next read is the governance policy surface — see [Members and roles](/platform/admin/members-and-roles) for how policies attach to roles.
