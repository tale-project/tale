import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration as module } from './migration';

const migration = module.spec;

const DIR = 'migrations/versions/v0_2_89/01_usage_ledger_apikey_budget_scope';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

// Minimal post-change usageLedger shape: `apiKeyId` optional so both keyless
// (legacy) and key-attributed rows validate (mirrors the post-change schema).
const fixtureSchema = defineSchema({
  usageLedger: defineTable({
    organizationId: v.string(),
    userId: v.string(),
    periodKey: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
    costEstimate: v.number(),
    requestCount: v.number(),
    apiKeyId: v.optional(v.string()),
  })
    .index('by_org_period', ['organizationId', 'periodKey'])
    .index('by_org_apiKey_period', ['organizationId', 'apiKeyId', 'periodKey']),
});

async function insertRow(
  ctx: Parameters<Parameters<ReturnType<typeof convexTest>['run']>[0]>[0],
  apiKeyId?: string,
) {
  await ctx.db.insert('usageLedger', {
    organizationId: 'org_1',
    userId: 'user_1',
    periodKey: '2026-07',
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    costEstimate: 3,
    requestCount: 1,
    ...(apiKeyId !== undefined ? { apiKeyId } : {}),
  });
}

describe('0.2.89/01 usage_ledger_apikey_budget_scope (reference)', () => {
  it('up is a no-op; down drops apiKeyId so rows re-validate against the pre-change schema', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run(async (ctx) => {
      await insertRow(ctx, 'apikey_A'); // key-attributed row — down must clear
      await insertRow(ctx); // legacy keyless row — untouched throughout
    });

    // up: no-op — the key-attributed row keeps its apiKeyId.
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('usageLedger').collect()) {
        await migration.up(ctx, d as never);
      }
    });
    let rows = await t.run((ctx) => ctx.db.query('usageLedger').collect());
    expect(
      rows
        .map((r) => r.apiKeyId)
        .sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(['apikey_A', undefined]);

    // down: apiKeyId dropped from every row (idempotent for the keyless one).
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('usageLedger').collect()) {
        await migration.down(ctx, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('usageLedger').collect());
    expect(rows.every((r) => r.apiKeyId === undefined)).toBe(true);

    // down again is a no-op (all already cleared).
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('usageLedger').collect()) {
        await migration.down(ctx, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('usageLedger').collect());
    expect(rows.every((r) => r.apiKeyId === undefined)).toBe(true);
  });
});
