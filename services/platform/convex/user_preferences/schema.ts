import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Per-user, per-org personalization preferences: a tri-state `enabled`
 * override and free-form `customInstructions` text prepended to every
 * chat's system prompt when active.
 *
 * Scope is `(userId, organizationId)`: the same human gets a separate row
 * for every org they belong to. This is the user-private scoping pattern,
 * orthogonal to org roles — admins cannot read another user's row.
 *
 * `enabled` is tri-state:
 *  - `undefined` (or row missing) → follow the org default (`policyType:
 *    'personalization'` row in `governancePolicies`).
 *  - `true` / `false`             → user has explicitly opted in/out;
 *    overrides the org default.
 *
 * System default is OFF: when both the org default is missing and the
 * user has not opted in, personalization stays off.
 */
export const userPreferencesTable = defineTable({
  userId: v.string(),
  organizationId: v.string(),
  customInstructions: v.string(),
  enabled: v.optional(v.boolean()),
  /**
   * Global default for voice-mode TTS output on new conversations.
   * `undefined` (or row missing) → off. Per-thread override lives on
   * `threadMetadata.voiceOutputOverride`.
   */
  voiceOutput: v.optional(v.boolean()),
  updatedAt: v.number(),
})
  .index('by_userId_organizationId', ['userId', 'organizationId'])
  .index('by_organizationId', ['organizationId']);
