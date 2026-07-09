/**
 * Reference migration: optional `taskActivity.context` for workflow attribution.
 */

import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

export const migration: DbMigration = {
  meta,
  table: 'taskActivity',

  async up(_ctx: MutationCtx, _doc: MigrationDoc) {
    // No-op: optional field — existing rows stay valid without `context`.
  },

  async down(ctx: MutationCtx, doc: MigrationDoc) {
    if (doc.context === undefined) return;
    // oxlint-disable-next-line typescript/no-explicit-any -- dropped optional field
    await (ctx.db as any).patch(doc._id, { context: undefined });
  },
};
