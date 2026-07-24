import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Per-user, per-org personalization preferences. Two independently
 * gated features share this row:
 *  - `customInstructions` — free-form text prepended to every chat's
 *    system prompt when `customInstructionsEnabled` resolves true.
 *  - `userMemories` (separate table) — injected and proposable when
 *    `memoriesEnabled` resolves true.
 *
 * Scope is `(userId, organizationId)`: the same human gets a separate
 * row for every org they belong to. This is the user-private scoping
 * pattern, orthogonal to org roles — admins cannot read another user's
 * row.
 *
 * Each *Enabled field is tri-state:
 *  - `undefined` (or row missing) → follow the matching org default
 *    (`custom_instructions` / `user_memories` policy rows in
 *    `governancePolicies`).
 *  - `true` / `false`             → user has explicitly opted in/out;
 *    overrides the org default for THAT feature only.
 *
 * System default is OFF: when both the org default is missing and the
 * user has not opted in, that feature stays off.
 */
export const userPreferencesTable = defineTable({
  userId: v.string(),
  organizationId: v.string(),
  customInstructions: v.string(),
  customInstructionsEnabled: v.optional(v.boolean()),
  memoriesEnabled: v.optional(v.boolean()),
  /**
   * Global default for voice-mode TTS output on new conversations.
   * `undefined` (or row missing) → off. Per-thread override lives on
   * `threadMetadata.voiceOutputOverride`.
   */
  voiceOutput: v.optional(v.boolean()),
  /**
   * The chat composer's sticky model pick for the platform agent — set on an
   * explicit pick, read to seed new conversations. `undefined` (or row
   * missing) → the composer seeds its own default from the model listing.
   * Deliberately per-user, not per-thread (a per-thread override may come
   * later).
   */
  chatModelId: v.optional(v.string()),
  /**
   * Whether this user has finished the onboarding wizard for this org.
   * `undefined` / row missing → not yet completed. Drives the "what's next"
   * checklist and avoids re-nagging; we never force re-entry into the wizard.
   */
  onboardingCompleted: v.optional(v.boolean()),
  updatedAt: v.number(),
})
  .index('by_userId_organizationId', ['userId', 'organizationId'])
  .index('by_organizationId', ['organizationId']);
