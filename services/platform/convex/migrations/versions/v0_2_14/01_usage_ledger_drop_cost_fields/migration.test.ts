import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration as module } from './migration';

const migration = module.spec;

const DIR = 'migrations/versions/v0_2_14/01_usage_ledger_drop_cost_fields';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const fixtureSchema = defineSchema({
  usageLedger: defineTable({
    organizationId: v.string(),
    userId: v.string(),
    periodKey: v.string(),
    costEstimate: v.number(),
    // Old (removed) fields — optional so both shapes validate.
    estimatedCostEur: v.optional(v.number()),
    estimatedCostUsd: v.optional(v.number()),
  }).index('by_org_user_period', ['organizationId', 'userId', 'periodKey']),
});

describe('0.2.14/01 usage_ledger_drop_cost_fields (reference)', () => {
  it('up drops cost fields; down restores them to 0; idempotent', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run((ctx) =>
      ctx.db.insert('usageLedger', {
        organizationId: 'org_1',
        userId: 'user_1',
        periodKey: '2026-01',
        costEstimate: 1.23,
        estimatedCostEur: 0.99,
        estimatedCostUsd: 1.05,
      }),
    );

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('usageLedger').collect()) {
        await migration.up(ctx, d as never);
      }
    });
    let rows = await t.run((ctx) => ctx.db.query('usageLedger').collect());
    expect(rows[0].estimatedCostEur).toBeUndefined();
    expect(rows[0].estimatedCostUsd).toBeUndefined();
    expect(rows[0].costEstimate).toBe(1.23);

    // up again is a no-op
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('usageLedger').collect()) {
        await migration.up(ctx, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('usageLedger').collect());
    expect(rows[0].estimatedCostEur).toBeUndefined();

    // down restores to 0 (lossy — original values not recoverable)
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('usageLedger').collect()) {
        await migration.down(ctx, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('usageLedger').collect());
    expect(rows[0].estimatedCostEur).toBe(0);
    expect(rows[0].estimatedCostUsd).toBe(0);
  });
});
