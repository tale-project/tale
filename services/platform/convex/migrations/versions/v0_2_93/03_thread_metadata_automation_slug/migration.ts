/**
 * DB migration: rename `threadMetadata.appSlug` → `automationSlug` and map
 * install-scoped `subjectType: 'app'` → `'automation'`.
 */

import { defineDbMigration } from '../../../framework/define';

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export const migration = defineDbMigration({
  title: 'Rename threadMetadata app-subject columns to automation naming',
  description:
    'Copies appSlug→automationSlug on app_discussion rows and rewrites ' +
    "install-scoped subjectType 'app' to 'automation'. Reversible.",
  destructive: false,
  snapshot: 'none',
  subjects: { tables: ['threadMetadata'] },
  table: 'threadMetadata',

  async up(ctx, doc) {
    const legacySlug = str((doc as Record<string, unknown>).appSlug);
    const legacyType = str(doc.subjectType);
    const needsSlug =
      legacySlug !== undefined && doc.automationSlug === undefined;
    const needsType = legacyType === 'app' && doc.subjectType !== 'automation';
    if (!needsSlug && !needsType) return;
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy field absent from schema
    await (ctx.db as any).patch(doc._id, {
      ...(needsSlug ? { automationSlug: legacySlug, appSlug: undefined } : {}),
      ...(needsType ? { subjectType: 'automation' } : {}),
    });
  },

  async down(ctx, doc) {
    if (doc.automationSlug === undefined && doc.subjectType !== 'automation') {
      return;
    }
    const automationSlug = str(doc.automationSlug);
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy field absent from schema
    await (ctx.db as any).patch(doc._id, {
      ...(automationSlug !== undefined
        ? { appSlug: automationSlug, automationSlug: undefined }
        : {}),
      ...(doc.subjectType === 'automation' ? { subjectType: 'app' } : {}),
    });
  },
});
