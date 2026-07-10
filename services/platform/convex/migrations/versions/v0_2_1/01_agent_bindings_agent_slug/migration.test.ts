import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration as module } from './migration';

const migration = module.spec;

const DIR = 'migrations/versions/v0_2_1/01_agent_bindings_agent_slug';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

/**
 * Minimal fixture declaring ONLY the touched table, with both the old
 * (`agentFileName`) and new (`agentSlug`) fields optional so convex-test
 * validates both the pre- and post-migration shapes.
 */
const fixtureSchema = defineSchema({
  agentBindings: defineTable({
    organizationId: v.string(),
    agentFileName: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
    teamId: v.optional(v.string()),
  }).index('by_organization', ['organizationId']),
});

const ORG = 'org_test_1';

describe('0.2.1/01 agent_bindings_agent_slug (reference)', () => {
  it('up renames agentFileName→agentSlug; down restores; idempotent', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run((ctx) =>
      ctx.db.insert('agentBindings', {
        organizationId: ORG,
        agentFileName: 'support-bot',
      }),
    );

    // up
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('agentBindings').collect()) {
        await migration.up(ctx, d as never);
      }
    });
    let rows = await t.run((ctx) => ctx.db.query('agentBindings').collect());
    expect(rows[0].agentSlug).toBe('support-bot');
    expect(rows[0].agentFileName).toBeUndefined();

    // up again is a no-op
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('agentBindings').collect()) {
        await migration.up(ctx, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('agentBindings').collect());
    expect(rows[0].agentSlug).toBe('support-bot');
    expect(rows[0].agentFileName).toBeUndefined();

    // down
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('agentBindings').collect()) {
        await migration.down(ctx, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('agentBindings').collect());
    expect(rows[0].agentFileName).toBe('support-bot');
    expect(rows[0].agentSlug).toBeUndefined();
  });
});
