/**
 * DB migration: move rows from legacy `appInstallations` into
 * `automationInstallations` and delete the legacy row.
 *
 * Runs after 01–03 field renames. Idempotent: a row already present in the
 * target table causes the legacy row to be dropped without re-inserting.
 */

import { defineDbMigration } from '../../../framework/define';
import type { MigrationDoc } from '../../../framework/types';

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

export const migration = defineDbMigration({
  title: 'Rename appInstallations table to automationInstallations',
  description:
    'Copies each appInstallations row into automationInstallations and deletes ' +
    'the legacy row. Reversible via down (tests call down on target rows).',
  destructive: false,
  snapshot: 'none',
  formerIds: ['0.2.93/04_app_installations_table'],
  subjects: { tables: ['appInstallations', 'automationInstallations'] },
  table: LEGACY_TABLE,
  // up MOVES rows: down must walk the populated target table, not the
  // then-empty legacy one (it would silently restore nothing).
  downTable: TARGET_TABLE,

  async up(ctx, doc) {
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

  async down(ctx, doc) {
    const keys = orgSlug(doc);
    if (!keys) return;
    const payload = payloadWithoutSystemFields(doc);
    normalizeInstallPayload(payload);

    // oxlint-disable-next-line typescript/no-explicit-any -- legacy/target tables
    const db = ctx.db as any;
    // Filtered scan on the normalized automationSlug spelling: this
    // migration's up removes appInstallations from the live schema, so the
    // backend serves no custom indexes on it (migrations:check).
    const existingLegacy = await db
      .query(LEGACY_TABLE)
      .filter((q: any) =>
        q.and(
          q.eq(q.field('organizationId'), keys.org),
          q.eq(q.field('automationSlug'), keys.slug),
        ),
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
