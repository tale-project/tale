import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * External author identities — users that originate outside Better Auth.
 *
 * A chat thread's owner is `threadMetadata.userId`. For normal chats it's a
 * Better Auth user id; for messages that come in from an external surface (e.g.
 * a Slack workspace) there is no Tale user, but we still want to preserve and
 * display the author rather than collapsing everything to the `'system'`
 * sentinel.
 *
 * Convention: such threads are owned by an org-scoped namespaced id
 * `"<source>:<organizationId>:<externalId>"` (e.g. `"slack:org_42:U07ABC123"`).
 * The organization is part of the key so the same external user id in two
 * workspaces connected to two different orgs maps to two isolated rows — one
 * org's display name can never bleed into another's. This table maps that
 * `ownerId` to a resolvable display name so the owner→name resolution sites
 * (`resolve_template_variables.fetchUser`, `documents.getUserNamesBatch`) can
 * render the real author without hitting the Better Auth adapter (which throws
 * on non-Convex-id strings).
 *
 * Generic by design: new external sources (email, Teams, …) reuse it.
 */
export const externalIdentitiesTable = defineTable({
  // The org-scoped thread-owner value, e.g. `"slack:org_42:U07ABC123"`.
  // Globally unique (the org segment guarantees cross-org isolation).
  ownerId: v.string(),
  source: v.union(v.literal('slack')),
  organizationId: v.string(),
  // Source-native id (e.g. Slack user id), without the namespace prefix.
  externalUserId: v.string(),
  displayName: v.optional(v.string()),
  handle: v.optional(v.string()),
  avatarUrl: v.optional(v.string()),
  updatedAt: v.number(),
}).index('by_ownerId', ['ownerId']);
