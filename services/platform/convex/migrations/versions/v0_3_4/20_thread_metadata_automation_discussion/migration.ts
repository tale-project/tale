/**
 * DB migration: rename the `threadMetadata.kind` literal `app_discussion` →
 * `automation_discussion`.
 */

import type { Id } from '../../../../_generated/dataModel';
import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title:
    "Rename threadMetadata kind 'app_discussion' to 'automation_discussion'",
  description:
    "Rewrites kind: 'app_discussion' → 'automation_discussion' on threadMetadata " +
    'rows. Reversible.',
  destructive: false,
  snapshot: 'none',
  formerIds: ['0.2.93/08_thread_metadata_automation_discussion'],
  subjects: { tables: ['threadMetadata'] },
  table: 'threadMetadata',

  async up(ctx, doc) {
    if (doc.kind !== 'app_discussion') return;
    await ctx.db.patch(doc._id as Id<'threadMetadata'>, {
      kind: 'automation_discussion',
    });
  },

  async down(ctx, doc) {
    if (doc.kind !== 'automation_discussion') return;
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy kind literal absent from schema
    await (ctx.db as any).patch(doc._id, {
      kind: 'app_discussion',
    });
  },
});
