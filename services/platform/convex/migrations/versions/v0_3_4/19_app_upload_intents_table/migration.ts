/** DB migration: move `appUploadIntents` → `automationUploadIntents`. */

import { defineDbMigration } from '../../../framework/define';
import type { MigrationDoc } from '../../../framework/types';

const LEGACY_TABLE = 'appUploadIntents';
const TARGET_TABLE = 'automationUploadIntents';

function payloadWithoutSystemFields(
  doc: MigrationDoc,
): Record<string, unknown> {
  const payload = { ...(doc as Record<string, unknown>) };
  delete payload._id;
  delete payload._creationTime;
  return payload;
}

export const migration = defineDbMigration({
  title: 'Rename appUploadIntents table to automationUploadIntents',
  description:
    'Copies each appUploadIntents row into automationUploadIntents and deletes ' +
    'the legacy row. Idempotent.',
  destructive: false,
  snapshot: 'none',
  formerIds: ['0.2.93/07_app_upload_intents_table'],
  subjects: { tables: ['appUploadIntents', 'automationUploadIntents'] },
  table: LEGACY_TABLE,
  // up MOVES rows: down must walk the populated target table, not the
  // then-empty legacy one (it would silently restore nothing).
  downTable: TARGET_TABLE,

  async up(ctx, doc) {
    const storageId = doc.storageId;
    if (storageId === undefined) return;
    const payload = payloadWithoutSystemFields(doc);

    // oxlint-disable-next-line typescript/no-explicit-any -- legacy/target tables
    const db = ctx.db as any;
    const existing = await db
      .query(TARGET_TABLE)
      .withIndex('by_storageId', (q: any) => q.eq('storageId', storageId))
      .first();
    if (existing) {
      await db.delete(doc._id);
      return;
    }
    await db.insert(TARGET_TABLE, payload);
    await db.delete(doc._id);
  },

  async down(ctx, doc) {
    const storageId = doc.storageId;
    if (storageId === undefined) return;
    const payload = payloadWithoutSystemFields(doc);

    // oxlint-disable-next-line typescript/no-explicit-any -- legacy/target tables
    const db = ctx.db as any;
    const existingLegacy = await db
      .query(LEGACY_TABLE)
      .withIndex('by_storageId', (q: any) => q.eq('storageId', storageId))
      .first();
    if (existingLegacy) {
      await db.delete(doc._id);
      return;
    }
    await db.insert(LEGACY_TABLE, payload);
    await db.delete(doc._id);
  },
});
