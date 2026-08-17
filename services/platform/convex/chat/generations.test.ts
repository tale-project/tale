/**
 * The generation row's cancel and recovery contracts. The stop button
 * (`requestCancelGeneration`) only flags the OWNER's live turn, and the flag
 * travels back on the next streaming write — `streamProgressInternal` doubles
 * as the turn's cancel poll, so the loop aborts without a second read. The
 * stale-generation sweep must rescue a streamed partial by APPENDING to the
 * parts that already settled (a tool loop's calls and results), never by
 * replacing them.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

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
): Promise<Id<'threads'>> {
  return t.run(async (ctx) =>
    ctx.db.insert('threads', {
      organizationId,
      userId,
      kind: 'direct',
      archived: false,
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

function readGeneration(t: T, threadId: Id<'threads'>) {
  return t.run(async (ctx) =>
    ctx.db
      .query('generations')
      .withIndex('by_thread', (q) => q.eq('threadId', threadId))
      .first(),
  );
}

const ORG_A = 'org_a';
const ALICE = 'user_alice';
const BOB = 'user_bob';

describe('requestCancelGeneration', () => {
  it('lets the owner flag the live turn, and the next streaming write reads it back', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const threadId = await seedThread(t, ORG_A, ALICE);
    await t.mutation(internal.chat.generations.beginGenerationInternal, {
      organizationId: ORG_A,
      threadId,
    });

    const stopped = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.generations.requestCancelGeneration, {
        organizationId: ORG_A,
        threadId,
      });
    expect(stopped).toEqual({ stopped: true });
    expect((await readGeneration(t, threadId))?.cancelRequested).toBe(true);

    // The write doubles as the cancel poll: the streaming loop learns of the
    // stop from its own progress write, no second read.
    const progress = await t.mutation(
      internal.chat.generations.streamProgressInternal,
      { organizationId: ORG_A, threadId, text: 'partial so far' },
    );
    expect(progress).toEqual({ cancelRequested: true });
    expect((await readGeneration(t, threadId))?.streamText).toBe(
      'partial so far',
    );
  });

  it('does not let another member stop someone else’s turn', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    await seedMember(t, BOB, ORG_A);
    const threadId = await seedThread(t, ORG_A, ALICE);
    await t.mutation(internal.chat.generations.beginGenerationInternal, {
      organizationId: ORG_A,
      threadId,
    });

    const stopped = await t
      .withIdentity({ subject: BOB })
      .mutation(api.chat.generations.requestCancelGeneration, {
        organizationId: ORG_A,
        threadId,
      });
    expect(stopped).toEqual({ stopped: false });
    // The turn keeps streaming: nothing was flagged.
    expect(
      (await readGeneration(t, threadId))?.cancelRequested,
    ).toBeUndefined();
    const progress = await t.mutation(
      internal.chat.generations.streamProgressInternal,
      { organizationId: ORG_A, threadId, text: 'still going' },
    );
    expect(progress).toEqual({ cancelRequested: false });
  });

  it('is a no-op when the thread has no live turn', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const threadId = await seedThread(t, ORG_A, ALICE);

    const stopped = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.generations.requestCancelGeneration, {
        organizationId: ORG_A,
        threadId,
      });
    expect(stopped).toEqual({ stopped: false });
  });
});

describe('streamProgressInternal', () => {
  it('answers an idle thread with cancelRequested:false and writes nothing', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);

    const progress = await t.mutation(
      internal.chat.generations.streamProgressInternal,
      { organizationId: ORG_A, threadId, text: 'orphan write' },
    );

    expect(progress).toEqual({ cancelRequested: false });
    // The settled turn stays settled: no row is resurrected for a late write.
    expect(await readGeneration(t, threadId)).toBeNull();
  });
});

describe('recoverStaleDirectGenerations', () => {
  it('appends the rescued partial AFTER the parts that already settled', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t, ORG_A, ALICE);
    const toolCall = {
      type: 'tool-call',
      toolCallId: 'c1',
      toolName: 'rag_search',
      input: { query: 'refunds' },
    };
    const toolResult = {
      type: 'tool-result',
      toolCallId: 'c1',
      output: { status: 'ok', results: [] },
    };
    const { id: messageId } = await t.mutation(
      internal.chat.messages.appendMessageInternal,
      {
        organizationId: ORG_A,
        threadId,
        role: 'assistant',
        parts: [toolCall, toolResult],
      },
    );
    // A hard-killed turn: the generation row went stale mid-stream with the
    // partial text on it and the settled tool rounds on the message.
    await t.run(async (ctx) => {
      await ctx.db.insert('generations', {
        organizationId: ORG_A,
        threadId,
        status: 'streaming',
        messageId,
        streamText: 'partial answer',
        streamReasoning: 'thinking',
        startedAt: 0,
        heartbeatAt: 0,
      });
    });

    const cleared = await t.mutation(
      internal.chat.generations.recoverStaleDirectGenerations,
      {},
    );
    expect(cleared).toBe(1);

    const message = await t.run(async (ctx) => ctx.db.get(messageId));
    // Rescue APPENDS — the record of what the turn did is never erased.
    expect(message?.parts).toEqual([
      toolCall,
      toolResult,
      { type: 'reasoning', text: 'thinking' },
      { type: 'text', text: 'partial answer' },
    ]);
    expect(message?.error).toMatch(/interrupted/);
    expect(await readGeneration(t, threadId)).toBeNull();
  });
});

describe('getGenerationText', () => {
  it('piggybacks serverNow on the live object only', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const threadId = await seedThread(t, ORG_A, ALICE);

    const idle = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.generations.getGenerationText, {
        organizationId: ORG_A,
        threadId,
      });
    expect(idle).toBeNull();

    await t.mutation(internal.chat.generations.beginGenerationInternal, {
      organizationId: ORG_A,
      threadId,
    });
    const before = Date.now();
    const live = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.generations.getGenerationText, {
        organizationId: ORG_A,
        threadId,
      });
    const after = Date.now();
    expect(live).toEqual(
      expect.objectContaining({
        text: '',
        serverNow: expect.any(Number),
      }),
    );
    if (live === null) throw new Error('expected a live generation');
    expect(live.serverNow).toBeGreaterThanOrEqual(before);
    expect(live.serverNow).toBeLessThanOrEqual(after);
  });
});
