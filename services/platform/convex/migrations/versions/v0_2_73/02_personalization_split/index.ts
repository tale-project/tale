/**
 * Reference migration: split `userPreferences.enabled` →
 * `customInstructionsEnabled` + `memoriesEnabled`.
 *
 * Per-row, idempotent, shape-guarded. `up` fans the single toggle out to both
 * feature toggles; `down` OR-folds them back. The runner never executes a
 * `reference` migration; the test calls `up`/`down` directly.
 */

import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export const migration: DbMigration = {
  meta,
  table: 'userPreferences',

  async up(ctx: MutationCtx, doc: MigrationDoc) {
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

  async down(ctx: MutationCtx, doc: MigrationDoc) {
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
};
