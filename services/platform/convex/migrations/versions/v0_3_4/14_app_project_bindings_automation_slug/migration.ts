/** DB migration: rename `appProjectBindings.appSlug` → `automationSlug`. */

import { defineDbMigration } from '../../../framework/define';

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export const migration = defineDbMigration({
  title: 'Rename appProjectBindings.appSlug to automationSlug',
  description:
    'Copies appSlug→automationSlug on every appProjectBindings row and clears ' +
    'the legacy field. Reversible. Runs on deploy before new code reads the ' +
    'recolumned by_org_slug_project index.',
  destructive: false,
  snapshot: 'none',
  formerIds: ['0.2.93/02_app_project_bindings_automation_slug'],
  subjects: { tables: ['appProjectBindings'] },
  table: 'appProjectBindings',

  async up(ctx, doc) {
    const legacySlug = str((doc as Record<string, unknown>).appSlug);
    if (legacySlug === undefined) return;
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy field absent from schema
    await (ctx.db as any).patch(doc._id, {
      automationSlug: legacySlug,
      appSlug: undefined,
    });
  },

  async down(ctx, doc) {
    if (doc.automationSlug === undefined) return;
    const automationSlug = str(doc.automationSlug);
    if (automationSlug === undefined) return;
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy field absent from schema
    await (ctx.db as any).patch(doc._id, {
      appSlug: automationSlug,
      automationSlug: undefined,
    });
  },
});
