/**
 * 0.2.48 / 01 — better-auth 1.5 `apikey.userId` → `referenceId` (+ new
 * `configId`).
 *
 * NOTE — diff differs from the brief: `git diff v0.2.47 v0.2.48 --
 * convex/betterAuth/schema.ts` shows the v0.2.48 change was a SCHEMA
 * RELAXATION, not an in-place rename. better-auth 1.5 renamed the column
 * `userId` → `referenceId` and added a required `configId`; rather than
 * rewrite existing rows at that release, the schema was patched to make
 * `configId` / `referenceId` / `userId` all OPTIONAL so pre-1.5 rows keep
 * validating (the schema comment says "Remove once a migration backfills the
 * new fields"). This reference migration captures that deferred backfill: the
 * data transform that moves `userId` → `referenceId`.
 *
 * Pure rename of an identity reference — fully reversible, no data lost
 * (`configId` has no pre-1.5 source, so it is left undefined and dropped on
 * down). Reference-only: the per-row transform is idempotent and
 * shape-guarded and stays under round-trip test for the audit trail; the
 * runner never executes it — the test calls `up`/`down` directly.
 */

import { defineReferenceMigration } from '../../../framework/define';

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export const migration = defineReferenceMigration({
  title: 'Backfill better-auth apikey.userId into referenceId',
  description:
    'better-auth 1.5 renamed apikey.userId to referenceId and added configId. ' +
    'The v0.2.48 schema change relaxed all three to optional (deferring the ' +
    'backfill); this migration is that backfill. up sets referenceId=userId, ' +
    'leaves configId undefined, unsets userId; down sets userId=referenceId and ' +
    'unsets referenceId+configId. Reversible, no data loss.',
  destructive: false,
  snapshot: 'none',
  table: 'apikey',

  async up(ctx, doc) {
    // Already migrated (referenceId set, userId cleared) → no-op.
    if (doc.userId === undefined) return;
    const userId = str(doc.userId);
    if (userId === undefined) return;
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy field shape
    await (ctx.db as any).patch(doc._id, {
      referenceId: userId,
      userId: undefined,
    });
  },

  async down(ctx, doc) {
    // Already reverted (userId set) → no-op.
    if (doc.userId !== undefined) return;
    const referenceId = str(doc.referenceId);
    if (referenceId === undefined) return;
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy field shape
    await (ctx.db as any).patch(doc._id, {
      userId: referenceId,
      referenceId: undefined,
      configId: undefined,
    });
  },
});
