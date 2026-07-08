import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration } from './index';

const DIR = 'migrations/versions/v0_2_93/07_app_upload_intents_table';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const intentTable = defineTable({
  storageId: v.id('_storage'),
  organizationId: v.string(),
  userId: v.string(),
  createdAt: v.number(),
}).index('by_storageId', ['storageId']);

const fixtureSchema = defineSchema({
  appUploadIntents: intentTable,
  automationUploadIntents: intentTable,
});

describe('0.2.93/07 app_upload_intents_table', () => {
  it('up copies rows; down restores', async () => {
    const t = convexTest(fixtureSchema, modules);

    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['bundle']));
    });

    await t.run((ctx) =>
      ctx.db.insert('appUploadIntents', {
        storageId,
        organizationId: 'org_1',
        userId: 'user_1',
        createdAt: 1,
      }),
    );

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('appUploadIntents').collect()) {
        await migration.up(ctx as never, d as never);
      }
    });

    expect(
      await t.run((ctx) => ctx.db.query('appUploadIntents').collect()),
    ).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.query('automationUploadIntents').collect()),
    ).toHaveLength(1);

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('automationUploadIntents').collect()) {
        await migration.down(ctx as never, d as never);
      }
    });

    expect(
      await t.run((ctx) => ctx.db.query('automationUploadIntents').collect()),
    ).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.query('appUploadIntents').collect()),
    ).toHaveLength(1);
  });
});
