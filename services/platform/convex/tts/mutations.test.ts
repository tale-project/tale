/**
 * The TTS reservation state machine. `reserveChunk` is the single gate every
 * synthesis passes through, and its contract carries real money: a cache hit
 * must never re-bill, a stale attempt must never land its result on a
 * fresh reservation, and a guessed messageId must never let one user read
 * another conversation's audio. These tests pin each of those edges.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';

import { api, internal } from '../_generated/api';
import betterAuthSchema from '../betterAuth/schema';
import schema from '../schema';

// The rate-limiter component is not registered in convex-test; stub the
// wrapper with a controllable gate so the RATE_LIMITED branch stays testable.
const limitMock = vi.fn(async () => ({ ok: true, retryAfter: 0 }));
vi.mock('../lib/rate_limiter', () => ({
  rateLimiter: {
    limit: (...args: unknown[]) => limitMock(...(args as [])),
  },
}));

const TEST_DIR_FROM_CONVEX_ROOT = 'tts';
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
const authModules = import.meta.glob('../betterAuth/**/*.*s');

/** `reserveChunk`'s budget context walks the betterAuth adapter, so the
 * component must be live in the test world. */
function newWorld(): T {
  const t = convexTest(schema, modules);
  t.registerComponent('betterAuth', betterAuthSchema, authModules);
  return t;
}

type T = TestConvex<typeof schema>;

const ORG_A = 'org_a';
const ALICE = 'user_alice';
const BOB = 'user_bob';

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

async function createThread(t: T, userId: string): Promise<string> {
  return t
    .withIdentity({ subject: userId })
    .mutation(api.chat.threads.createThread, {
      organizationId: ORG_A,
      kind: 'direct',
      title: 'Voice thread',
    });
}

function reserveArgs(threadId: string, overrides?: Record<string, unknown>) {
  return {
    messageId: 'msg_1',
    threadId,
    organizationId: ORG_A,
    index: 0,
    text: 'Hello there, listener.',
    locale: 'en',
    ...overrides,
  };
}

// Structural (not instanceof) probing: the ConvexError class inside the
// convex-test runtime is a different module instance than this file's
// import, so `instanceof` cannot see across.
async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err && typeof err === 'object' && 'data' in err) {
      const data = (err as { data?: unknown }).data;
      if (data && typeof data === 'object' && 'code' in data) {
        const code = (data as { code?: unknown }).code;
        if (typeof code === 'string') return code;
      }
    }
    if (err instanceof Error) {
      const match = err.message.match(/"code"\s*:\s*"([A-Za-z_]+)"/);
      if (match?.[1]) return match[1];
    }
    throw err;
  }
  throw new Error('expected the call to throw');
}

