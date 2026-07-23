import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration as module } from './migration';

const migration = module.spec;

const DIR = 'migrations/versions/v0_4_0/28_automation_triggers_table';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

// Reference migrations never run through the runner — the round-trip test
// calls the handlers directly. This release INTRODUCES the table, so the
// fixture carries only the post-change shape: the "pre-change" world is the
// table not existing, which is what `down` restores by emptying it.
const fixtureSchema = defineSchema({
  workflowTriggers: defineTable({
    organizationId: v.string(),
    name: v.string(),
    kind: v.union(
      v.literal('schedule'),
      v.literal('webhook'),
      v.literal('event'),
      v.literal('api-key'),
    ),
    cron: v.optional(v.string()),
    timezone: v.optional(v.string()),
    tokenHash: v.optional(v.string()),
    event: v.optional(v.string()),
    enabled: v.boolean(),
    lastFiredAt: v.optional(v.number()),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_org', ['organizationId'])
    .index('by_org_name', ['organizationId', 'name'])
    .index('by_kind_enabled', ['kind', 'enabled'])
    .index('by_token_hash', ['tokenHash']),
});

describe('0.4.0/28_automation_triggers_table (reference)', () => {
  it('up leaves rows untouched; down empties the table (idempotent)', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert('workflowTriggers', {
        organizationId: 'org_1',
        name: 'billing/dunning',
        kind: 'schedule',
        cron: '0 3 * * *',
        timezone: 'Europe/Zurich',
        enabled: true,
        createdBy: 'user_1',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      });
    });

    // up: a no-op — an existing row survives the forward pass, twice over.
    await t.run(async (ctx) => {
      for (let pass = 0; pass < 2; pass++) {
        for (const doc of await ctx.db.query('workflowTriggers').collect()) {
          await migration.up(ctx, doc as never);
        }
      }
      const rows = await ctx.db.query('workflowTriggers').collect();
      expect(rows).toHaveLength(1);
      expect(rows[0].cron).toBe('0 3 * * *');
    });

    // down: empties the table so a pre-change schema validates. The second
    // pass proves the guard — re-running must not throw on an already-deleted
    // row.
    await t.run(async (ctx) => {
      const seeded = await ctx.db.query('workflowTriggers').collect();
      for (let pass = 0; pass < 2; pass++) {
        for (const doc of seeded) {
          await migration.down(ctx, doc as never);
        }
      }
      expect(await ctx.db.query('workflowTriggers').collect()).toHaveLength(0);
    });
  });
});
