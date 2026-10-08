# Members — who can change a member's role, remove a member, or reset their sign-in

> **Prefix** `MEMBER-` · **Docs** [`admin/members-and-roles`](../../../../../docs/en/platform/admin/members-and-roles.md)

A member is a person's seat in an organization, with one role. These rules cover who can
change a role or remove a member, which roles are protected, what removing a passkey or
two-factor authentication does, and which role the app works with. Transferring ownership,
disabling a member and what a removal takes with it are not covered; see Not yet.

## Changing a role and removing a member

### MEMBER-R1 · Only owners and admins can change a member's role or remove a member

Every other role is refused (`MEMBER_ROLE_UPDATE_FORBIDDEN`, `MEMBER_REMOVE_FORBIDDEN`), and
so is someone who is not in the organization. Nothing is changed.

- **Example**: Noah has the developer role. He makes Mia an editor → refused, and Mia's role
  stays.

### MEMBER-R2 · The Owner role is never given or taken away by a role change

An owner's role cannot be changed, by another owner either (`MEMBER_OWNER_ROLE_IMMUTABLE`),
and no one can be made an owner through the role picker
(`MEMBER_OWNER_ROLE_ASSIGN_FORBIDDEN`).

- **Example**: Ada, an owner, sets Noah's role to Owner → refused.

### MEMBER-R3 · The role of the person who created the organization cannot be changed

(`MEMBER_CREATOR_ROLE_IMMUTABLE`)

- **Example**: Ada created the organization and is an admin of it. An owner makes her a member
  → refused, and Ada stays an admin.

### MEMBER-R4 · The last owner or admin cannot be demoted

An organization always keeps at least one person who can administer it (`MEMBER_LAST_ADMIN`).

- **Example**: Ada is the only admin and there is no other owner. She is set to Member →
  refused.

### MEMBER-R5 · An owner cannot be removed, and nobody can remove themselves

Removing an owner is refused (`MEMBER_OWNER_REMOVAL_FORBIDDEN`). An admin who removes their own
membership is refused too (`MEMBER_SELF_REMOVAL_FORBIDDEN`).

- **Example**: Ada, an admin, removes her own membership → refused.

## Removing a member's sign-in factor

### MEMBER-R6 · Only owners and admins can revoke a passkey or reset two-factor authentication

Anyone else is refused (`FORBIDDEN`) and nothing is changed.

- **Example**: Mia is a member. She revokes Noah's passkey → refused.

### MEMBER-R7 · An admin cannot reset an owner's two-factor authentication

(`FORBIDDEN`)

- **Example**: Noah is an admin. He resets the two-factor authentication of Ada, an owner →
  refused.

### MEMBER-R8 · Revoking a passkey or resetting two-factor authentication signs the member out

The factor is removed, every session of the member is ended, and the action is written to the
audit log, all in one step: when the audit entry cannot be written, nothing is changed.

- **Example**: Ada resets Mia's two-factor authentication → Mia is signed out on every device
  and sets it up again at her next sign-in.

## The role a person acts with

### MEMBER-R9 · A sign-in that sets a role decides the role the person acts with

Normally a person acts with the role of their seat. When they arrive through a sign-in that
sets a role for the session, such as an authenticating proxy, the app is told that role
instead. It never makes a member of someone who has no seat in the organization.

- **Example**: Mia's seat is Member. Her company's proxy signs her in as Admin → the app shows
  her what an admin sees.

## Not yet

- **Transferring ownership**, and disabling a member without removing them (`service.ts`).
- **What removing a member takes with it**, and the refusal while the member or the
  organization is under a legal hold.
- **Changing a member's display name** and listing a member's passkeys.
- **Undecided: can an admin change their own role?** The user docs say "You cannot edit your
  own role through this menu" (`docs/en/platform/admin/members-and-roles.md`). The server has
  no such check: a role change an admin sends for their own seat is held only to the rules
  above (`updateMemberRole` in `service.ts`). Either the menu hides an action the server
  allows on purpose, or the server is missing the rule.
