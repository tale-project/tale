import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../migrations/framework/test_helpers';
import { countActiveGenerations, isDrainingNow } from './drain';

// convex-test locates the project root via a module path containing
// `_generated`; the helpers run inside `t.run` (no function dispatch) so the
// `_generated` glob alone is enough — no need to load the whole convex tree.
const modules = buildModules(
  import.meta.glob('../_generated/**/*.*s'),
  'control',
);

// Minimal fixture mirroring the two tables the drain helpers read. `as never`
// bridges the fixture ctx to the helpers' generated ctx type (same pattern the
// migration tests use); the helpers only touch `ctx.db.query(...).withIndex`.
const fixtureSchema = defineSchema({
  backendControl: defineTable({
    key: v.literal('singleton'),
    draining: v.boolean(),
    drainStartedAt: v.optional(v.number()),
    drainExpiresAt: v.optional(v.number()),
  }).index('by_key', ['key']),
  threadMetadata: defineTable({
    generationStatus: v.optional(
      v.union(v.literal('generating'), v.literal('idle')),
    ),
    generationStartTime: v.optional(v.number()),
    generationHeartbeatAt: v.optional(v.number()),
  }).index('by_generationStatus', ['generationStatus']),
});

describe('isDrainingNow', () => {
  it('returns false when no control row exists', async () => {
    const t = convexTest(fixtureSchema, modules);
    await t.run(async (ctx) => {
      expect(await isDrainingNow(ctx as never)).toBe(false);
    });
  });

  it('returns true while draining and unexpired', async () => {
    const t = convexTest(fixtureSchema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('backendControl', {
        key: 'singleton',
        draining: true,
        drainStartedAt: Date.now(),
        drainExpiresAt: Date.now() + 60_000,
      });
      expect(await isDrainingNow(ctx as never)).toBe(true);
    });
  });

  it('treats an expired drain flag as not draining (crashed-deploy backstop)', async () => {
    const t = convexTest(fixtureSchema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('backendControl', {
        key: 'singleton',
        draining: true,
        drainStartedAt: Date.now() - 120_000,
        drainExpiresAt: Date.now() - 1_000,
      });
      expect(await isDrainingNow(ctx as never)).toBe(false);
    });
  });

  it('returns false when the flag is explicitly cleared', async () => {
    const t = convexTest(fixtureSchema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('backendControl', {
        key: 'singleton',
        draining: false,
      });
      expect(await isDrainingNow(ctx as never)).toBe(false);
    });
  });
});

describe('countActiveGenerations', () => {
  it('reports 0 even with generating rows while chat is offline', async () => {
    // Chat generation cannot run while its backend is rebuilt, so the drain
    // probe truthfully reports zero in-flight generations regardless of any
    // stale rows the retired pipeline left behind — a drain never waits on
    // work that cannot exist.
    const t = convexTest(fixtureSchema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('threadMetadata', {
        generationStatus: 'generating',
        generationStartTime: Date.now(),
      });
      await ctx.db.insert('threadMetadata', {
        generationStatus: 'generating',
        generationStartTime: Date.now() - 40 * 60 * 1000,
        generationHeartbeatAt: Date.now() - 10_000,
      });

      expect(await countActiveGenerations(ctx as never)).toBe(0);
    });
  });

  it('returns 0 when nothing is generating', async () => {
    const t = convexTest(fixtureSchema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('threadMetadata', { generationStatus: 'idle' });
      expect(await countActiveGenerations(ctx as never)).toBe(0);
    });
  });
});
