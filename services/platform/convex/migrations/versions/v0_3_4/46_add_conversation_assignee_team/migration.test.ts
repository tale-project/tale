import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration as module } from './migration';

const migration = module.spec;

const DIR = 'migrations/versions/v0_3_4/46_add_conversation_assignee_team';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

// Reference migration: the runner never executes it, so the round-trip test
// calls the handlers directly over a fixture carrying BOTH the pre- and
// post-change conversation shapes (the added field is optional).
const fixtureSchema = defineSchema({
  conversations: defineTable({
    organizationId: v.string(),
    assigneeTeamId: v.optional(v.string()),
  }),
});

describe('0.3.4/46_add_conversation_assignee_team (reference)', () => {
  it('up is a no-op; down drops assigneeTeamId (idempotent)', async () => {
    const t = convexTest(fixtureSchema, modules);

    const ids = await t.run(async (ctx) => ({
      queued: await ctx.db.insert('conversations', {
        organizationId: 'org_1',
        assigneeTeamId: 'team_1',
      }),
      unqueued: await ctx.db.insert('conversations', {
        organizationId: 'org_1',
      }),
    }));

    // up: no-op — a queued row keeps its team, an un-queued row stays bare.
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('conversations').collect()) {
        await migration.up(ctx, d as never);
      }
      expect((await ctx.db.get(ids.queued))?.assigneeTeamId).toBe('team_1');
      expect((await ctx.db.get(ids.unqueued))?.assigneeTeamId).toBeUndefined();
    });

    // down: drops assigneeTeamId; a second pass is a no-op (idempotent).
    await t.run(async (ctx) => {
      for (let pass = 0; pass < 2; pass++) {
        for (const d of await ctx.db.query('conversations').collect()) {
          await migration.down(ctx, d as never);
        }
      }
      expect((await ctx.db.get(ids.queued))?.assigneeTeamId).toBeUndefined();
      expect((await ctx.db.get(ids.unqueued))?.assigneeTeamId).toBeUndefined();
    });
  });
});
