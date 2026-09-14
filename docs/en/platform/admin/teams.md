---
title: Teams
description: Group people for shared resource access and conversation assignment.
---

Use teams when several people need access to the same work. A person's role controls what they may do; team membership helps determine which projects, documents, skills, and conversations they can reach. Owners and Admins manage teams under **Settings > Teams**.

<Frame caption="Settings > Teams — every team the org has, with its member count, beside the Create team action.">

![The Teams settings page listing three teams — Growth, Platform engineering, and Customer success — each with one member and the date it was added, beside a Create team button.](/images/platform/settings-teams.webp)

</Frame>

## Create a team

1. Select **Create team** and enter a **Team name**, such as `Customer support`.
2. Select the organization's members who should join. If you select nobody, Tale adds you to the team.
3. Select **Create team**. Check the new row and its member count in the list.

Choose a name that people will recognize in access and assignment pickers. The form accepts up to 80 characters. Creating the team does not automatically assign every existing project or conversation to it; choose the team on the resources it should share.

## Change membership or the name

Open a team's row to inspect its members. The row menu offers **View**, **Edit**, and **Delete**. Use **Edit** to change the name or membership, then save your changes and check the member count.

A person can belong to more than one team. Their access can come from several teams or from a direct assignment, so removing them from one team does not necessarily remove all access to a resource. Review those other routes when withdrawing access.

<Tip>

Rename an existing team when its purpose changes but the same people should retain access. Deleting and recreating it creates a different team and changes existing resource assignments.

</Tip>

## Apply a team to work

| Resource | How teams matter |
| --- | --- |
| Projects | A project can belong to one team and be shared with additional teams. |
| Documents and folders | Team access limits which members can read the content, alongside role checks. |
| Skills | Team visibility makes a skill available to the selected teams. |
| Conversations | Assignment to a team places work in that team's queue. |

Team membership does not grant actions that a role forbids. An Editor and a Member in the same team can have different editing rights. Owners and Admins retain administration access; do not use a team as a way to hide work from administrators.

For inbound conversations, [routing rules](/platform/admin/governance/policies-and-limits#conversation-routing) can select the team when the conversation arrives. Without a person or team assignment, the conversation stays in administrator triage.

## Retire a team carefully

Before deleting a team, review the projects it owns, shared documents, conversation queue, and imports scoped to it. Reassign work that must remain restricted, then choose **Delete** from the row menu and review the confirmation.

<Warning>

Deleting a team cannot be undone. A project it owns passes to its first remaining shared team; if none remains, the project becomes organization-wide. Review access before deletion, because this can make a project available to more people.

</Warning>

Documents and folders lose the deleted team from their access list and retain any other teams. A conversation loses its team assignment; if no person is assigned either, it returns to administrator triage. Imported-file configurations also lose that team scope. Deleting a team does not delete its members' accounts.

Teams synchronized through [enterprise SSO or SCIM](/platform/admin/enterprise-sso) also depend on the identity provider's provisioning rules. Check that source before making a local change you expect to persist.
