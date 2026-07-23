/**
 * The message sequence is the ordering key a whole conversation is read by, so
 * it must be gap-free and monotonic even when appends race. These tests fire
 * concurrent appends and assert the assigned sequences form exactly 0..N-1
 * with no gap and no duplicate — the guarantee that ordering never depends on
 * a wall-clock tie. They also pin that a thread's messages are only ever
 * readable by the thread's owner, in the same org.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { encodeChatError } from '../../lib/shared/chat-errors';
import { DAY_MS } from '../../lib/shared/metrics-window';
import { api, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'chat';
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

type T = TestConvex<typeof schema>;

async function seedMember(
  t: T,
  userId: string,
  organizationId: string,
  role = 'member',
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}_${organizationId}`,
      userId,
      organizationId,
      role,
      createdAt: 0,
    });
  });
}

async function seedThread(
  t: T,
  organizationId: string,
  userId: string,
  agentSlug?: string,
): Promise<Id<'threads'>> {
  return t.run(async (ctx) =>
    ctx.db.insert('threads', {
      organizationId,
      userId,
      kind: 'direct',
      ...(agentSlug !== undefined && { agentSlug }),
      archived: false,
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

const ORG_A = 'org_a';
const ORG_B = 'org_b';
const ALICE = 'user_alice';
const BOB = 'user_bob';

describe('chat message sequence assignment', () => {
  it('assigns gap-free, monotonic sequences to concurrent appends', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);

    const count = 12;
    const results = await Promise.all(
      Array.from({ length: count }, (_v, i) =>
        t.mutation(internal.chat.messages.appendMessageInternal, {
          organizationId: ORG_A,
          threadId,
          role: 'user',
          parts: [{ type: 'text', text: `m${i}` }],
        }),
      ),
    );

    const sequences = results.map((r) => r.sequence).sort((a, b) => a - b);
    // Exactly 0..count-1, each once: no gap, no duplicate, no wall-clock tie.
    expect(sequences).toEqual(Array.from({ length: count }, (_v, i) => i));
  });

  it('sequences two threads independently', async () => {
    const t = convexTest(schema, modules);
    const threadA = await seedThread(t, ORG_A, ALICE);
    const threadB = await seedThread(t, ORG_A, ALICE);

    // Interleave appends across the two threads.
    await Promise.all([
      t.mutation(internal.chat.messages.appendMessageInternal, {
        organizationId: ORG_A,
        threadId: threadA,
        role: 'user',
        parts: [],
      }),
      t.mutation(internal.chat.messages.appendMessageInternal, {
        organizationId: ORG_A,
        threadId: threadB,
        role: 'user',
        parts: [],
      }),
      t.mutation(internal.chat.messages.appendMessageInternal, {
        organizationId: ORG_A,
        threadId: threadA,
        role: 'assistant',
        parts: [],
      }),
    ]);

    const a = await t.run(async (ctx) =>
      ctx.db
        .query('messages')
        .withIndex('by_thread_sequence', (q) => q.eq('threadId', threadA))
        .collect(),
    );
    const b = await t.run(async (ctx) =>
      ctx.db
        .query('messages')
        .withIndex('by_thread_sequence', (q) => q.eq('threadId', threadB))
        .collect(),
    );
    expect(a.map((m) => m.sequence)).toEqual([0, 1]);
    expect(b.map((m) => m.sequence)).toEqual([0]);
  });
});

describe('chat messages — scoping', () => {
  it('returns a thread’s messages in sequence order to its owner', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const threadId = await seedThread(t, ORG_A, ALICE);

    for (const text of ['first', 'second', 'third']) {
      await t.mutation(internal.chat.messages.appendMessageInternal, {
        organizationId: ORG_A,
        threadId,
        role: 'user',
        parts: [{ type: 'text', text }],
      });
    }

    const messages = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.messages.listMessages, {
        organizationId: ORG_A,
        threadId,
      });
    expect(messages.map((m) => m.sequence)).toEqual([0, 1, 2]);
  });

  it('hides a thread’s messages from another member and another org', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    await seedMember(t, BOB, ORG_A);
    await seedMember(t, ALICE, ORG_B);
    const threadId = await seedThread(t, ORG_A, ALICE);
    await t.mutation(internal.chat.messages.appendMessageInternal, {
      organizationId: ORG_A,
      threadId,
      role: 'user',
      parts: [{ type: 'text', text: 'secret' }],
    });

    // Another member of the same org sees nothing.
    const asBob = await t
      .withIdentity({ subject: BOB })
      .query(api.chat.messages.listMessages, {
        organizationId: ORG_A,
        threadId,
      });
    expect(asBob).toHaveLength(0);

    // The same user, asking under a different org, sees nothing.
    const asAliceInB = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.messages.listMessages, {
        organizationId: ORG_B,
        threadId,
      });
    expect(asAliceInB).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getOrgChatHealth — the aggregation contract: assistant rows are the turns,
// error/blocked classification, token sums, model/agent breakdowns, and the
// admin gate. Rows are seeded oldest-first so `_creationTime` order matches
// the `createdAt` monotonicity the newest-first walk relies on.
// ---------------------------------------------------------------------------

const ADMIN = 'user_admin';

interface MessageSeed {
  threadId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  createdAt: number;
  model?: string;
  providerSlug?: string;
  usage?: unknown;
  blockedReason?: string;
  error?: string;
}

/** Insert messages as given — callers list them OLDEST FIRST. */
async function seedMessages(
  t: T,
  organizationId: string,
  seeds: MessageSeed[],
): Promise<void> {
  await t.run(async (ctx) => {
    let sequence = 0;
    for (const seed of seeds) {
      await ctx.db.insert('messages', {
        organizationId,
        threadId: seed.threadId,
        role: seed.role,
        parts: [],
        sequence: sequence++,
        ...(seed.model !== undefined && { model: seed.model }),
        ...(seed.providerSlug !== undefined && {
          providerSlug: seed.providerSlug,
        }),
        ...(seed.usage !== undefined && { usage: seed.usage }),
        ...(seed.blockedReason !== undefined && {
          blockedReason: seed.blockedReason,
        }),
        ...(seed.error !== undefined && { error: seed.error }),
        createdAt: seed.createdAt,
      });
    }
  });
}

