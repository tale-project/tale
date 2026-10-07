# Legal holds — who can see the holds, and how a release is slowed down

> **Prefix** `HOLD-` · **Docs** [`admin/governance/legal-hold`](../../../../../docs/en/platform/admin/governance/legal-hold.md)

A legal hold preserves the data of one person or of the whole organization: while it is in
place, that data cannot be deleted. Lifting a hold takes two admins. These rules cover who can
see the holds and how soon a release can be approved. Placing a hold, what a hold blocks, and
most of the release procedure are not covered; see Not yet.

## Who can see the holds

### HOLD-R1 · Only owners and admins can see the list of legal holds

A member is refused (`FORBIDDEN`).

- **Example**: Mia is a member. She opens the legal hold page → refused.

### HOLD-R2 · Every member can see that something is under a hold

The app shows a mark on what is held, so a member is not surprised when a delete is refused.
That mark is readable by every member, without the list behind it.

- **Example**: One of Mia's chats is under a hold. She opens her chats → that chat is marked
  as held.

## Releasing a hold

### HOLD-R3 · A release cannot be approved in the first five minutes after it was requested

An approval that comes sooner is refused (`APPROVAL_TOO_SOON`) with the time that is left,
and the hold stays as it is. The wait keeps two admins from requesting and approving a release
in one breath.

- **Example**: Ada requests the release of a hold at 10:00. Noah, another admin, approves it
  at 10:01 → refused, with four minutes left to wait.

## Not yet

- **Placing a hold**, on a person or on the whole organization, and linking it to a matter
  (`service.ts`).
- **What a hold blocks**: each domain that deletes data refuses on its own; see the
  organizations and products specs for two of them.
- **The rest of the release procedure**: that the admin who requested a release cannot
  approve it, rejecting a request, and the wait after an approval before the hold is lifted.
  The user docs describe them; no test holds them yet.
- **Closing a matter**, which requests the release of its holds.
