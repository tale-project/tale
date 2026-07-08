import type { Id } from '../../../../_generated/dataModel';
import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

export const migration: DbMigration = {
  meta,
  table: 'threadMetadata',

  async up(ctx: MutationCtx, doc: MigrationDoc) {
    if (doc.kind !== 'app_discussion') return;
    await ctx.db.patch(doc._id as Id<'threadMetadata'>, {
      kind: 'automation_discussion',
    });
  },

  async down(ctx: MutationCtx, doc: MigrationDoc) {
    if (doc.kind !== 'automation_discussion') return;
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy kind literal absent from schema
    await (ctx.db as any).patch(doc._id, {
      kind: 'app_discussion',
    });
  },
};
