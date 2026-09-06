---
title: Teams
description: Teams are named groups of members that share access to documents, projects, skills, and conversations.
---

A team is a named group of members that shares access to documents, projects, skills, and conversations. Where roles define what a person _can_ do, teams define which slice of the org's data that person works in. Most orgs end up with a handful of teams — support, sales, ops — and most of the day-to-day permission decisions land on the team boundary, not the role boundary. Admins manage teams under **Settings > Teams**.

This page is the reference for what a team owns, how membership works, and how the team boundary interacts with the role-based permissions documented under [Members and roles](/platform/admin/members-and-roles). Read it once when you stand up the org's teams; come back when you reorganise.

<Frame caption="Settings > Teams — every team the org has, with its member count, beside the Create team action.">

![The Teams settings page listing three teams — Growth, Platform engineering, and Customer success — each with one member and the date it was added, beside a Create team button.](/images/platform/settings-teams.webp)

</Frame>

## What a team owns

A team holds membership and a set of resources scoped to it. The resources are:

- **Documents and folders** — a document or folder scoped to a team is visible and editable only by that team's members. Org-wide documents stay visible to everyone with the right role.
- **Projects** — a project can be assigned to a team, and shared with further teams; the teams' members inherit project access without being added one by one.
- **Skills** — a skill saved with team visibility appears only to those teams' members; the skill library's tabs split **Organization**, **Teams**, and **Personal**.
- **Conversations** — a conversation can be assigned to a team as well as to an individual, from the assignee picker in its header. Visibility follows that assignment: a team queue is visible to that team's members, a person assignment to that person, and admins and owners see everything. True unassigned conversations (no person, no team) stay with admins for triage — pair with [Conversation routing](/platform/admin/governance/policies-and-limits#conversation-routing) so inbound lands in a team on arrival.

A resource without a team scope stays visible to everyone whose role allows it. Teams are an _additive_ scoping layer — they narrow visibility, never widen it.

## Creating a team

Open **Settings > Teams** and click **Create team**. Give the team a name (`Support`, `Sales`, `Operations`) and tick its first members in the checklist — leave it empty and you are added automatically, since a team must keep at least one member. The name appears everywhere the team shows up: pickers, badges, team-scoped document access, and the project assignment field.

The team's row carries the day-to-day actions: **Members** manages who is in the team, **Edit team** renames it, **Delete team** retires it. What a team can reach follows from where the team is picked — a document's access scope, a project's assignment, a skill's visibility.

## Adding and removing members

Open the team's row and click **Add members**. The picker lists the org's members; checking one adds them to the team. A member can belong to multiple teams; their access is the union of every team they are in plus their role's org-wide reach. Removing a member from a team strips the team-scoped visibility on the next request; in-flight chats finish, but the next thread does not see the team's resources.

## Team versus role

The role decides what a person can do; the team decides what they can do it to. A Member-role user in the Support team can read the support team's documents but cannot edit them; an Editor-role user in the Support team can read and write them but cannot see Sales's. Teams never grant capabilities the role lacks; roles never widen visibility past the team scope.

When you need a permission decision the existing roles and teams cannot express, the next lever is a governance policy — see [Members and roles](/platform/admin/members-and-roles) for how policies attach to roles, and the governance section for the policy fields themselves.

## Deleting a team

Click the team's row, then **Delete team**. Deletion is hard-stop — the team is gone, all its members are removed from it, and they lose the team-scoped slice of their access. There is no undo. Reach for delete when a team is genuinely retired, not when it is reorganising.

What the team scoped is re-homed, not stranded: a project it owned passes to the first team it was shared with, or becomes organization-wide when there is none; a folder or document keeps its other teams; a conversation queued on the team goes back to unassigned. Nothing gets wider than the deleted team already allowed.

## Where this fits

Teams are the scoping layer right below roles — roles say _what_, teams say _where_. The natural next read depends on the resource you are scoping: [Skill library](/platform/workspace/skills) for how a shared instruction reaches everyone, [Connectors (admin view)](/platform/admin/connectors) for the credentials a team's automations call, and [Projects](/platform/projects/overview) for project-to-team assignment.
