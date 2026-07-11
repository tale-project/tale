/** DB migration: move `appUploadClaims` → `automationUploadClaims`. */

import { defineDbMigration } from '../../../framework/define';
import type { MigrationDoc } from '../../../framework/types';

const LEGACY_TABLE = 'appUploadClaims';
const TARGET_TABLE = 'automationUploadClaims';

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

function claimKey(doc: MigrationDoc): { org: string; slug: string } | null {
  const org = str(doc.organizationId);
  const slug = str(doc.slug);
  if (org === undefined || slug === undefined) return null;
  return { org, slug };
}

export const migration = defineDbMigration({
  title: 'Rename appUploadClaims table to automationUploadClaims',
  description:
    'Copies each appUploadClaims row into automationUploadClaims and deletes ' +
    'the legacy row. Idempotent.',
  destructive: false,
  snapshot: 'none',
  formerIds: ['0.2.93/06_app_upload_claims_table'],
  subjects: { tables: ['appUploadClaims', 'automationUploadClaims'] },
  table: LEGACY_TABLE,
  // up MOVES rows: down must walk the populated target table, not the
  // then-empty legacy one (it would silently restore nothing).
  downTable: TARGET_TABLE,

  async up(ctx, doc) {
    const keys = claimKey(doc);
    if (!keys) return;
    const payload = payloadWithoutSystemFields(doc);

    // oxlint-disable-next-line typescript/no-explicit-any -- legacy/target tables
    const db = ctx.db as any;
    const existing = await db
      .query(TARGET_TABLE)
      .withIndex('by_org_slug', (q: any) =>
        q.eq('organizationId', keys.org).eq('slug', keys.slug),
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
    const keys = claimKey(doc);
    if (!keys) return;
    const payload = payloadWithoutSystemFields(doc);

    // oxlint-disable-next-line typescript/no-explicit-any -- legacy/target tables
    const db = ctx.db as any;
    // Filtered scan: this migration's up removes appUploadClaims from the
    // live schema, so the backend serves no custom indexes on it
    // (migrations:check).
    const existingLegacy = await db
      .query(LEGACY_TABLE)
      .filter((q: any) =>
        q.and(
          q.eq(q.field('organizationId'), keys.org),
          q.eq(q.field('slug'), keys.slug),
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
