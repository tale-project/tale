# SCIM — what an identity provider can change about members and teams

> **Prefix** `SCIM-` · **Docs** [`admin/enterprise-sso`](../../../../../docs/en/platform/admin/enterprise-sso.md)

With SCIM an organization's identity provider creates, updates and deactivates members, and
keeps teams in step with its groups, without anyone signing in. A SCIM user is a member and a
SCIM group is a team. These rules cover what the provider cannot do and what its changes take
with them. The SCIM token, listing and filtering, and creating a member are not covered; see
Not yet.

## Members

### SCIM-R1 · The organization's owner cannot be deactivated or removed through SCIM

A request that sets the owner to inactive is refused (`scim_owner_protected`), and a request
that deletes the owner removes nothing. The owner's other details can still be updated, and
any other member is deactivated as asked.

- **Example**: The identity provider marks the organization's owner as inactive → refused, and
  the owner can still sign in.

### SCIM-R2 · A user name cannot be changed to an email that is already in use

The user name is the member's sign-in email. Changing it to the email of another account is
refused (`scim_user_conflict`).

- **Example**: The provider renames Mia to `noah@example.com`, which is Noah's sign-in → refused.

### SCIM-R3 · A user name cannot be changed for an account that is in another organization too

The account's sign-in is shared with that other organization, so one organization's provider
cannot rewrite it (`scim_identity_shared`).

- **Example**: Mia belongs to two organizations. The provider of one changes her user name →
  refused, and she signs in to both with the email she had.

### SCIM-R4 · Removing a member through SCIM also removes what they held in the organization

Their team memberships and their preferences in that organization go with the membership. A
member the provider is not allowed to remove loses nothing.

- **Example**: The provider deletes Mia's SCIM user → she is no longer a member of the
  organization or of any of its teams.

## Teams

### SCIM-R5 · A group can contain only members of its organization

Creating a group, replacing it or adding to it with someone who is not a member of the
organization is refused (`scim_invalid_member`), and nothing is saved.

- **Example**: The provider adds Zoe, who belongs to another organization, to a group →
  refused, and the team is unchanged.

### SCIM-R6 · Two teams of an organization cannot have the same name

Creating a group under a name another team has, or renaming one to it, is refused
(`scim_group_conflict`). Sending a team its own name again is not a conflict.

- **Example**: A team named Finance exists. The provider creates a group named Finance →
  refused.

### SCIM-R7 · Deleting a group takes its team off everything it was on, in one step

Projects, folders, documents and conversation queues restricted to the team drop it, as when
an admin deletes the team, and the audit log records the counts. A group that is a team of
another organization is answered as not found, and nothing is changed.

- **Example**: The provider deletes the group behind the Finance team → a project that was
  restricted to Finance and Legal is restricted to Legal alone.

## How a refusal is answered

### SCIM-R8 · A refusal is answered in the error format identity providers read

| Refusal | Status | SCIM error type |
| --- | --- | --- |
| `scim_user_conflict`, `scim_group_conflict` | 409 | `uniqueness` |
| `scim_owner_protected`, `scim_identity_shared` | 403 | `mutability` |
| `scim_invalid_member` | 400 | `invalidValue` |

The answer carries the reason as its detail.

- **Example**: The provider creates a group under a name that is taken → it receives a 409
  with the type `uniqueness` and the reason, which it can show to its administrator.

## Not yet

- **The SCIM token**: who can generate it, that it is shown once, and that every request must
  carry it (`routes.ts`).
- **Creating and reactivating a member**, and the role a reactivated member gets back.
- **Listing, paging and filtering** users and groups, and how the different providers' request
  shapes are read (`core/scim/`).
