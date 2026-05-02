# Tale Permission Model

Tale resources are scoped along **three orthogonal axes**. The axis used for a given resource determines who can read or write it; org roles (owner / admin / developer / editor / member) only govern the **org** axis.

## 1. Org-scoped resources

Most platform configuration: agents, integrations, governance policies, branding, knowledge documents.

- Stored with `organizationId` on the row.
- Read/write gated by `getOrganizationMember` + role mapping (see [convex/auth.ts](../services/platform/convex/auth.ts) `platformRoles`).
- Visibility: every member of the org with the right role can read; admins can manage.
- Cascade: `cascadeOnOrgDeleted` fans out to every per-org table when the org is removed.

## 2. Team-scoped resources

A finer-grained slice for teams within an org: team-bound agents, team knowledge documents, team integration credentials.

- Stored with `organizationId` + `teamId`.
- Read/write gated by `getOrganizationMember` plus a `teamMember` lookup; sharing is opt-in via per-resource fields (e.g. `sharedWithTeamIds`).
- Roles within a team are not first-class — visibility is membership, write rights piggy-back on the org role.

## 3. User-private resources

Per-user data that should not leak to anyone else in the org, **including org admins**: chat threads, custom instructions, memories.

- Stored with `userId` and (where applicable) `organizationId` on the row.
- Read/write gated by `assertSelfAndOrgMember` ([convex/lib/rls/auth/assert_self_and_org_member.ts](../services/platform/convex/lib/rls/auth/assert_self_and_org_member.ts)) — exact-match `userId` plus a current-membership check so a removed-but-still-tokened user can't read stale rows.
- Org admins **cannot** read user-private content via any platform UI, query, audit log, or export. They can see lifecycle counts (the audit log records pseudonymised subject IDs), org-level kill switches (feature flags, governance), and storage quotas — never content.
- Cascade: per-user-private resource has its own hook in [convex/lib/cascades/](../services/platform/convex/lib/cascades/) that runs on member-remove / account-delete / org-delete.

User-private is **a scoping pattern**, not a permission level. Adding "private" to the role enum would be a category error — roles are about what the user can do org-wide; scoping is about who can see a particular row.

## Quick reference

| Resource                                              | Axis            | Reader gate                          |
| ----------------------------------------------------- | --------------- | ------------------------------------ |
| `agentBindings`, `integrations`, `governancePolicies` | org             | `getOrganizationMember`              |
| `documents`, agent knowledge files                    | team / org      | `getOrganizationMember` + team check |
| `threadMetadata`                                      | user (+ shared) | `canAccessThread`                    |
| `userPreferences`, `userMemories`                     | user-private    | `assertSelfAndOrgMember`             |

When adding a new table, decide which axis it belongs to and reuse the existing helper. Mixing axes on the same row (e.g. a memory that's user-private but team-readable) is a compatibility minefield — model it as two rows or two relations instead.
