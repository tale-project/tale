/**
 * Reference migration: rename `appInstallations.appSlug` → `automationSlug` and
 * `appName` → `automationName`.
 */

import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export const migration: DbMigration = {
  meta,
  table: 'appInstallations',

  async up(ctx: MutationCtx, doc: MigrationDoc) {
    const legacySlug = str((doc as Record<string, unknown>).appSlug);
    if (legacySlug === undefined) return;
    const legacyName = str((doc as Record<string, unknown>).appName);
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy fields absent from schema
    await (ctx.db as any).patch(doc._id, {
      automationSlug: legacySlug,
      appSlug: undefined,
      ...(legacyName !== undefined
        ? { automationName: legacyName, appName: undefined }
        : {}),
    });
  },

  async down(ctx: MutationCtx, doc: MigrationDoc) {
    if (doc.automationSlug === undefined) return;
    const automationSlug = str(doc.automationSlug);
    if (automationSlug === undefined) return;
    const automationName = str(doc.automationName);
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy fields absent from schema
    await (ctx.db as any).patch(doc._id, {
      appSlug: automationSlug,
      automationSlug: undefined,
      ...(automationName !== undefined
        ? { appName: automationName, automationName: undefined }
        : {}),
    });
  },
};
