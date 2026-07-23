import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration as module } from './migration';

const migration = module.spec;

const DIR = 'migrations/versions/v0_4_0/29_automation_runs_table';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

// Reference migrations never run through the runner — the round-trip test
// calls the handlers directly. This release INTRODUCES the table, so the
// fixture carries only the post-change shape: the "pre-change" world is the
// table not existing, which is what `down` restores by emptying it.
const fixtureSchema = defineSchema({
  workflowRuns: defineTable({
    organizationId: v.string(),
    name: v.string(),
    version: v.number(),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('waiting'),
      v.literal('success'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    mode: v.union(v.literal('mock'), v.literal('live')),
    startedBy: v.string(),
    input: v.any(),
    output: v.optional(v.any()),
    checkpoints: v.optional(v.any()),
    trace: v.optional(v.any()),
    effects: v.optional(v.any()),
    detail: v.optional(v.string()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index('by_org', ['organizationId'])
    .index('by_org_name', ['organizationId', 'name'])
    .index('by_status', ['status']),
});

describe('0.4.0/29_automation_runs_table (reference)', () => {
  it('up leaves rows untouched; down empties the table (idempotent)', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert('workflowRuns', {
        organizationId: 'org_1',
        name: 'billing/dunning',
        version: 3,
        status: 'success',
        mode: 'live',
        startedBy: 'trigger:schedule',
        input: { trigger: 'schedule' },
        output: { sent: 2 },
        checkpoints: { nodes: {}, executions: 2 },
        trace: [],
        effects: [],
        startedAt: 1_700_000_000_000,
        finishedAt: 1_700_000_060_000,
      });
    });

    // up: a no-op — an existing row survives the forward pass, twice over.
    await t.run(async (ctx) => {
      for (let pass = 0; pass < 2; pass++) {
        for (const doc of await ctx.db.query('workflowRuns').collect()) {
          await migration.up(ctx, doc as never);
        }
      }
      const rows = await ctx.db.query('workflowRuns').collect();
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('success');
    });

    // down: empties the table so a pre-change schema validates. The second
    // pass proves the guard — re-running must not throw on an already-deleted
    // row.
    await t.run(async (ctx) => {
      const seeded = await ctx.db.query('workflowRuns').collect();
      for (let pass = 0; pass < 2; pass++) {
        for (const doc of seeded) {
          await migration.down(ctx, doc as never);
        }
      }
      expect(await ctx.db.query('workflowRuns').collect()).toHaveLength(0);
    });
  });
});
