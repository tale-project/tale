import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration as module } from './migration';

const migration = module.spec;

const DIR = 'migrations/versions/v0_4_0/32_chat_messages_table';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

// Reference migrations never run through the runner — the round-trip test
// calls the handlers directly. This release INTRODUCES the table, so the
// fixture carries only the post-change shape: the "pre-change" world is the
// table not existing, which is what `down` restores by emptying it.
const fixtureSchema = defineSchema({
  messages: defineTable({
    organizationId: v.string(),
    threadId: v.string(),
    role: v.union(
      v.literal('user'),
      v.literal('assistant'),
      v.literal('tool'),
      v.literal('system'),
    ),
    parts: v.any(),
    sequence: v.number(),
    model: v.optional(v.string()),
    providerSlug: v.optional(v.string()),
    usage: v.optional(v.any()),
    blockedReason: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_org', ['organizationId'])
    .index('by_thread', ['threadId'])
    .index('by_thread_sequence', ['threadId', 'sequence']),
});

describe('0.4.0/32_chat_messages_table (reference)', () => {
  it('up leaves rows untouched; down empties the table (idempotent)', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert('messages', {
        organizationId: 'org_1',
        threadId: 'thread_1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Here is the summary.' }],
        sequence: 2,
        model: 'anthropic/claude-haiku-4-5',
        createdAt: 1_700_000_030_000,
      });
    });

    // up: a no-op — an existing row survives the forward pass, twice over.
    await t.run(async (ctx) => {
      for (let pass = 0; pass < 2; pass++) {
        for (const doc of await ctx.db.query('messages').collect()) {
          await migration.up(ctx, doc as never);
        }
      }
      const rows = await ctx.db.query('messages').collect();
      expect(rows).toHaveLength(1);
      expect(rows[0].sequence).toBe(2);
    });

    // down: empties the table so a pre-change schema validates. The second
    // pass proves the guard — re-running must not throw on an already-deleted
    // row.
    await t.run(async (ctx) => {
      const seeded = await ctx.db.query('messages').collect();
      for (let pass = 0; pass < 2; pass++) {
        for (const doc of seeded) {
          await migration.down(ctx, doc as never);
        }
      }
      expect(await ctx.db.query('messages').collect()).toHaveLength(0);
    });
  });
});
