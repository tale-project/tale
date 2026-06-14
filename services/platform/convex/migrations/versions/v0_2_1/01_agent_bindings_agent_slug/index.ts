/**
 * Reference migration: rename `agentBindings.agentFileName` → `agentSlug`.
 *
 * Per-row, idempotent, shape-guarded so a re-run is a no-op. The runner never
 * executes a `reference` migration (it cannot be replayed against today's
 * schema); this transform exists so the documented history stays under
 * round-trip test. The test calls `up`/`down` directly.
 */

import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export const migration: DbMigration = {
  meta,
  table: 'agentBindings',

  async up(ctx: MutationCtx, doc: MigrationDoc) {
    // Already migrated (has agentSlug, no agentFileName) → no-op.
    if (doc.agentFileName === undefined) return;
    const agentFileName = str(doc.agentFileName);
    if (agentFileName === undefined) return;
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy field absent from schema
    await (ctx.db as any).patch(doc._id, {
      agentSlug: agentFileName,
      agentFileName: undefined,
    });
  },

  async down(ctx: MutationCtx, doc: MigrationDoc) {
    if (doc.agentSlug === undefined) return;
    const agentSlug = str(doc.agentSlug);
    if (agentSlug === undefined) return;
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy field absent from schema
    await (ctx.db as any).patch(doc._id, {
      agentFileName: agentSlug,
      agentSlug: undefined,
    });
  },
};
