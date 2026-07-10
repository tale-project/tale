import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration as module } from './migration';

const migration = module.spec;

const DIR = 'migrations/versions/v0_2_1/02_agent_webhooks_agent_slug';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const fixtureSchema = defineSchema({
  agentWebhooks: defineTable({
    organizationId: v.string(),
    agentFileName: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
    token: v.string(),
    isActive: v.boolean(),
    createdBy: v.string(),
  }).index('by_org', ['organizationId']),
});

const ORG = 'org_test_1';

describe('0.2.1/02 agent_webhooks_agent_slug (reference)', () => {
  it('up renames agentFileName→agentSlug; down restores; idempotent', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run((ctx) =>
      ctx.db.insert('agentWebhooks', {
        organizationId: ORG,
        agentFileName: 'support-bot',
        token: 'tok_123',
        isActive: true,
        createdBy: 'user_1',
      }),
    );

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('agentWebhooks').collect()) {
        await migration.up(ctx, d as never);
      }
    });
    let rows = await t.run((ctx) => ctx.db.query('agentWebhooks').collect());
    expect(rows[0].agentSlug).toBe('support-bot');
    expect(rows[0].agentFileName).toBeUndefined();

    // up again is a no-op
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('agentWebhooks').collect()) {
        await migration.up(ctx, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('agentWebhooks').collect());
    expect(rows[0].agentSlug).toBe('support-bot');

    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('agentWebhooks').collect()) {
        await migration.down(ctx, d as never);
      }
    });
    rows = await t.run((ctx) => ctx.db.query('agentWebhooks').collect());
    expect(rows[0].agentFileName).toBe('support-bot');
    expect(rows[0].agentSlug).toBeUndefined();
  });
});
