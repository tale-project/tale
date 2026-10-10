# Users — what an account's password and name are held to

> **Prefix** `USER-` · **Docs** [`admin/members-and-roles`](../../../../../docs/en/platform/admin/members-and-roles.md)

An account belongs to a person and can be a member of several organizations. These rules
cover changing a password, changing a display name, and an admin adding a member with a
password. Signing in, sessions, and the account's notification state are not covered; see Not
yet.

## Changing a password

### USER-R1 · A new password must meet the strictest policy among the person's organizations

Someone who belongs to no organization is held to the built-in policy. A password the
strictest policy refuses is refused, even when the built-in policy would accept it.

- **Example**: One of Mia's organizations asks for 20 characters. She sets a 12-character
  password that the built-in policy would accept → refused.

### USER-R2 · Changing a password needs the current one, unless the password has expired

The exception follows from the account's state alone: it has a password, and that password
has expired or must be changed. A request cannot claim the exception for itself, and an
account that has no password of its own gets none.

- **Example**: Someone holding Mia's open session sets a new password without knowing the
  current one. Her password has not expired → refused.

### USER-R3 · A locked account cannot change its password until the lock ends

A wrong current password is refused (`INVALID_CURRENT_PASSWORD`). Once repeated wrong
passwords have locked the account, the change is refused (`PASSWORD_ATTEMPTS_LOCKED`) with the
seconds to wait.

- **Example**: Mia's account is locked after repeated wrong passwords. She tries to change her
  password → refused, with the time after which she can try again.

### USER-R4 · An expired password cannot be replaced by the same password

The new password must differ from the one the account carries (`password_reused`), and
nothing is saved.

- **Example**: Mia's password has expired. She enters it again as the new one → refused.

### USER-R5 · Once a password is changed, the old one no longer signs in

An account has one password. Setting it replaces the old one wherever the account keeps it;
no second password is left beside the new one.

- **Example**: Ada sets a new password for her account → her old password is refused from
  then on.

## Changing a display name

### USER-R6 · A display name holds up to 100 characters

Spaces around the name are dropped first. A longer name is refused (`too_long`) with a message
that says why, and the name stays as it was.

- **Example**: Mia saves a display name 101 long → refused, and her name is unchanged.

## Adding a member with a password

### USER-R7 · Only owners and admins can add a member to their organization

Anyone else is refused (`FORBIDDEN`) before an account is created or anything is saved.

- **Example**: Mia is a member. She adds a colleague to the organization → refused, and no
  account is created.

### USER-R8 · Someone who is already a member cannot be added again

The request is refused (`DUPLICATE_MEMBER`) and nothing is saved.

- **Example**: Ada adds Noah, who is already in the organization → refused.

### USER-R9 · A person whose password an admin chose must change it at their next sign-in

This holds for an account the admin creates. Someone who already has an account is added with
the password they have, and is not asked to change it. Either way the audit log records who
was added.

- **Example**: Ada adds a new colleague with a temporary password → the colleague signs in
  with it once and is asked to choose their own.

## Not yet

- **Signing in and sessions**, the sign-in lock itself (see the login attempts spec) and
  two-factor authentication.
- **An admin setting another member's password** (`POST /members/:memberId/password` in
  `routes.ts`): who can, and what it does to that member's sessions.
- **When a password expires** (`password-expiry` in `routes.ts`).
- **The account's notification state** and the organization a person last used.
