/**
 * Reference migration: better-auth `apikey.userId` → `referenceId`
 * (+ unset/restore `configId`).
 *
 * Per-row, idempotent, shape-guarded. `up` moves `userId` into `referenceId`
 * (leaving `configId` undefined); `down` moves `referenceId` back into
 * `userId` and clears `referenceId` + `configId`. The runner never executes a
 * `reference` migration; the test calls `up`/`down` directly.
 */

import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export const migration: DbMigration = {
  meta,
  table: 'apikey',

  async up(ctx: MutationCtx, doc: MigrationDoc) {
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

  async down(ctx: MutationCtx, doc: MigrationDoc) {
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
};
