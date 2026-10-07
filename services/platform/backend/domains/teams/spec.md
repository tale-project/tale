# Teams — who can see and change a team, and what deleting one does

> **Prefix** `TEAM-` · **Docs** [`admin/teams`](../../../../../docs/en/platform/admin/teams.md)

A team is a group of people that projects, folders, documents and conversation queues can be
restricted to. These rules cover who can see a team and its members, who can change its
members, and what deleting a team does. Creating and renaming a team, teams kept in step with
an identity provider, and how a team restricts work are not covered; see Not yet.

## Who can do what

| | See the names of all teams | See a team's members | Change members, delete the team |
| --- | --- | --- | --- |
| An owner or admin | yes | yes, of every team | yes |
| A member of the team | yes | yes | no |
| Anyone else in the organization | yes | no | no |

### TEAM-R1 · Everyone in the organization can see the names of its teams

- **Example**: Mia is a member and belongs to no team. She opens a **Teams** filter → every
  team of her organization is listed by name.

### TEAM-R2 · A team's members are shown only to its own members and to admins

Someone in the organization who is not in the team is refused (`TEAM_FORBIDDEN`). An owner or
admin sees the members of every team.

- **Example**: Mia is not in the Finance team. She asks who is in it → refused.

### TEAM-R3 · Only owners and admins can change a team's members or delete the team

This covers adding and removing a member, deleting the team, and the preview of what a delete
would change. Anyone else is refused (`TEAM_FORBIDDEN`).

- **Example**: Noah is a member of the Finance team and not an admin. He adds Mia to it →
  refused, and Mia is not added.

## Members of a team

### TEAM-R4 · Only someone in the organization can be added to a team

Anyone else is refused (`USER_NOT_ORG_MEMBER`) and nothing is saved.

- **Example**: Ada adds Zoe, who belongs to another organization, to the Finance team →
  refused.

### TEAM-R5 · Adding someone who is already in the team changes nothing

The request succeeds, the person is in the team once, and no audit entry is written.

- **Example**: Ada adds Noah to the Finance team twice → he is a member once, and the audit log
  has one entry.

### TEAM-R6 · A team keeps at least one member

Removing the last member is refused (`TEAM_LAST_MEMBER`). A team that should have nobody is
deleted instead.

- **Example**: Noah is the only member of the Finance team. Ada removes him → refused, and he
  stays a member.

### TEAM-R7 · Every change to a team's members is written to the audit log

- **Example**: Ada removes Noah from a team that has other members → he is removed, and the
  audit log records it.

## Deleting a team

### TEAM-R8 · Before deleting a team, an admin is shown what the delete will change

The preview counts the team's members, the projects, folders and documents restricted to it,
the conversations waiting in its queue and the imported-file configurations on it. For
projects, folders and documents it also says how many have no other team and will become
visible to everyone in the organization. Documents in the trash are not counted.

- **Example**: Ada opens the delete confirmation of the Finance team → it says 4 projects are
  on the team and 1 of them will become visible to the whole organization.

### TEAM-R9 · Deleting a team takes it off everything it was on, in one step

Every project, folder and document drops the team and keeps its other teams. Conversations in
its queue lose that assignment, imported-file configurations lose that team, and the team's
memberships and the team itself are removed. All of it happens together or not at all, and
the audit log records the counts.

- **Example**: A project is restricted to Finance and Legal. Ada deletes Finance → the project
  is restricted to Legal alone.

### TEAM-R10 · A team of another organization is answered as not found

This holds for the preview and for the delete (`TEAM_NOT_FOUND`); nothing is changed and no
audit entry is written.

- **Example**: Zoe, an admin of another organization, deletes Ada's Finance team by its ID →
  not found, and the team stays.

## Not yet

- **Creating and renaming a team** (handled by the sign-in library's organization tables, not
  by this domain's routes).
- **Teams kept in step with an identity provider**: their name and members are read-only in
  the app (the SSO and SCIM domains).
- **How a team restricts a project, a folder, a document or a queue**, and which teams a
  person can choose when restricting: decided by those domains.
