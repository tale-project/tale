---
title: Teams
description: Group people to decide who can see team documents, projects, and inbox queues.
---

A team is a label on work, not a place you switch into. A document, folder, or project carries the teams that may see it, and a conversation can wait in a team's queue. A person's role controls what they may do; their teams decide which restricted work they can reach. Owners and Admins manage teams under **Settings > Teams**.

<Frame caption="Settings > Teams — every team the org has, with its member count, beside the Create team action.">

![The Teams settings page listing three teams — Growth, Platform engineering, and Customer success — each with one member and the date it was added, beside a Create team button.](/images/platform/settings-teams.webp)

</Frame>

## Create a team

1. Select **Create team** and enter a **Team name**, such as `Customer support`.
2. Select the organization's members who should join. If you select nobody, Tale adds you to the team.
3. Select **Create team**. Check the new row and its member count in the list.

Choose a name that people will recognize wherever teams are shown: the audience of a document or project, a queue in the inbox, a list filter. The form accepts up to 80 characters. Creating the team does not put existing work under it; choose the team on the documents, projects, and conversations it should cover.

## Change membership or the name

Open a team's row to inspect its members. The row menu offers **View**, **Edit**, and **Delete**. Use **Edit** to change the name or membership, then save your changes and check the member count.

A team keeps at least one member. To remove the last one, delete the team instead.

A person can belong to more than one team. Their access can come from several teams or from a direct assignment, so removing them from one team does not necessarily remove all access to a resource. Review those other routes when withdrawing access.

A team your identity provider provisions shows **Synced** in the list. The provider owns its name and members: the edit dialog shows them read-only, because a local change would be undone by the next synchronization. You can still delete such a team locally; the provider may recreate it.

<Tip>

Rename an existing team when its purpose changes but the same people should retain access. Deleting and recreating it creates a different team and changes existing resource assignments.

</Tip>

## What a team decides

Every team-scoped resource follows one rule. A resource with no team is visible to everyone in the organization. A resource with teams is visible to the members of any of those teams. Owners and Admins see everything either way, so a team is never a way to hide work from administrators.

| Resource | How teams matter |
| --- | --- |
| Projects | **Audience** on **General** lists the teams that can open the project; empty means the whole organization. |
| Documents and folders | A document or folder carries the teams that can read it. Anything filed into a team folder takes the folder's teams and cannot name a team outside them. |
| Skills | Team visibility makes a skill available to the selected teams. |
| Conversations | Assignment to a team places the conversation in that team's queue. |

When you restrict work to teams, you can only choose teams you belong to; Owners and Admins can choose any team of the organization. Team membership does not grant actions that a role forbids: an Editor and a Member in the same team can have different editing rights.

Members see their own teams under **Settings > Account > Your teams** and in the **Teams** row of the profile menu. To narrow a list to certain work, each list offers a **Teams** filter with **Organization-wide**, **My teams**, and every team by name; the inbox uses an **Assignee** filter instead, which covers people as well as teams. See [Manage your account](/platform/member/preferences#teams).

For inbound conversations, [routing rules](/platform/admin/governance/policies-and-limits#conversation-routing) can select the team when the conversation arrives. Without a person or team assignment, the conversation stays in administrator triage.

## Retire a team carefully

Choose **Delete** from the row menu. The confirmation counts the team's members, the projects, folders, and documents it is on, and the conversations in its queue. It also says how many of those items have no other team and will become visible to everyone in the organization. Reassign work that must remain restricted before you confirm.

<Warning>

Deleting a team cannot be undone. Every project, folder, and document drops the team and keeps its other teams. An item whose only team it was becomes organization-wide, which can make it visible to more people.

</Warning>

The team, its memberships, its place on every resource, and any identity-provider link go in one step, so a half-deleted team cannot remain. A conversation loses its team assignment; if no person is assigned either, it returns to administrator triage. Imported-file configurations also lose that team scope. Deleting a team does not delete its members' accounts.

Teams synchronized through [enterprise SSO or SCIM](/platform/admin/enterprise-sso) also depend on the identity provider's provisioning rules. Check that source before making a local change you expect to persist.
