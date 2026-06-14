import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.73 / 02 — split `userPreferences.enabled` into
 * `customInstructionsEnabled` + `memoriesEnabled`.
 *
 * Shipped in v0.2.73 (verified against `git diff v0.2.72 v0.2.73 --
 * convex/user_preferences/schema.ts`): the single tri-state `enabled` toggle
 * was replaced by two independently-gated tri-state toggles, one per feature
 * (custom instructions, user memories). The schema kept `enabled` as an
 * optional legacy slot for the deploy window
 * (`migrations/split_personalization_toggle` drains it) — exactly the shape a
 * reference migration encodes.
 *
 * up: set both `customInstructionsEnabled` and `memoriesEnabled` to the old
 * `enabled` value, then unset `enabled`.
 * down: set `enabled = customInstructionsEnabled || memoriesEnabled` (OR-fold —
 * "on if either feature was on"), then unset both `*Enabled` fields.
 *
 * Fully reversible (the OR-fold round-trips for the values produced by `up`,
 * where both toggles are equal). Reference-only: the runner never executes it.
 */
export const meta: MigrationMeta = {
  id: '0.2.73/02_personalization_split',
  semver: '0.2.73',
  numericId: 2,
  slug: 'personalization_split',
  title: 'Split userPreferences.enabled into per-feature toggles',
  description:
    'Splits the single userPreferences.enabled tri-state toggle into ' +
    'customInstructionsEnabled + memoriesEnabled. up sets both to the old ' +
    'enabled value and unsets enabled; down sets enabled = ' +
    'customInstructionsEnabled || memoriesEnabled and unsets both. Reversible, ' +
    'no data loss.',
  kind: 'reference',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
