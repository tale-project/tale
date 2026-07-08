import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

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

export const migration: DbMigration = {
  meta,
  table: LEGACY_TABLE,

  async up(ctx: MutationCtx, doc: MigrationDoc) {
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

  async down(ctx: MutationCtx, doc: MigrationDoc) {
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
};
