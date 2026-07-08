import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

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

export const migration: DbMigration = {
  meta,
  table: LEGACY_TABLE,

  async up(ctx: MutationCtx, doc: MigrationDoc) {
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

  async down(ctx: MutationCtx, doc: MigrationDoc) {
    const keys = bindingKey(doc);
    if (!keys) return;
    const payload = payloadWithoutSystemFields(doc);
    normalizeBindingPayload(payload);

    // oxlint-disable-next-line typescript/no-explicit-any -- legacy/target tables
    const db = ctx.db as any;
    const existingLegacy = await db
      .query(LEGACY_TABLE)
      .withIndex('by_org_slug_project', (q: any) =>
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
};
