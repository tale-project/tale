/** DB migration: move `appProjectBindings` → `automationProjectBindings`. */

import { defineDbMigration } from '../../../framework/define';
import type { MigrationDoc } from '../../../framework/types';

const LEGACY_TABLE = 'appProjectBindings';
const TARGET_TABLE = 'automationProjectBindings';

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function payloadWithoutSystemFields(
  doc: MigrationDoc,
): Record<string, unknown> {
  const payload = { ...(doc as Record<string, unknown>) };
  delete payload._id;
  delete payload._creationTime;
  return payload;
}

function bindingKey(
  doc: MigrationDoc,
): { org: string; slug: string; projectId: string } | null {
  const org = str(doc.organizationId);
  const slug =
    str(doc.automationSlug) ?? str((doc as Record<string, unknown>).appSlug);
  const projectId = str(doc.projectId);
  if (org === undefined || slug === undefined || projectId === undefined)
    return null;
  return { org, slug, projectId };
}

function normalizeBindingPayload(payload: Record<string, unknown>): void {
  const legacySlug = str(payload.appSlug);
  if (legacySlug !== undefined && payload.automationSlug === undefined) {
    payload.automationSlug = legacySlug;
  }
  delete payload.appSlug;
}

export const migration = defineDbMigration({
  title: 'Rename appProjectBindings table to automationProjectBindings',
  description:
    'Copies each appProjectBindings row into automationProjectBindings and ' +
    'deletes the legacy row. Idempotent.',
  destructive: false,
  snapshot: 'none',
  formerIds: ['0.2.93/05_app_project_bindings_table'],
  subjects: { tables: ['appProjectBindings', 'automationProjectBindings'] },
  table: LEGACY_TABLE,
  // up MOVES rows: down must walk the populated target table, not the
  // then-empty legacy one (it would silently restore nothing).
  downTable: TARGET_TABLE,

  async up(ctx, doc) {
    const keys = bindingKey(doc);
    if (!keys) return;
    const payload = payloadWithoutSystemFields(doc);
    normalizeBindingPayload(payload);

    // oxlint-disable-next-line typescript/no-explicit-any -- legacy/target tables
    const db = ctx.db as any;
    const existing = await db
      .query(TARGET_TABLE)
      .withIndex('by_org_slug_project', (q: any) =>
        q
          .eq('organizationId', keys.org)
          .eq('automationSlug', keys.slug)
          .eq('projectId', keys.projectId),
      )
      .first();
    if (existing) {
      await db.delete(doc._id);
      return;
    }
    await db.insert(TARGET_TABLE, payload);
    await db.delete(doc._id);
  },

  async down(ctx, doc) {
    const keys = bindingKey(doc);
    if (!keys) return;
    const payload = payloadWithoutSystemFields(doc);
    normalizeBindingPayload(payload);

    // oxlint-disable-next-line typescript/no-explicit-any -- legacy/target tables
    const db = ctx.db as any;
    // `by_org_automation_slug_project` (not the historical
    // `by_org_slug_project`): the world schema keeps that name at its
    // 0.2.88-era field list ['organizationId','appSlug','projectId'], so the
    // automationSlug lookup lives under its own name. Same fields, same
    // semantics.
    const existingLegacy = await db
      .query(LEGACY_TABLE)
      .withIndex('by_org_automation_slug_project', (q: any) =>
        q
          .eq('organizationId', keys.org)
          .eq('automationSlug', keys.slug)
          .eq('projectId', keys.projectId),
      )
      .first();
    if (existingLegacy) {
      await db.delete(doc._id);
      return;
    }
    await db.insert(LEGACY_TABLE, payload);
    await db.delete(doc._id);
  },
});
