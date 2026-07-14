import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration as module } from './migration';

const migration = module.spec;

const DIR = 'migrations/versions/v0_3_4/45_add_conversation_assignee';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

// Reference migration: the runner never executes it, so the round-trip test
// calls the handlers directly over a fixture carrying BOTH the pre- and
// post-change conversation shapes (the added field is optional).
const fixtureSchema = defineSchema({
  conversations: defineTable({
    organizationId: v.string(),
    assigneeUserId: v.optional(v.string()),
  }),
});

describe('0.3.4/45_add_conversation_assignee (reference)', () => {
  it('up is a no-op; down drops assigneeUserId (idempotent)', async () => {
    const t = convexTest(fixtureSchema, modules);

    const ids = await t.run(async (ctx) => ({
      assigned: await ctx.db.insert('conversations', {
        organizationId: 'org_1',
        assigneeUserId: 'user_1',
      }),
      unassigned: await ctx.db.insert('conversations', {
        organizationId: 'org_1',
      }),
    }));

    // up: no-op — an assigned row keeps its owner, an unassigned row stays bare.
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query('conversations').collect()) {
        await migration.up(ctx, d as never);
      }
      expect((await ctx.db.get(ids.assigned))?.assigneeUserId).toBe('user_1');
      expect(
        (await ctx.db.get(ids.unassigned))?.assigneeUserId,
      ).toBeUndefined();
    });

    // down: drops assigneeUserId; a second pass is a no-op (idempotent).
    await t.run(async (ctx) => {
      for (let pass = 0; pass < 2; pass++) {
        for (const d of await ctx.db.query('conversations').collect()) {
          await migration.down(ctx, d as never);
        }
      }
      expect((await ctx.db.get(ids.assigned))?.assigneeUserId).toBeUndefined();
      expect(
        (await ctx.db.get(ids.unassigned))?.assigneeUserId,
      ).toBeUndefined();
    });
  });
});
