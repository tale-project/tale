import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration as module } from './migration';

const migration = module.spec;

const DIR = 'migrations/versions/v0_2_48/01_apikey_reference_id';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const fixtureSchema = defineSchema({
  apikey: defineTable({
    key: v.string(),
    // All three relaxed to optional (matches the v0.2.48 schema relaxation).
    userId: v.optional(v.string()),
    referenceId: v.optional(v.string()),
    configId: v.optional(v.string()),
  }).index('key', ['key']),
});

describe('0.2.48/01 apikey_reference_id (reference)', () => {
  it('up moves userId→referenceId; down restores; idempotent', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run((ctx) =>
      ctx.db.insert('apikey', { key: 'sk_test', userId: 'user_42' }),
    );

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('apikey').collect()) {
        await migration.up(ctx as never, d as never);
      }
    });
    let rows = await t.run((ctx) => ctx.db.query('apikey').collect());
    expect(rows[0].referenceId).toBe('user_42');
    expect(rows[0].userId).toBeUndefined();
    expect(rows[0].configId).toBeUndefined();

    // up again is a no-op
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('apikey').collect()) {
        await migration.up(ctx as never, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('apikey').collect());
    expect(rows[0].referenceId).toBe('user_42');

    // down restores userId, clears referenceId + configId
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('apikey').collect()) {
        await migration.down(ctx as never, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('apikey').collect());
    expect(rows[0].userId).toBe('user_42');
    expect(rows[0].referenceId).toBeUndefined();
    expect(rows[0].configId).toBeUndefined();
  });
});
