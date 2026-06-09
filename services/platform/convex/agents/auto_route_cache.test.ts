import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root. This file lives at
// convex/agents/, so resolve glob keys against that base.
const TEST_DIR_FROM_CONVEX_ROOT = 'agents';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const ORG = 'org_autoroute';
const HASH = 'cands_hash_1';
const MSG = 'how do i reset my password';

type T = TestConvex<typeof schema>;

async function seedThread(t: T, threadId: string): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('threadMetadata', {
      threadId,
      userId: 'user_1',
      chatType: 'general',
      status: 'active',
      organizationId: ORG,
      createdAt: 0,
    });
  });
}

async function cacheRows(t: T) {
  return t.run((ctx) => ctx.db.query('autoRouteCache').collect());
}

async function lastAutoRoute(t: T, threadId: string) {
  return t.run(async (ctx) => {
    const row = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
      .first();
    return row?.lastAutoRoute;
  });
}

describe('auto-route cache', () => {
  it('upsert → read hit, then TTL expiry returns null', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agents.internal_mutations.upsertAutoRouteCache, {
      organizationId: ORG,
      candidatesHash: HASH,
      messageKey: MSG,
      agentSlug: 'billing-agent',
      source: 'classified',
      nowMs: 0,
    });
    const hit = await t.query(
      internal.agents.internal_queries.getAutoRouteCache,
      { organizationId: ORG, candidatesHash: HASH, messageKey: MSG, nowMs: 0 },
    );
    expect(hit?.agentSlug).toBe('billing-agent');

    // Far in the future → past the TTL → miss.
    const expired = await t.query(
      internal.agents.internal_queries.getAutoRouteCache,
      {
        organizationId: ORG,
        candidatesHash: HASH,
        messageKey: MSG,
        nowMs: 1000 * 60 * 60 * 24 * 365,
      },
    );
    expect(expired).toBeNull();
  });

  it('round-trips the advisory hints (language / tuning / capabilities)', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agents.internal_mutations.upsertAutoRouteCache, {
      organizationId: ORG,
      candidatesHash: HASH,
      messageKey: MSG,
      agentSlug: 'billing-agent',
      source: 'classified',
      nowMs: 0,
      language: 'fr',
      tuning: { style: 'concise', verbosity: 'terse' },
      capabilities: ['web'],
    });
    const hit = await t.query(
      internal.agents.internal_queries.getAutoRouteCache,
      { organizationId: ORG, candidatesHash: HASH, messageKey: MSG, nowMs: 0 },
    );
    expect(hit).toMatchObject({
      agentSlug: 'billing-agent',
      language: 'fr',
      tuning: { style: 'concise', verbosity: 'terse' },
      capabilities: ['web'],
    });
  });

  it('clears stale advisory hints when a manual override changes the agent', async () => {
    const t = convexTest(schema, modules);
    await seedThread(t, 'thread_advice');
    // A prior classified decision carried hints for the auto-routed agent.
    await t.mutation(internal.agents.internal_mutations.upsertAutoRouteCache, {
      organizationId: ORG,
      candidatesHash: HASH,
      messageKey: MSG,
      agentSlug: 'chat-agent',
      source: 'classified',
      nowMs: 0,
      language: 'fr',
      tuning: { style: 'concise' },
      capabilities: ['web'],
    });
    await t.mutation(internal.threads.internal_mutations.setLastAutoRoute, {
      threadId: 'thread_advice',
      messageKey: MSG,
      candidatesHash: HASH,
      agentSlug: 'chat-agent',
    });
    await t.mutation(internal.agents.internal_mutations.recordRouteOverride, {
      threadId: 'thread_advice',
      organizationId: ORG,
      explicitSlug: 'billing-agent',
      messageKey: MSG,
      nowMs: 1,
    });
    const hit = await t.query(
      internal.agents.internal_queries.getAutoRouteCache,
      { organizationId: ORG, candidatesHash: HASH, messageKey: MSG, nowMs: 1 },
    );
    expect(hit?.agentSlug).toBe('billing-agent');
    expect(hit?.language).toBeUndefined();
    expect(hit?.tuning).toBeUndefined();
    expect(hit?.capabilities).toBeUndefined();
  });

  it('records an override when a same-message manual pin differs, and clears the pointer', async () => {
    const t = convexTest(schema, modules);
    await seedThread(t, 'thread_ovr');
    await t.mutation(internal.threads.internal_mutations.setLastAutoRoute, {
      threadId: 'thread_ovr',
      messageKey: MSG,
      candidatesHash: HASH,
      agentSlug: 'chat-agent',
    });
    await t.mutation(internal.agents.internal_mutations.recordRouteOverride, {
      threadId: 'thread_ovr',
      organizationId: ORG,
      explicitSlug: 'billing-agent', // user corrected chat → billing
      messageKey: MSG,
      nowMs: 1,
    });
    const rows = await cacheRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].agentSlug).toBe('billing-agent');
    expect(rows[0].source).toBe('override');
    // Pointer consumed so the correction fires at most once (cleared field
    // reads back nullish).
    expect((await lastAutoRoute(t, 'thread_ovr')) ?? null).toBeNull();
  });

  it('does NOT record an override for a different message (new task, not a correction)', async () => {
    const t = convexTest(schema, modules);
    await seedThread(t, 'thread_diff');
    await t.mutation(internal.threads.internal_mutations.setLastAutoRoute, {
      threadId: 'thread_diff',
      messageKey: 'message A',
      candidatesHash: HASH,
      agentSlug: 'chat-agent',
    });
    await t.mutation(internal.agents.internal_mutations.recordRouteOverride, {
      threadId: 'thread_diff',
      organizationId: ORG,
      explicitSlug: 'billing-agent',
      messageKey: 'message B', // different message
      nowMs: 1,
    });
    expect(await cacheRows(t)).toHaveLength(0);
    // Pointer is left intact (no correction happened).
    expect(await lastAutoRoute(t, 'thread_diff')).toMatchObject({
      messageKey: 'message A',
    });
  });

  it('does NOT record an override when the pinned agent matches the auto route', async () => {
    const t = convexTest(schema, modules);
    await seedThread(t, 'thread_same');
    await t.mutation(internal.threads.internal_mutations.setLastAutoRoute, {
      threadId: 'thread_same',
      messageKey: MSG,
      candidatesHash: HASH,
      agentSlug: 'chat-agent',
    });
    await t.mutation(internal.agents.internal_mutations.recordRouteOverride, {
      threadId: 'thread_same',
      organizationId: ORG,
      explicitSlug: 'chat-agent', // same as auto → not a correction
      messageKey: MSG,
      nowMs: 1,
    });
    expect(await cacheRows(t)).toHaveLength(0);
  });

  it('purges only rows older than maxAge', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('autoRouteCache', {
        organizationId: ORG,
        candidatesHash: HASH,
        messageKey: 'old',
        agentSlug: 'a',
        source: 'classified',
        hits: 1,
        createdAt: 0, // ancient
        lastUsedAt: 0,
      });
      await ctx.db.insert('autoRouteCache', {
        organizationId: ORG,
        candidatesHash: HASH,
        messageKey: 'fresh',
        agentSlug: 'b',
        source: 'classified',
        hits: 1,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      });
    });
    const deleted = await t.mutation(
      internal.agents.internal_mutations.purgeAutoRouteCache,
      { maxAgeMs: 1000 },
    );
    expect(deleted).toBe(1);
    const remaining = await cacheRows(t);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].messageKey).toBe('fresh');
  });
});
