import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration } from './index';

const DIR = 'migrations/versions/v0_2_93/03_thread_metadata_automation_slug';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const fixtureSchema = defineSchema({
  threadMetadata: defineTable({
    threadId: v.string(),
    userId: v.string(),
    chatType: v.literal('general'),
    status: v.literal('active'),
    createdAt: v.number(),
    organizationId: v.optional(v.string()),
    kind: v.optional(v.literal('app_discussion')),
    appSlug: v.optional(v.string()),
    automationSlug: v.optional(v.string()),
    subjectType: v.optional(v.string()),
    subjectId: v.optional(v.string()),
  }).index('by_org_automation_subject', [
    'organizationId',
    'automationSlug',
    'subjectType',
    'subjectId',
  ]),
});

describe('0.2.93/03 thread_metadata_automation_slug', () => {
  it('up renames appSlug and subjectType app→automation; down restores', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run((ctx) =>
      ctx.db.insert('threadMetadata', {
        threadId: 't1',
        userId: 'u1',
        chatType: 'general',
        status: 'active',
        createdAt: 1,
        kind: 'app_discussion',
        organizationId: 'org_1',
        appSlug: 'inbox',
        subjectType: 'app',
        subjectId: 'inbox',
      }),
    );

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('threadMetadata').collect()) {
        await migration.up(ctx as never, d as never);
      }
    });
    let rows = await t.run((ctx) => ctx.db.query('threadMetadata').collect());
    expect(rows[0].automationSlug).toBe('inbox');
    expect(rows[0].subjectType).toBe('automation');
    expect(rows[0].appSlug).toBeUndefined();

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('threadMetadata').collect()) {
        await migration.down(ctx as never, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('threadMetadata').collect());
    expect(rows[0].appSlug).toBe('inbox');
    expect(rows[0].subjectType).toBe('app');
    expect(rows[0].automationSlug).toBeUndefined();
  });
});
