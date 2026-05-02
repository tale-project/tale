# ADR 0001 — User-private scoping for Personalization & Memory

## Status

Accepted, 2026-05-02. Implemented in branch `feat/personalization-memory-v1`.

## Context

The Personalization & Memory feature stores per-user data (Custom Instructions, cross-thread memories) that must be invisible to other users in the same org, including org admins. The natural question: do we add a "private" level to the existing org-role enum (owner / admin / developer / editor / member), or model this differently?

## Decision

**Do not extend the role enum. Add user-private as a third scoping axis alongside the existing org-scoped and team-scoped patterns.**

The existing role system is the org-internal **action-permissions** axis: who can manage agents, who can change governance, etc. User-private is the **resource-ownership / visibility** axis: who can read this particular row. They are orthogonal.

`threadMetadata` already implements this pattern: `userId === authUser.userId` gating in `can_access_thread.ts` is independent of the user's role within the org. Personalization tables (`userPreferences`, `userMemories`, `userMemoryAuditLog`) follow the same pattern with a composite `(userId, organizationId)` key.

## Consequences

- All public read/write surfaces use `assertSelfAndOrgMember` — exact `userId` match plus a live `member` lookup so a removed-but-still-tokened user cannot read stale rows.
- Org admins have no path to read personalization content. They can:
  - Toggle the org-wide feature flag (governance feature_flags policy).
  - See pseudonymised audit-log counts and timestamps (subject ID is HMAC'd with a server-side pepper).
  - Run cascade-deletion via member removal or org deletion.
- Cascade hooks live in `lib/cascades/personalization_cascade.ts`. Lifecycle authorities (member removal, org deletion, account deletion) call the appropriate hook. The hooks hard-delete; lazy cleanup is for storage hygiene, not GDPR Art 17 erasure.
- Documentation (`docs/permission_model.md`) presents the three axes side-by-side so future tables pick correctly.

## Alternatives considered

- **Extend role enum with `private`**: Rejected. Roles are about actions; "private" is about row ownership. Mixing them confuses consumers and forces every existing role check to handle a value that doesn't fit the action vocabulary.
- **Make all user-private resources team-scoped with implicit team-of-one**: Rejected. Encodes a non-existent team and complicates `member` lookups.
- **Use Convex Ents private-row decorators**: Rejected. Adds a new abstraction for one feature when the existing thread pattern already works.
