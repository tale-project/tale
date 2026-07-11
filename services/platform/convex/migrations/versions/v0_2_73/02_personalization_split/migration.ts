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
 * up fans the single toggle out to both feature toggles; down OR-folds them
 * back ("on if either feature was on"). Fully reversible (the OR-fold
 * round-trips for the values produced by `up`, where both toggles are equal).
 * The per-row transform is idempotent and shape-guarded. Reference-only: the
 * runner never executes it — the test calls `up`/`down` directly.
 */

import { defineReferenceMigration } from '../../../framework/define';

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export const migration = defineReferenceMigration({
  title: 'Split userPreferences.enabled into per-feature toggles',
  description:
    'Splits the single userPreferences.enabled tri-state toggle into ' +
    'customInstructionsEnabled + memoriesEnabled. up sets both to the old ' +
    'enabled value and unsets enabled; down sets enabled = ' +
    'customInstructionsEnabled || memoriesEnabled and unsets both. Reversible, ' +
    'no data loss.',
  destructive: false,
  snapshot: 'none',
  table: 'userPreferences',

  async up(ctx, doc) {
    // Already migrated (enabled drained) → no-op.
    if (doc.enabled === undefined) return;
    const enabled = bool(doc.enabled);
    if (enabled === undefined) return;
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy field
    await (ctx.db as any).patch(doc._id, {
      customInstructionsEnabled: enabled,
      memoriesEnabled: enabled,
      enabled: undefined,
    });
  },

  async down(ctx, doc) {
    // Already reverted (enabled present) → no-op.
    if (doc.enabled !== undefined) return;
    const ci = bool(doc.customInstructionsEnabled);
    const mem = bool(doc.memoriesEnabled);
    if (ci === undefined && mem === undefined) return; // nothing to fold
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy field
    await (ctx.db as any).patch(doc._id, {
      enabled: Boolean(ci) || Boolean(mem),
      customInstructionsEnabled: undefined,
      memoriesEnabled: undefined,
    });
  },
});
