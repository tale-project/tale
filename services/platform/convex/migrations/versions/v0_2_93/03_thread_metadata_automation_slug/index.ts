import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export const migration: DbMigration = {
  meta,
  table: 'threadMetadata',

  async up(ctx: MutationCtx, doc: MigrationDoc) {
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

  async down(ctx: MutationCtx, doc: MigrationDoc) {
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
};