describe('tts reserveChunk — state machine', () => {
  it('reserves a fresh chunk, refuses a second writer, and marks ready once', async () => {
    const t = newWorld();
    await seedMember(t, ALICE, ORG_A);
    const threadId = await createThread(t, ALICE);
    const asAlice = t.withIdentity({ subject: ALICE });

    const first = await asAlice.mutation(
      internal.tts.mutations.reserveChunk,
      reserveArgs(threadId),
    );
    expect(first.kind).toBe('reserved');
    if (first.kind !== 'reserved') return;

    // A parallel writer sees the live pending row and backs off.
    const second = await asAlice.mutation(
      internal.tts.mutations.reserveChunk,
      reserveArgs(threadId),
    );
    expect(second.kind).toBe('pending-in-flight');

    const marked = await asAlice.mutation(
      internal.tts.mutations.markChunkReadyAndRecordUsage,
      {
        chunkId: first.chunkId,
        attemptCreatedAt: first.attemptCreatedAt,
        storageId: 's3:test/audio-0.mp3',
        voice: 'alloy',
        providerName: 'openai',
        modelId: 'gpt-4o-mini-tts',
        format: 'mp3' as const,
        characterCount: 22,
        costEstimateCents: 1,
      },
    );
    expect(marked).toEqual({ stale: false });

    await t.run(async (ctx) => {
      const row = await ctx.db.get(first.chunkId);
      expect(row?.status).toBe('ready');
      expect(row?.storageId).toBe('s3:test/audio-0.mp3');
      expect(row?.usageRecordedAt).toBeDefined();
      // Ledger atomicity: the same transaction wrote the usage rows.
      const ledger = await ctx.db.query('usageLedger').collect();
      expect(ledger.length).toBeGreaterThan(0);
      expect(ledger[0]?.model).toBe('gpt-4o-mini-tts');
    });
  });

  it('answers a re-reservation of a ready chunk from cache without consuming rate limit', async () => {
    const t = newWorld();
    await seedMember(t, ALICE, ORG_A);
    const threadId = await createThread(t, ALICE);
    const asAlice = t.withIdentity({ subject: ALICE });

    const first = await asAlice.mutation(
      internal.tts.mutations.reserveChunk,
      reserveArgs(threadId),
    );
    if (first.kind !== 'reserved') throw new Error('expected reservation');
    await asAlice.mutation(
      internal.tts.mutations.markChunkReadyAndRecordUsage,
      {
        chunkId: first.chunkId,
        attemptCreatedAt: first.attemptCreatedAt,
        storageId: 's3:test/audio-0.mp3',
        voice: 'alloy',
        providerName: 'openai',
        modelId: 'gpt-4o-mini-tts',
        format: 'mp3' as const,
        characterCount: 22,
        costEstimateCents: 1,
      },
    );

    const callsBefore = limitMock.mock.calls.length;
    const again = await asAlice.mutation(
      internal.tts.mutations.reserveChunk,
      reserveArgs(threadId),
    );
    expect(again.kind).toBe('ready');
    if (again.kind === 'ready') {
      expect(again.storageId).toBe('s3:test/audio-0.mp3');
      expect(again.voice).toBe('alloy');
    }
    // Cache-then-debit ordering: the hit never reached the limiter.
    expect(limitMock.mock.calls.length).toBe(callsBefore);
  });

  it('refuses a stale attempt so an overwritten reservation cannot be hijacked', async () => {
    const t = newWorld();
    await seedMember(t, ALICE, ORG_A);
    const threadId = await createThread(t, ALICE);
    const asAlice = t.withIdentity({ subject: ALICE });

    const first = await asAlice.mutation(
      internal.tts.mutations.reserveChunk,
      reserveArgs(threadId),
    );
    if (first.kind !== 'reserved') throw new Error('expected reservation');

    const stale = await asAlice.mutation(
      internal.tts.mutations.markChunkReadyAndRecordUsage,
      {
        chunkId: first.chunkId,
        // A different attempt identity — as if a prior crashed action woke
        // up after the row was re-reserved.
        attemptCreatedAt: first.attemptCreatedAt - 1,
        storageId: 's3:test/audio-stale.mp3',
        voice: 'alloy',
        providerName: 'openai',
        modelId: 'gpt-4o-mini-tts',
        format: 'mp3' as const,
        characterCount: 22,
        costEstimateCents: 1,
      },
    );
    expect(stale).toEqual({ stale: true });

    await t.run(async (ctx) => {
      const row = await ctx.db.get(first.chunkId);
      expect(row?.status).toBe('pending');
      expect(row?.storageId).toBeUndefined();
      // The stale result never billed.
      expect(await ctx.db.query('usageLedger').collect()).toHaveLength(0);
    });
  });

  it('refuses a messageId that belongs to a different thread (identity mismatch)', async () => {
    const t = newWorld();
    await seedMember(t, ALICE, ORG_A);
    await seedMember(t, BOB, ORG_A);
    const aliceThread = await createThread(t, ALICE);
    const bobThread = await createThread(t, BOB);

    const first = await t
      .withIdentity({ subject: ALICE })
      .mutation(internal.tts.mutations.reserveChunk, reserveArgs(aliceThread));
    expect(first.kind).toBe('reserved');

    // Bob knows (leaked / guessed) Alice's messageId and pairs it with his
    // own thread. The cross-field identity check must refuse.
    const code = await errorCode(
      t
        .withIdentity({ subject: BOB })
        .mutation(internal.tts.mutations.reserveChunk, reserveArgs(bobThread)),
    );
    expect(code).toBe('forbidden');
  });

  it('rejects an out-of-range chunk index and a rate-limited caller', async () => {
    const t = newWorld();
    await seedMember(t, ALICE, ORG_A);
    const threadId = await createThread(t, ALICE);
    const asAlice = t.withIdentity({ subject: ALICE });

    expect(
      await errorCode(
        asAlice.mutation(
          internal.tts.mutations.reserveChunk,
          reserveArgs(threadId, { index: 200 }),
        ),
      ),
    ).toBe('TTS_CHUNK_LIMIT');

    limitMock.mockResolvedValueOnce({ ok: false, retryAfter: 30 });
    expect(
      await errorCode(
        asAlice.mutation(
          internal.tts.mutations.reserveChunk,
          reserveArgs(threadId),
        ),
      ),
    ).toBe('RATE_LIMITED');
  });
});

describe('tts thread voice override', () => {
  it('lets the owner set and clear the override, and refuses everyone else', async () => {
    const t = newWorld();
    await seedMember(t, ALICE, ORG_A);
    await seedMember(t, BOB, ORG_A);
    const threadId = await createThread(t, ALICE);

    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.tts.mutations.setThreadVoiceOutputOverride, {
        threadId,
        organizationId: ORG_A,
        override: true,
      });
    await t.run(async (ctx) => {
      const normalized = ctx.db.normalizeId('threads', threadId);
      const thread = normalized ? await ctx.db.get(normalized) : null;
      expect(thread?.voiceOutputOverride).toBe(true);
    });

    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.tts.mutations.setThreadVoiceOutputOverride, {
        threadId,
        organizationId: ORG_A,
        override: null,
      });
    await t.run(async (ctx) => {
      const normalized = ctx.db.normalizeId('threads', threadId);
      const thread = normalized ? await ctx.db.get(normalized) : null;
      expect(thread?.voiceOutputOverride).toBeUndefined();
    });

    expect(
      await errorCode(
        t
          .withIdentity({ subject: BOB })
          .mutation(api.tts.mutations.setThreadVoiceOutputOverride, {
            threadId,
            organizationId: ORG_A,
            override: true,
          }),
      ),
    ).toBe('FORBIDDEN');
  });
});
