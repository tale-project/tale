import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Per-user, per-org personalization preferences: an `enabled` kill switch
 * and free-form `customInstructions` text prepended to every chat's system
 * prompt when enabled.
 *
 * Scope is `(userId, organizationId)`: the same human gets a separate row
 * for every org they belong to. This is the user-private scoping pattern,
 * orthogonal to org roles — admins cannot read another user's row.
 *
 * Default is OFF: `enabled === true` is the only path that turns on
 * memory injection and the propose_memory tool. A missing row is
 * equivalent to `enabled: false`.
 */
export const userPreferencesTable = defineTable({
  userId: v.string(),
  organizationId: v.string(),
  customInstructions: v.string(),
  enabled: v.boolean(),
  updatedAt: v.number(),
})
  .index('by_userId_organizationId', ['userId', 'organizationId'])
  .index('by_organizationId', ['organizationId']);
