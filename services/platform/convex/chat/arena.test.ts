/**
 * Arena Mode's contract: the pair is two ordinary threads, the exit is three
 * patches (never a message migration), and a verdict lands in the analytics
 * reader's exact row shape. The last suite runs `computeFeedbackStats` over
 * the row settle actually wrote — that is the compatibility bar with the
 * surviving feedback analytics page.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { computeFeedbackStats } from '../feedback/stats';
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

const ORG_A = 'org_a';
const ALICE = 'user_alice';

async function seedMember(
  t: T,
  userId: string,
  organizationId: string,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}_${organizationId}`,
      userId,
      organizationId,
      role: 'member',
      createdAt: 0,
    });
  });
}

async function createThread(
  t: T,
  userId: string,
  kind: 'direct' | 'sandbox' = 'direct',
): Promise<string> {
  return t
    .withIdentity({ subject: userId })
    .mutation(api.chat.threads.createThread, {
      organizationId: ORG_A,
      kind,
      title: 'Arena source',
    });
}

async function appendMessage(
  t: T,
  threadId: string,
  role: 'user' | 'assistant',
  text: string,
  model?: string,
): Promise<void> {
  await t.mutation(internal.chat.messages.appendMessageInternal, {
    organizationId: ORG_A,
    threadId,
    role,
    parts: [{ type: 'text', text }],
    ...(model !== undefined ? { model } : {}),
  });
}

async function getThread(t: T, threadId: string): Promise<Doc<'threads'>> {
  return t.run(async (ctx) => {
    const normalized = ctx.db.normalizeId('threads', threadId);
    const thread = normalized ? await ctx.db.get(normalized) : null;
    if (!thread) throw new Error(`thread ${threadId} vanished`);
    return thread;
  });
}

async function ensurePair(
  t: T,
  threadId: string,
): Promise<{ threadIdA: string; threadIdB: string }> {
  const result = await t
    .withIdentity({ subject: ALICE })
    .mutation(api.chat.arena.ensureArenaPair, {
      organizationId: ORG_A,
      threadId,
    });
  if ('refused' in result || result.threadIdB === undefined) {
    throw new Error(`pairing refused: ${JSON.stringify(result)}`);
  }
  return { threadIdA: threadId, threadIdB: result.threadIdB };
}

describe('arena pair lifecycle', () => {
  it('copies the whole history into a hidden column B and is idempotent', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const threadId = await createThread(t, ALICE);
    await appendMessage(t, threadId, 'user', 'Compare yourselves.');
    await appendMessage(t, threadId, 'assistant', 'Gladly.', 'model-alpha');

    const { threadIdB } = await ensurePair(t, threadId);

    const b = await getThread(t, threadIdB);
    expect(b.hidden).toBe(true);
    expect(b.branchRootId).toBe(threadId);
    expect(b.branchParentId).toBeUndefined();
    expect(b.title).toBe('Arena source');
    expect(b.arena?.role).toBe('b');
    expect(b.arena?.partnerThreadId).toBe(threadId);

    const a = await getThread(t, threadId);
    expect(a.arena?.role).toBe('a');
    expect(a.arena?.partnerThreadId).toBe(threadIdB);
    expect(a.arena?.pairId).toBe(b.arena?.pairId);

    const copied = await t.run(async (ctx) =>
      ctx.db
        .query('messages')
        .withIndex('by_thread_sequence', (q) => q.eq('threadId', threadIdB))
        .collect(),
    );
    expect(copied.map((m) => m.sequence)).toEqual([0, 1]);
    expect(copied[1]?.model).toBe('model-alpha');

    // Second ensure returns the SAME partner — no duplicate column.
    const again = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.arena.ensureArenaPair, {
        organizationId: ORG_A,
        threadId,
      });
    expect(again).toEqual({ threadIdB });
  });

  it('refuses structurally unfit threads: sandbox, shared, archived, busy', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const asAlice = t.withIdentity({ subject: ALICE });

    const sandbox = await createThread(t, ALICE, 'sandbox');
    expect(
      await asAlice.mutation(api.chat.arena.ensureArenaPair, {
        organizationId: ORG_A,
        threadId: sandbox,
      }),
    ).toEqual({ refused: 'sandbox' });

    const shared = await createThread(t, ALICE);
    await asAlice.mutation(api.chat.threads.shareThread, {
      organizationId: ORG_A,
      threadId: shared,
    });
    expect(
      await asAlice.mutation(api.chat.arena.ensureArenaPair, {
        organizationId: ORG_A,
        threadId: shared,
      }),
    ).toEqual({ refused: 'shared' });

    const archived = await createThread(t, ALICE);
    await asAlice.mutation(api.chat.threads.setThreadArchived, {
      organizationId: ORG_A,
      threadId: archived,
      archived: true,
    });
    expect(
      await asAlice.mutation(api.chat.arena.ensureArenaPair, {
        organizationId: ORG_A,
        threadId: archived,
      }),
    ).toEqual({ refused: 'archived' });

    const busy = await createThread(t, ALICE);
    await t.run(async (ctx) => {
      await ctx.db.insert('generations', {
        organizationId: ORG_A,
        threadId: busy,
        status: 'streaming',
        streamId: 'stream-1',
        startedAt: Date.now(),
        heartbeatAt: Date.now(),
      });
    });
    expect(
      await asAlice.mutation(api.chat.arena.ensureArenaPair, {
        organizationId: ORG_A,
        threadId: busy,
      }),
    ).toEqual({ refused: 'busy' });
  });

  it('resolves the pair from either column and hides it from the branch navigator', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const threadId = await createThread(t, ALICE);
    const { threadIdB } = await ensurePair(t, threadId);
    const asAlice = t.withIdentity({ subject: ALICE });

    const fromA = await asAlice.query(api.chat.arena.getArenaPair, {
      organizationId: ORG_A,
      threadId,
    });
    const fromB = await asAlice.query(api.chat.arena.getArenaPair, {
      organizationId: ORG_A,
      threadId: threadIdB,
    });
    expect(fromA).not.toBeNull();
    expect(fromA).toEqual(fromB);
    expect(fromA?.threadIdA).toBe(threadId);
    expect(fromA?.threadIdB).toBe(threadIdB);

    // The arena column shares the lineage (trash cascade) but must not
    // surface as an edit sibling.
    const branches = await asAlice.query(api.chat.branches.listThreadBranches, {
      organizationId: ORG_A,
      rootThreadId: threadId,
    });
    expect(branches.branches).toEqual([]);
  });
});

describe('arena settle', () => {
  async function pairWithReplies(t: T): Promise<{
    threadIdA: string;
    threadIdB: string;
  }> {
    const threadId = await createThread(t, ALICE);
    await appendMessage(t, threadId, 'user', 'Question?');
    const pair = await ensurePair(t, threadId);
    await appendMessage(t, pair.threadIdA, 'assistant', 'Answer A', 'model-a');
    await appendMessage(t, pair.threadIdB, 'assistant', 'Answer B', 'model-b');
    return pair;
  }

  it('a_better keeps A visible, buries B, and records a positive verdict row', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const { threadIdA, threadIdB } = await pairWithReplies(t);

    const settled = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.arena.settleArenaPair, {
        organizationId: ORG_A,
        threadId: threadIdA,
        verdict: 'a_better',
      });
    expect(settled).toEqual({ continueThreadId: threadIdA });

    const a = await getThread(t, threadIdA);
    const b = await getThread(t, threadIdB);
    expect(a.arena).toBeUndefined();
    expect(a.hidden).toBeUndefined();
    expect(a.archived).toBe(false);
    expect(b.arena).toBeUndefined();
    expect(b.hidden).toBe(true);
    expect(b.archived).toBe(true);
    // The losing B stays in A's lineage so trashing A purges it too.
    expect(b.branchRootId).toBe(threadIdA);

    const rows = await t.run(async (ctx) =>
      ctx.db.query('messageFeedback').collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      threadId: threadIdA,
      messageId: 'arena:model-a:model-b',
      rating: 'positive',
      userId: ALICE,
      metadata: {
        arenaVerdict: 'a_better',
        modelA: 'model-a',
        modelB: 'model-b',
      },
    });

    // Settling again refuses — the pair is gone.
    const again = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.arena.settleArenaPair, {
        organizationId: ORG_A,
        threadId: threadIdA,
        verdict: 'a_better',
      });
    expect(again).toEqual({ refused: 'not_found' });
  });

  it('b_better graduates B to a standalone visible conversation', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const { threadIdA, threadIdB } = await pairWithReplies(t);

    const settled = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.arena.settleArenaPair, {
        organizationId: ORG_A,
        threadId: threadIdA,
        verdict: 'b_better',
      });
    expect(settled).toEqual({ continueThreadId: threadIdB });

    const a = await getThread(t, threadIdA);
    const b = await getThread(t, threadIdB);
    expect(b.hidden).toBeUndefined();
    expect(b.branchRootId).toBeUndefined();
    expect(b.arena).toBeUndefined();
    expect(a.hidden).toBe(true);
    expect(a.archived).toBe(true);

    // The winner now lists in the sidebar; the loser does not.
    const listed = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.listThreads, { organizationId: ORG_A });
    const ids = listed.map((row) => String(row.id));
    expect(ids).toContain(threadIdB);
    expect(ids).not.toContain(threadIdA);
  });

  it('both_bad records a negative rating and continues on A', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const { threadIdA } = await pairWithReplies(t);

    const settled = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.arena.settleArenaPair, {
        organizationId: ORG_A,
        threadId: threadIdA,
        verdict: 'both_bad',
      });
    expect(settled).toEqual({ continueThreadId: threadIdA });

    const rows = await t.run(async (ctx) =>
      ctx.db.query('messageFeedback').collect(),
    );
    expect(rows[0]?.rating).toBe('negative');
  });

  it('exits without a verdict leaving no data point', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const { threadIdA, threadIdB } = await pairWithReplies(t);

    const settled = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.arena.settleArenaPair, {
        organizationId: ORG_A,
        threadId: threadIdA,
      });
    expect(settled).toEqual({ continueThreadId: threadIdA });
    expect(
      await t.run(async (ctx) => ctx.db.query('messageFeedback').collect()),
    ).toHaveLength(0);

    const b = await getThread(t, threadIdB);
    expect(b.hidden).toBe(true);
    expect(b.archived).toBe(true);
  });

  it('refuses to settle while a column is generating, and skips the row when a side never answered', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const threadId = await createThread(t, ALICE);
    const { threadIdA, threadIdB } = await ensurePair(t, threadId);
    const asAlice = t.withIdentity({ subject: ALICE });

    const generationId = await t.run(async (ctx) =>
      ctx.db.insert('generations', {
        organizationId: ORG_A,
        threadId: threadIdB,
        status: 'streaming',
        streamId: 'stream-b',
        startedAt: Date.now(),
        heartbeatAt: Date.now(),
      }),
    );
    expect(
      await asAlice.mutation(api.chat.arena.settleArenaPair, {
        organizationId: ORG_A,
        threadId: threadIdA,
        verdict: 'a_better',
      }),
    ).toEqual({ refused: 'busy' });

    await t.run(async (ctx) => ctx.db.delete(generationId));
    // No assistant replies exist — the settle succeeds but records nothing.
    const settled = await asAlice.mutation(api.chat.arena.settleArenaPair, {
      organizationId: ORG_A,
      threadId: threadIdA,
      verdict: 'a_better',
    });
    expect(settled).toEqual({ continueThreadId: threadIdA });
    expect(
      await t.run(async (ctx) => ctx.db.query('messageFeedback').collect()),
    ).toHaveLength(0);
  });
});

describe('arena guards on sibling mutations', () => {
  it('share, archive, fork, and edit-branch all refuse a live column', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const threadId = await createThread(t, ALICE);
    await appendMessage(t, threadId, 'user', 'Hold this.');
    await ensurePair(t, threadId);
    const asAlice = t.withIdentity({ subject: ALICE });

    expect(
      await asAlice.mutation(api.chat.threads.shareThread, {
        organizationId: ORG_A,
        threadId,
      }),
    ).toBeNull();
    expect(
      await asAlice.mutation(api.chat.threads.setThreadArchived, {
        organizationId: ORG_A,
        threadId,
        archived: true,
      }),
    ).toBe(false);

    const userMessage = await t.run(async (ctx) =>
      ctx.db
        .query('messages')
        .withIndex('by_thread_sequence', (q) => q.eq('threadId', threadId))
        .first(),
    );
    if (!userMessage) throw new Error('seeded message missing');
    expect(
      await asAlice.mutation(api.chat.threads.branchThread, {
        organizationId: ORG_A,
        threadId,
        fromMessageId: String(userMessage._id),
      }),
    ).toBeNull();
    expect(
      await asAlice.mutation(api.chat.branches.branchForEdit, {
        organizationId: ORG_A,
        threadId,
        editedMessageId: String(userMessage._id),
      }),
    ).toBeNull();
  });
});

describe('arena analytics contract', () => {
  it('the row settle writes is counted by computeFeedbackStats', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const threadId = await createThread(t, ALICE);
    await appendMessage(t, threadId, 'user', 'Which is better?');
    const pair = await ensurePair(t, threadId);
    await appendMessage(t, pair.threadIdA, 'assistant', 'A says', 'model-a');
    await appendMessage(t, pair.threadIdB, 'assistant', 'B says', 'model-b');
    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.arena.settleArenaPair, {
        organizationId: ORG_A,
        threadId: pair.threadIdA,
        verdict: 'b_better',
      });

    const rows = await t.run(async (ctx) =>
      ctx.db.query('messageFeedback').collect(),
    );
    const stats = computeFeedbackStats(rows, {
      cutoffMs: null,
      maxScan: 1000,
    });
    expect(stats.arena.total).toBe(1);
    expect(stats.arena.byVerdict.b_better).toBe(1);
    // The matchup table attributes the win to the right model.
    expect(stats.topMatchups).toHaveLength(1);
    const matchup = stats.topMatchups[0];
    expect(matchup?.modelLeft).toBe('model-a');
    expect(matchup?.modelRight).toBe('model-b');
    // b_better with canonical order (model-a < model-b) = a win for the right.
    expect(matchup?.rightWins).toBe(1);
    // Arena rows never leak into the message thumbs counters.
    expect(stats.message.total).toBe(0);
  });
});