describe('getOrgChatHealth', () => {
  it('aggregates turns, errors, blocks, tokens, and breakdowns from assistant rows', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ADMIN, ORG_A, 'admin');
    const pinnedThread = await seedThread(t, ORG_A, ALICE, 'helper');
    const bareThread = await seedThread(t, ORG_A, ALICE);

    const now = Date.now();
    const hour = 60 * 60 * 1000;
    await seedMessages(t, ORG_A, [
      // Out of the 7-day window — proves the walk stops there while still
      // marking the org as having data.
      {
        threadId: pinnedThread,
        role: 'assistant',
        createdAt: now - 10 * DAY_MS,
        model: 'old-model',
      },
      // User rows are scanned but never counted as turns.
      { threadId: pinnedThread, role: 'user', createdAt: now - 5 * hour },
      {
        threadId: pinnedThread,
        role: 'assistant',
        createdAt: now - 5 * hour + 1,
        model: 'gpt-4o',
        providerSlug: 'openai',
        usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
      },
      {
        threadId: pinnedThread,
        role: 'assistant',
        createdAt: now - 4 * hour,
        model: 'gpt-4o',
        providerSlug: 'openai',
        // Malformed usage blob — read defensively as zero.
        usage: 'not-an-object',
        blockedReason: 'pii',
      },
      {
        threadId: bareThread,
        role: 'assistant',
        createdAt: now - 3 * hour,
        model: 'sonnet',
        providerSlug: 'anthropic',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
      // Enveloped error — the structured code wins over re-classification.
      {
        threadId: bareThread,
        role: 'assistant',
        createdAt: now - 2 * hour,
        model: 'sonnet',
        providerSlug: 'anthropic',
        error: encodeChatError({ code: 'auth_error', raw: 'HTTP 401' }),
      },
      // Raw legacy error string — classified by pattern.
      {
        threadId: bareThread,
        role: 'assistant',
        createdAt: now - hour,
        error: 'Rate limit reached: too many requests (429)',
      },
    ]);

    const result = await t
      .withIdentity({ subject: ADMIN })
      .query(api.chat.messages.getOrgChatHealth, {
        organizationId: ORG_A,
        periodDays: 7,
      });

    expect(result.summary).toEqual({
      totalTurns: 5,
      errorCount: 2,
      errorRate: 2 / 5,
      blockedCount: 1,
      blockedRate: 1 / 5,
      tokens: { input: 110, output: 45, total: 155 },
      capped: false,
      hasAnyData: true,
    });

    expect(result.series).toHaveLength(7);
    const sum = result.series.reduce(
      (acc, point) => ({
        turns: acc.turns + point.turns,
        errors: acc.errors + point.errors,
        blocked: acc.blocked + point.blocked,
      }),
      { turns: 0, errors: 0, blocked: 0 },
    );
    expect(sum).toEqual({ turns: 5, errors: 2, blocked: 1 });

    // Counts tie at 2; the stable sort keeps first-seen (newest-first walk)
    // order, and the newest model row is sonnet's.
    expect(result.byModel).toEqual([
      { provider: 'anthropic', model: 'sonnet', count: 2 },
      { provider: 'openai', model: 'gpt-4o', count: 2 },
    ]);
    expect(result.byAgent).toEqual([
      { agentSlug: '__unattributed__', count: 3 },
      { agentSlug: 'helper', count: 2 },
    ]);
    expect(result.errorsByType).toEqual([
      { key: 'rate_limited', count: 1 },
      { key: 'auth_error', count: 1 },
    ]);
    // Newest error first; the unattributed thread omits agentSlug.
    expect(result.recentErrors).toEqual([
      { at: now - hour, type: 'rate_limited' },
      { at: now - 2 * hour, type: 'auth_error', model: 'sonnet' },
    ]);
  });

  it('reports hasAnyData=false for an org with no messages', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ADMIN, ORG_A, 'admin');

    const result = await t
      .withIdentity({ subject: ADMIN })
      .query(api.chat.messages.getOrgChatHealth, {
        organizationId: ORG_A,
        periodDays: 1,
      });

    expect(result.summary.hasAnyData).toBe(false);
    expect(result.summary.totalTurns).toBe(0);
    expect(result.byModel).toEqual([]);
    expect(result.recentErrors).toEqual([]);
  });

  it('refuses non-admin members and unauthenticated callers', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ADMIN, ORG_A, 'admin');
    await seedMember(t, ALICE, ORG_A);

    await expect(
      t
        .withIdentity({ subject: ALICE })
        .query(api.chat.messages.getOrgChatHealth, {
          organizationId: ORG_A,
          periodDays: 7,
        }),
    ).rejects.toThrow(/Only admins/);

    await expect(
      t.query(api.chat.messages.getOrgChatHealth, {
        organizationId: ORG_A,
        periodDays: 7,
      }),
    ).rejects.toThrow(/Unauthenticated/);
  });
});
