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

describe('chat messages — thread title scheduling', () => {
  /** The generateThreadTitle jobs the append left behind (we assert the
   * schedule, never run it — the job's model call has no provider here). */
  async function scheduledTitleJobs(t: T) {
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    return scheduled.filter((job) => job.name.includes('generateThreadTitle'));
  }

  it('schedules title generation for the first user message of an untitled thread', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);

    await t.mutation(internal.chat.messages.appendMessageInternal, {
      organizationId: ORG_A,
      threadId,
      role: 'user',
      parts: [{ type: 'text', text: 'How do I configure git?' }],
    });

    const jobs = await scheduledTitleJobs(t);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.args[0]).toMatchObject({
      organizationId: ORG_A,
      threadId,
      userId: ALICE,
      firstMessage: 'How do I configure git?',
    });
  });

  it('schedules exactly once — never for the messages that follow', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);

    for (const [role, text] of [
      ['user', 'first'],
      ['assistant', 'reply'],
      ['user', 'second'],
    ] as const) {
      await t.mutation(internal.chat.messages.appendMessageInternal, {
        organizationId: ORG_A,
        threadId,
        role,
        parts: [{ type: 'text', text }],
      });
    }

    const jobs = await scheduledTitleJobs(t);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.args[0]).toMatchObject({ firstMessage: 'first' });
  });

  it('does not schedule for an assistant opener, a titled thread, or an empty message', async () => {
    const t = convexTest(schema, modules);

    // Assistant first (an external turn refused before start).
    const refused = await seedThread(t, ORG_A, ALICE);
    await t.mutation(internal.chat.messages.appendMessageInternal, {
      organizationId: ORG_A,
      threadId: refused,
      role: 'assistant',
      parts: [{ type: 'text', text: 'No model is configured.' }],
    });

    // Already titled (a branch copy carries its parent's title).
    const titled = await t.run(async (ctx) =>
      ctx.db.insert('threads', {
        organizationId: ORG_A,
        userId: ALICE,
        kind: 'direct',
        title: 'Carried over',
        archived: false,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    await t.mutation(internal.chat.messages.appendMessageInternal, {
      organizationId: ORG_A,
      threadId: titled,
      role: 'user',
      parts: [{ type: 'text', text: 'more' }],
    });

    // Nothing to name a thread after.
    const empty = await seedThread(t, ORG_A, ALICE);
    await t.mutation(internal.chat.messages.appendMessageInternal, {
      organizationId: ORG_A,
      threadId: empty,
      role: 'user',
      parts: [{ type: 'text', text: '   ' }],
    });

    expect(await scheduledTitleJobs(t)).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// finalizeAssistantMessageInternal / updateAssistantPartsInternal — the tool
// loop's settle path. The direct pipeline sends the complete ordered `parts`
// (authoritative, written verbatim); a failure finalize sends none, and the
// tool calls and results of rounds that already ran must survive it.
// ---------------------------------------------------------------------------

async function seedAssistantMessage(
  t: T,
  threadId: Id<'threads'>,
  parts: unknown[],
): Promise<Id<'messages'>> {
  const { id } = await t.mutation(
    internal.chat.messages.appendMessageInternal,
    {
      organizationId: ORG_A,
      threadId,
      role: 'assistant',
      parts,
    },
  );
  return id;
}

function readMessage(t: T, id: Id<'messages'>) {
  return t.run(async (ctx) => ctx.db.get(id));
}

const TOOL_CALL_PART = {
  type: 'tool-call',
  toolCallId: 'c1',
  toolName: 'rag_search',
  input: { query: 'refunds' },
};
const TOOL_RESULT_PART = {
  type: 'tool-result',
  toolCallId: 'c1',
  output: { status: 'ok', results: [] },
};

describe('finalizeAssistantMessageInternal', () => {
  it('writes caller-supplied parts verbatim — tool calls and results in order', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    const messageId = await seedAssistantMessage(t, threadId, []);

    const parts = [
      { type: 'text', text: 'Let me look that up.' },
      TOOL_CALL_PART,
      TOOL_RESULT_PART,
      { type: 'text', text: 'Here is what I found.' },
    ];
    await t.mutation(internal.chat.messages.finalizeAssistantMessageInternal, {
      organizationId: ORG_A,
      messageId,
      // Content args are ignored when the authoritative `parts` is present.
      finalText: 'MUST NOT APPEAR',
      reasoning: 'MUST NOT APPEAR',
      parts,
      model: 'test-model',
      providerSlug: 'test-provider',
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    });

    const row = await readMessage(t, messageId);
    expect(row?.parts).toEqual(parts);
    expect(row?.model).toBe('test-model');
    expect(row?.usage).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
    });
    expect(row?.error).toBeUndefined();
  });

  it('preserves settled tool parts on a failure finalize, replacing only the text', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    const messageId = await seedAssistantMessage(t, threadId, [
      { type: 'text', text: 'streamed partial' },
      TOOL_CALL_PART,
      TOOL_RESULT_PART,
    ]);

    // A mid-stream failure: no `parts`, no `finalText` — only the error.
    await t.mutation(internal.chat.messages.finalizeAssistantMessageInternal, {
      organizationId: ORG_A,
      messageId,
      error: 'provider died mid-answer',
    });

    const row = await readMessage(t, messageId);
    // The tool record survives (order kept); the row's own text settles as
    // the trailing text part.
    expect(row?.parts).toEqual([
      TOOL_CALL_PART,
      TOOL_RESULT_PART,
      { type: 'text', text: 'streamed partial' },
    ]);
    expect(row?.error).toBe('provider died mid-answer');
  });

  it('merges usage so a client-stamped wait survives finalize', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    const messageId = await seedAssistantMessage(t, threadId, []);
    await t.run(async (ctx) => {
      await ctx.db.patch(messageId, { usage: { perceivedWaitMs: 6400 } });
    });

    await t.mutation(internal.chat.messages.finalizeAssistantMessageInternal, {
      organizationId: ORG_A,
      messageId,
      parts: [{ type: 'text', text: 'done' }],
      usage: { durationMs: 2000, timeToFirstTokenMs: 400 },
    });

    const row = await readMessage(t, messageId);
    expect(row?.usage).toEqual({
      perceivedWaitMs: 6400,
      durationMs: 2000,
      timeToFirstTokenMs: 400,
    });
  });
});

