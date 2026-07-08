import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration } from './index';

const DIR =
  'migrations/versions/v0_2_93/08_thread_metadata_automation_discussion';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const fixtureSchema = defineSchema({
  threadMetadata: defineTable({
    threadId: v.string(),
    userId: v.string(),
    chatType: v.literal('personal'),
    status: v.literal('active'),
    createdAt: v.number(),
    kind: v.optional(
      v.union(
        v.literal('chat'),
        v.literal('app_discussion'),
        v.literal('automation_discussion'),
      ),
    ),
  }),
});

describe('0.2.93/08 thread_metadata_automation_discussion', () => {
  it('up renames kind; down restores; idempotent', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run((ctx) =>
      ctx.db.insert('threadMetadata', {
        threadId: 't1',
        userId: 'u1',
        chatType: 'personal',
        status: 'active',
        createdAt: 1,
        kind: 'app_discussion',
      }),
    );

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('threadMetadata').collect()) {
        await migration.up(ctx as never, d as never);
      }
    });
    let rows = await t.run((ctx) => ctx.db.query('threadMetadata').collect());
    expect(rows[0].kind).toBe('automation_discussion');

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('threadMetadata').collect()) {
        await migration.up(ctx as never, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('threadMetadata').collect());
    expect(rows[0].kind).toBe('automation_discussion');

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('threadMetadata').collect()) {
        await migration.down(ctx as never, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('threadMetadata').collect());
    expect(rows[0].kind).toBe('app_discussion');
  });
});
