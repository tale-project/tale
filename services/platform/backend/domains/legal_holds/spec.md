# Legal holds — who can see the holds, and how a release is slowed down

> **Prefix** `HOLD-` · **Docs** [`admin/governance/legal-hold`](../../../../../docs/en/platform/admin/governance/legal-hold.md)

A legal hold preserves the data of one person or of the whole organization: while it is in
place, that data cannot be deleted. Lifting a hold takes two admins, unless the operator allows
self-approval. These rules cover who can see the holds, and who can approve a release and how
soon. Placing a hold, what a hold blocks, and the rest of the release procedure are not
covered; see Not yet.

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

### HOLD-R3 · Another admin can approve a release only five minutes after it was requested

An approval that comes sooner is refused (`APPROVAL_TOO_SOON`) with the time that is left,
and the hold stays as it is. The wait keeps two admins from requesting and approving a release
in one breath.

- **Example**: Ada requests the release of a hold at 10:00. Noah, another admin, approves it
  at 10:01 → refused, with four minutes left to wait.

### HOLD-R4 · Only another admin can approve a release, unless self-approval is on

The admin who requested a release cannot approve it (`SELF_APPROVAL_BLOCKED`), and the hold
stays as it is. Where the operator turned self-approval on
(`TALE_LEGAL_HOLD_SINGLE_ADMIN_OK=true`), which is meant for an organization with a single
admin but applies to every organization of the deployment, the requester's own approval goes
through at once, without the wait of `HOLD-R3`, and the audit log records it as self-approved.

- **Example**: Ada requests the release of a hold, and approves it herself an hour later →
  refused, and the hold stays.
- **Example**: Ada is her organization's only admin, and the operator turned self-approval on.
  She requests the release of a hold at 10:00 and approves it at 10:01 → approved, and the
  audit log records it as self-approved.

## Not yet

- **Placing a hold**, on a person or on the whole organization, and linking it to a matter
  (`service.ts`).
- **What a hold blocks**: each domain that deletes data refuses on its own; see the
  organizations and products specs for two of them.
- **The rest of the release procedure**: rejecting a request, and the wait after an approval
  before the hold is lifted. The user docs describe them; no test holds them yet.
- **Closing a matter**, which requests the release of its holds.
