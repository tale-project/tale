---
title: Agents (admin view)
description: The org-wide agents list — every agent in the organisation, who owns it, who can reach it, and what it is allowed to touch.
---

The Admin agents view is the org-wide directory of every agent that exists in Tale, regardless of who built it. Editors and Developers see the agents they have access to in their own area; Admins and Owners see all of them, plus the per-agent governance levers and the per-agent audit trail. This page covers that supervisory surface — what the table shows, what an Admin can change, and what stays under the agent owner's control.

This page does not teach you how to build an agent. That is the Editor view under [Agent concepts](/platform/agents/concepts). What follows is the other side: how to find an agent, how to step in when one needs attention, and how the role boundaries hold when you do.

## What the table shows

Open **Settings > Agents** to land on the org-wide list. Each row names an agent and shows who owns it, whether it is shared with the organization or kept private, and when it was last edited. The list is searchable by name, and the default sort is most-recently-edited first — useful when you want to see what has changed since you last looked.

Clicking a row opens the same agent editor an Editor or Developer would see, but with the Admin lens on: every tab is visible, every binding is editable, and the history shows the full edit trail with the actor and the diff for each save.

## What an Admin can do that an Editor cannot

Admins inherit every permission Editors and Developers carry on the agent surface. Beyond those, the Admin view adds three governance moves.

- **Narrow an agent's reach.** Flipping a shared agent back to private takes it out of every member's picker without deleting anything — its conversations and its history stay intact, and sharing it again restores the previous behaviour. Reach for this when an agent is misbehaving and you need it to stop being used while you work out why.
- **Reassign ownership.** An agent's owner is the member responsible for it, and a private agent must always have one. Reassigning hands the agent to somebody else; the previous owner keeps whatever access their role gives them and nothing more. Reach for it when an owner changes teams or leaves.
- **Apply a governance policy.** Admins can attach a policy to an agent — required approvals on writes, which tool families are permitted, which integrations may be reached. The policy wins over the agent's own configuration wherever the two disagree, and the agent's owner sees it as a read-only badge in the editor.

## What stays with the agent owner

Most everyday editing stays with whoever built the agent: renaming it, rewriting its instructions, adjusting its knowledge scope, granting or revoking tools, binding and unbinding skills, and saving new versions. The Admin view is for stepping in, not for taking over. If you find yourself editing other people's agents routinely, the right answer is usually a governance policy that scopes the behaviour for a class of agents rather than a manual edit to one of them.

One thing sits outside both roles: nobody pins a model to an agent. The model is chosen per turn by whoever sends the message, so governing which models may be used is a [Providers](/platform/admin/providers) question and a [Policies and limits](/platform/admin/governance/policies-and-limits) question, never an agent-by-agent one.

## Audit and history

Every save on an agent lands in the audit log with the actor, the timestamp, and the field that changed. The Admin view exposes the per-agent slice of that log through the agent editor's history; the same data is reachable org-wide under **Settings > Governance**. Bindings are worth reading with that in mind — an agent's configuration can sit unchanged while a skill bundle it binds is replaced underneath it, and the bundle's own audit trail is where that shows up.

## Where this fits

The Admin agents view is the supervisory complement to the Editor's build view — the same agents, a different lens. Most of the time you should reach for it only when something needs attention; the day-to-day work happens in the agent editor under [Agent concepts](/platform/agents/concepts). When the right answer is to scope behaviour for a class of agents rather than one of them, the next read is [Members and roles](/platform/admin/members-and-roles) for how policies attach to roles.