describe('reportPerceivedWait', () => {
  it('stamps a duration once, first-write-wins, owner only', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    await seedMember(t, BOB, ORG_A);
    const threadId = await seedThread(t, ORG_A, ALICE);
    const messageId = await seedAssistantMessage(t, threadId, [
      { type: 'text', text: 'hi' },
    ]);

    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.messages.reportPerceivedWait, {
        organizationId: ORG_A,
        messageId,
        perceivedWaitMs: 5500,
      });
    expect((await readMessage(t, messageId))?.usage).toEqual({
      perceivedWaitMs: 5500,
    });

    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.messages.reportPerceivedWait, {
        organizationId: ORG_A,
        messageId,
        perceivedWaitMs: 100,
      });
    expect((await readMessage(t, messageId))?.usage).toEqual({
      perceivedWaitMs: 5500,
    });

    await expect(
      t
        .withIdentity({ subject: BOB })
        .mutation(api.chat.messages.reportPerceivedWait, {
          organizationId: ORG_A,
          messageId,
          perceivedWaitMs: 200,
        }),
    ).rejects.toThrow();
  });

  it('ignores a non-positive or over-long duration', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const threadId = await seedThread(t, ORG_A, ALICE);
    const messageId = await seedAssistantMessage(t, threadId, [
      { type: 'text', text: 'hi' },
    ]);

    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.messages.reportPerceivedWait, {
        organizationId: ORG_A,
        messageId,
        perceivedWaitMs: 0,
      });
    expect((await readMessage(t, messageId))?.usage).toBeUndefined();

    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.messages.reportPerceivedWait, {
        organizationId: ORG_A,
        messageId,
        perceivedWaitMs: 31 * 60 * 1000,
      });
    expect((await readMessage(t, messageId))?.usage).toBeUndefined();
  });
});

describe('updateAssistantPartsInternal', () => {
  it('patches the parts-so-far in place', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    const messageId = await seedAssistantMessage(t, threadId, []);

    const settled = [
      { type: 'text', text: 'Checking…' },
      TOOL_CALL_PART,
      TOOL_RESULT_PART,
    ];
    await t.mutation(internal.chat.messages.updateAssistantPartsInternal, {
      organizationId: ORG_A,
      messageId,
      parts: settled,
    });

    expect((await readMessage(t, messageId))?.parts).toEqual(settled);
  });

  it('is a no-op for a message in another organization', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    const messageId = await seedAssistantMessage(t, threadId, [
      { type: 'text', text: 'original' },
    ]);

    await t.mutation(internal.chat.messages.updateAssistantPartsInternal, {
      organizationId: ORG_B,
      messageId,
      parts: [{ type: 'text', text: 'overwritten' }],
    });

    expect((await readMessage(t, messageId))?.parts).toEqual([
      { type: 'text', text: 'original' },
    ]);
  });
});
