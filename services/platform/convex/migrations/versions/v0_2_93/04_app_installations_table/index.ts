import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

const LEGACY_TABLE = 'appInstallations';
const TARGET_TABLE = 'automationInstallations';

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

function orgSlug(doc: MigrationDoc): { org: string; slug: string } | null {
  const org = str(doc.organizationId);
  const slug =
    str(doc.automationSlug) ?? str((doc as Record<string, unknown>).appSlug);
  if (org === undefined || slug === undefined) return null;
  return { org, slug };
}

function normalizeInstallPayload(payload: Record<string, unknown>): void {
  const legacySlug = str(payload.appSlug);
  if (legacySlug !== undefined && payload.automationSlug === undefined) {
    payload.automationSlug = legacySlug;
  }
  delete payload.appSlug;
  const legacyName = str(payload.appName);
  if (legacyName !== undefined && payload.automationName === undefined) {
    payload.automationName = legacyName;
  }
  delete payload.appName;
}

export const migration: DbMigration = {
  meta,
  table: LEGACY_TABLE,

  async up(ctx: MutationCtx, doc: MigrationDoc) {
    const keys = orgSlug(doc);
    if (!keys) return;
    const payload = payloadWithoutSystemFields(doc);
    normalizeInstallPayload(payload);

    // oxlint-disable-next-line typescript/no-explicit-any -- legacy/target tables
    const db = ctx.db as any;
    const existing = await db
      .query(TARGET_TABLE)
      .withIndex('by_org_slug', (q: any) =>
        q.eq('organizationId', keys.org).eq('automationSlug', keys.slug),
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
    const keys = orgSlug(doc);
    if (!keys) return;
    const payload = payloadWithoutSystemFields(doc);
    normalizeInstallPayload(payload);

    // oxlint-disable-next-line typescript/no-explicit-any -- legacy/target tables
    const db = ctx.db as any;
    const existingLegacy = await db
      .query(LEGACY_TABLE)
      .withIndex('by_org_slug', (q: any) =>
        q.eq('organizationId', keys.org).eq('automationSlug', keys.slug),
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
