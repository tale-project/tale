/**
 * DB migration: rename `appInstallations.appSlug` → `automationSlug` and
 * `appName` → `automationName`.
 *
 * Part of the 0.2.93 apps→automations rename: `appSlug`/`appName` →
 * `automationSlug`/`automationName` on automation install tables, optional
 * ownership columns on agent/workflow install rows, and
 * `threadMetadata.automationSlug` (+ install-scoped `subjectType: 'app'` →
 * `'automation'`).
 *
 * Shipped with the Phase-R schema recolumn: indexes `by_org_slug` /
 * `by_org_slug_project` / `by_org_automation_subject` now key on
 * `automationSlug`. Pure field rename — fully reversible, no information lost.
 */

import { defineDbMigration } from '../../../framework/define';

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export const migration = defineDbMigration({
  title: 'Rename appSlug/appName to automationSlug/automationName',
  description:
    'Renames appSlug→automationSlug and appName→automationName on ' +
    'appInstallations. Runs on deploy before new code reads the recolumned ' +
    'by_org_slug index. Reversible.',
  destructive: false,
  snapshot: 'none',
  formerIds: ['0.2.93/01_automation_slug_fields'],
  subjects: { tables: ['appInstallations'] },
  table: 'appInstallations',

  async up(ctx, doc) {
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

  async down(ctx, doc) {
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
});
