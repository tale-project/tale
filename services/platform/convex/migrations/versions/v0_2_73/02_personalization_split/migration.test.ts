import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration as module } from './migration';

const migration = module.spec;

const DIR = 'migrations/versions/v0_2_73/02_personalization_split';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const fixtureSchema = defineSchema({
  userPreferences: defineTable({
    userId: v.string(),
    organizationId: v.string(),
    customInstructions: v.string(),
    enabled: v.optional(v.boolean()),
    customInstructionsEnabled: v.optional(v.boolean()),
    memoriesEnabled: v.optional(v.boolean()),
    updatedAt: v.number(),
  }).index('by_userId_organizationId', ['userId', 'organizationId']),
});

describe('0.2.73/02 personalization_split (reference)', () => {
  it('up fans enabled into both toggles; down OR-folds back; idempotent', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run((ctx) =>
      ctx.db.insert('userPreferences', {
        userId: 'user_1',
        organizationId: 'org_1',
        customInstructions: 'be terse',
        enabled: true,
        updatedAt: 1,
      }),
    );

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('userPreferences').collect()) {
        await migration.up(ctx, d as never);
      }
    });
    let rows = await t.run((ctx) => ctx.db.query('userPreferences').collect());
    expect(rows[0].customInstructionsEnabled).toBe(true);
    expect(rows[0].memoriesEnabled).toBe(true);
    expect(rows[0].enabled).toBeUndefined();

    // up again is a no-op
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('userPreferences').collect()) {
        await migration.up(ctx, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('userPreferences').collect());
    expect(rows[0].customInstructionsEnabled).toBe(true);

    // down OR-folds back to enabled
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('userPreferences').collect()) {
        await migration.down(ctx, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('userPreferences').collect());
    expect(rows[0].enabled).toBe(true);
    expect(rows[0].customInstructionsEnabled).toBeUndefined();
    expect(rows[0].memoriesEnabled).toBeUndefined();
  });
});
