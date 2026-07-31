/**
 * The turn pipeline is pure and injected, so these tests run it against a fake
 * model call — no network, no provider — but through the REAL Convex-backed
 * store and usage ledger. They pin the two facts a host must guarantee: a
 * completed turn writes the user turn and the assistant reply as ordered
 * messages, and the generation row is settled (deleted) even when the model
 * throws mid-stream, so a thread is never left looking like it is still
 * generating.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { runTurn, type ModelCall, type TurnRequest } from '../../lib/chat/turn';
import type { ChatWireMessage } from '../../lib/chat/wire-parts';
import { decodeChatError } from '../../lib/shared/chat-errors';
import type { ModelCatalogEntry } from '../../lib/shared/schemas/providers';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import {
  executeTurn,
  readEvent,
  settleWireAttachments,
  type StreamDecodeState,
} from './turn_action';
import { createConvexTurnStore, createConvexUsageLedger } from './turn_store';

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

const ORG = 'org_turn';
const USER = 'user_turn';

const MODEL: ModelCatalogEntry = {
  id: 'test-model',
  provider: 'test-provider',
  tags: [],
  supportsTools: false,
  supportsVision: false,
  contextWindow: 8000,
  maxOutputTokens: 1024,
  pricing: { inputCentsPerMillion: 500, outputCentsPerMillion: 2000 },
};

/** A fake model that answers in two chunks and reports token usage on its last
 * one — exactly the shape a provider stream has, without a provider. */
const answeringModel: ModelCall = async function* answeringModel() {
  yield { text: 'Hello, ' };
  yield {
    text: 'world.',
    usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
  };
};

/** A fake model that speaks once, then throws — a crashed stream. */
const explodingModel: ModelCall = async function* explodingModel() {
  yield { text: 'partial ' };
  throw new Error('model exploded mid-stream');
};

async function seedThread(t: T): Promise<Id<'threads'>> {
  return t.run(async (ctx) =>
    ctx.db.insert('threads', {
      organizationId: ORG,
      userId: USER,
      kind: 'direct',
      archived: false,
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

function turnRequest(threadId: Id<'threads'>): TurnRequest {
  return {
    organizationId: ORG,
    userId: USER,
    threadId,
    userText: 'Hi there',
    history: [],
    locale: 'en',
    model: MODEL,
    credential: { authMethod: 'api-key' },
    executionMode: 'direct',
  };
}

describe('chat turn — end to end against a fake model', () => {
  it('writes the user turn and the assistant reply, and settles the generation', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);

    const outcome = await t.action(async (ctx) =>
      runTurn(turnRequest(threadId), {
        harnesses: new Map(),
        model: answeringModel,
        store: createConvexTurnStore(ctx),
        usage: createConvexUsageLedger(ctx, { pricing: MODEL.pricing }),
      }),
    );

    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect(outcome.text).toBe('Hello, world.');
    }

    const messages = await t.run(async (ctx) =>
      ctx.db
        .query('messages')
        .withIndex('by_thread_sequence', (q) => q.eq('threadId', threadId))
        .collect(),
    );
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0]?.parts).toEqual([{ type: 'text', text: 'Hi there' }]);
    expect(messages[1]?.parts).toEqual([
      { type: 'text', text: 'Hello, world.' },
    ]);

    // The generation row is gone — the turn settled.
    const generations = await t.run(async (ctx) =>
      ctx.db
        .query('generations')
        .withIndex('by_thread', (q) => q.eq('threadId', threadId))
        .collect(),
    );
    expect(generations).toHaveLength(0);

    // Usage was recorded to the organization's ledger.
    const ledger = await t.run(async (ctx) =>
      ctx.db
        .query('usageLedger')
        .withIndex('by_org_user_period', (q) =>
          q.eq('organizationId', ORG).eq('userId', USER),
        )
        .collect(),
    );
    expect(ledger.length).toBeGreaterThan(0);
    expect(ledger[0]?.outputTokens).toBe(3);
  });

  it('stamps the same cost estimate on the message row and the ledger', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);

    const outcome = await t.action(async (ctx) =>
      runTurn(turnRequest(threadId), {
        harnesses: new Map(),
        model: answeringModel,
        store: createConvexTurnStore(ctx),
        usage: createConvexUsageLedger(ctx, { pricing: MODEL.pricing }),
      }),
    );
    expect(outcome.status).toBe('completed');

    const assistant = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query('messages')
        .withIndex('by_thread_sequence', (q) => q.eq('threadId', threadId))
        .collect();
      return rows.find((row) => row.role === 'assistant');
    });
    // 8 in at 500¢/M plus 3 out at 2000¢/M — fractional cents, not rounded
    // away.
    expect(assistant?.usage?.costEstimateCents).toBeCloseTo(0.01, 10);

    const ledger = await t.run(async (ctx) =>
      ctx.db
        .query('usageLedger')
        .withIndex('by_org_user_period', (q) =>
          q.eq('organizationId', ORG).eq('userId', USER),
        )
        .collect(),
    );
    expect(ledger[0]?.costEstimate).toBe(assistant?.usage?.costEstimateCents);
  });

  it('persists an error reply and settles when the model throws mid-stream', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);

    // The turn no longer throws out of the action — a mid-stream failure is
    // caught and turned into a visible error reply so the thread is never left
    // with a question and no answer.
    const outcome = await t.action(async (ctx) =>
      runTurn(turnRequest(threadId), {
        harnesses: new Map(),
        model: explodingModel,
        store: createConvexTurnStore(ctx),
        usage: { record: async () => undefined },
      }),
    );
    expect(outcome.status).toBe('refused');
    expect(outcome.status === 'refused' && outcome.reason).toMatch(/exploded/);

    // No stale generation row: it was deleted in the turn's finally.
    const generations = await t.run(async (ctx) =>
      ctx.db
        .query('generations')
        .withIndex('by_thread', (q) => q.eq('threadId', threadId))
        .collect(),
    );
    expect(generations).toHaveLength(0);

    // The assistant reply carries the failure in `error` (a countable error,
    // not a silent lost turn nor a guardrail block).
    const messages = await t.run(async (ctx) =>
      ctx.db
        .query('messages')
        .withIndex('by_thread_sequence', (q) => q.eq('threadId', threadId))
        .collect(),
    );
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant).toBeDefined();
    expect(assistant?.error).toMatch(/exploded/);
    expect(assistant?.blockedReason).toBeUndefined();
    // The stored error is the structured envelope: a classified code plus
    // the raw text, so the client can render a localized hint.
    const decoded = decodeChatError(assistant?.error);
    expect(decoded.code).toBeDefined();
    expect(decoded.raw).toMatch(/exploded/);
  });

  it('keeps the message list byte-stable while the reply streams', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    const listRows = () =>
      t.run(async (ctx) =>
        ctx.db
          .query('messages')
          .withIndex('by_thread_sequence', (q) => q.eq('threadId', threadId))
          .collect(),
      );
    const liveGeneration = () =>
      t.run(async (ctx) =>
        ctx.db
          .query('generations')
          .withIndex('by_thread', (q) => q.eq('threadId', threadId))
          .first(),
      );

    // Chunks long enough that the output transform clears each on its own
    // push, so every chunk reaches the store's streamProgress write.
    const first = 'a'.repeat(150);
    const second = 'b'.repeat(150);
    const snapshots: unknown[] = [];
    let midStreamText: string | undefined;
    const snapshotModel: ModelCall = async function* snapshotModel() {
      yield { text: first };
      snapshots.push(await listRows());
      midStreamText = (await liveGeneration())?.streamText;
      yield { text: second };
      snapshots.push(await listRows());
    };

    await t.action(async (ctx) =>
      runTurn(turnRequest(threadId), {
        harnesses: new Map(),
        model: snapshotModel,
        store: createConvexTurnStore(ctx),
        usage: { record: async () => undefined },
      }),
    );

    // The streamed text lives on the generation row…
    expect(midStreamText).toBe(first);
    // …while the message rows never move between chunks: the streaming
    // writes must not invalidate the list subscription.
    expect(snapshots[1]).toEqual(snapshots[0]);
    // The placeholder stayed empty until finalize, which carries the text.
    const settled = await listRows();
    expect(settled.at(-1)?.parts).toEqual([
      { type: 'text', text: first + second },
    ]);
    expect(await liveGeneration()).toBeNull();
  });

  it('settles the reasoning as a display-only part ahead of the answer', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    const answer = 'a'.repeat(150);
    const thinkingModel: ModelCall = async function* thinkingModel() {
      yield { text: '', reasoning: 'Let me check the return policy. ' };
      yield { text: '', reasoning: 'Thirty days applies.' };
      yield { text: answer };
    };

    const outcome = await t.action(async (ctx) =>
      runTurn(turnRequest(threadId), {
        harnesses: new Map(),
        model: thinkingModel,
        store: createConvexTurnStore(ctx),
        usage: { record: async () => undefined },
      }),
    );
    expect(outcome.status).toBe('completed');

    const messages = await t.run(async (ctx) =>
      ctx.db
        .query('messages')
        .withIndex('by_thread_sequence', (q) => q.eq('threadId', threadId))
        .collect(),
    );
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant?.parts).toEqual([
      {
        type: 'reasoning',
        text: 'Let me check the return policy. Thirty days applies.',
      },
      { type: 'text', text: answer },
    ]);
  });

  it('bounds the turn history read and reports what it left behind', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    for (let index = 0; index < 12; index += 1) {
      await t.mutation(internal.chat.messages.appendMessageInternal, {
        organizationId: ORG,
        threadId,
        role: index % 2 === 0 ? 'user' : 'assistant',
        parts: [{ type: 'text', text: `turn ${index} ${'x'.repeat(400)}` }],
      });
    }

    const bounded = await t.query(
      internal.chat.messages.listRecentForTurnInternal,
      {
        organizationId: ORG,
        threadId,
        // Room for roughly four rows of ~430 chars of parts JSON.
        maxChars: 1800,
        maxRows: 500,
      },
    );

    expect(bounded.messages.length).toBeGreaterThan(2);
    expect(bounded.messages.length).toBeLessThan(12);
    // Oldest-first, contiguous, and the omitted count is the first sequence.
    const sequences = bounded.messages.map((m) => m.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(bounded.omittedCount).toBe(sequences[0]);
    expect(bounded.omittedCount + bounded.messages.length).toBe(12);

    const capped = await t.query(
      internal.chat.messages.listRecentForTurnInternal,
      { organizationId: ORG, threadId, maxChars: 1_000_000, maxRows: 5 },
    );
    expect(capped.messages).toHaveLength(5);
    expect(capped.omittedCount).toBe(7);
  });

  it('rescues the streamed partial when the model dies after clearing text', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    const partial = 'p'.repeat(150);
    const dyingModel: ModelCall = async function* dyingModel() {
      yield { text: partial };
      throw new Error('provider died mid-answer');
    };

    const outcome = await t.action(async (ctx) =>
      runTurn(turnRequest(threadId), {
        harnesses: new Map(),
        model: dyingModel,
        store: createConvexTurnStore(ctx),
        usage: { record: async () => undefined },
      }),
    );
    expect(outcome.status).toBe('refused');

    // The finalize had no text of its own — the streamed partial is rescued
    // off the generation row before that row is deleted.
    const messages = await t.run(async (ctx) =>
      ctx.db
        .query('messages')
        .withIndex('by_thread_sequence', (q) => q.eq('threadId', threadId))
        .collect(),
    );
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant?.parts).toEqual([{ type: 'text', text: partial }]);
    expect(assistant?.error).toMatch(/died/);
  });
});

/**
 * The stream decoder's usage seam: the cache and reasoning counts only some
 * dialects report must surface when present and stay ABSENT when not — a
 * made-up zero would render as a fact in the message-info panel.
 */
describe('readEvent — cache and reasoning usage decode', () => {
  function decodeState(): StreamDecodeState {
    return { running: { input: 0, output: 0 }, drafts: new Map() };
  }

  it('reads anthropic cache_read_input_tokens; reasoning stays absent', () => {
    const s = decodeState();
    readEvent(
      'anthropic',
      {
        type: 'message_start',
        message: {
          usage: { input_tokens: 42, cache_read_input_tokens: 30 },
        },
      },
      s,
    );
    const settled = readEvent(
      'anthropic',
      { type: 'message_delta', usage: { output_tokens: 7 } },
      s,
    );
    expect(settled.usage).toEqual({
      inputTokens: 42,
      outputTokens: 7,
      totalTokens: 49,
      cachedInputTokens: 30,
    });
  });

  it('reads openai detail counts only when the frame carries them', () => {
    const bare = readEvent(
      'openai',
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
      decodeState(),
    );
    expect(bare.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });

    const detailed = readEvent(
      'openai',
      {
        choices: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          prompt_tokens_details: { cached_tokens: 6 },
          completion_tokens_details: { reasoning_tokens: 2 },
        },
      },
      decodeState(),
    );
    expect(detailed.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cachedInputTokens: 6,
      reasoningTokens: 2,
    });
  });
});

describe('settleWireAttachments — image refs on the direct wire', () => {
  // The non-vision and cache-hit paths never touch the ctx; the byte-fetch
  // path needs real storage and is covered by the live browser E2E.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- unused by the exercised paths
  const ctx = null as unknown as Parameters<typeof settleWireAttachments>[0];
  const REF = { fileId: 'blob1', name: 'shot.png', mediaType: 'image/png' };

  it('textualizes refs for a model without vision', async () => {
    const messages: ChatWireMessage[] = [
      { role: 'user', content: 'look', attachmentRefs: [REF] },
    ];
    await settleWireAttachments(ctx, ORG, messages, {
      vision: false,
      cache: new Map(),
    });
    expect(messages[0]?.content).toBe('look\n\n[attachment: shot.png]');
    expect(messages[0]?.images).toBeUndefined();
  });

  it('serves cached bytes without touching storage', async () => {
    const cache = new Map([
      ['blob1', { mediaType: 'image/png', dataBase64: 'QUJD' }],
    ]);
    const messages: ChatWireMessage[] = [
      { role: 'user', content: 'look', attachmentRefs: [REF] },
    ];
    await settleWireAttachments(ctx, ORG, messages, { vision: true, cache });
    expect(messages[0]?.images).toEqual([
      { mediaType: 'image/png', dataBase64: 'QUJD' },
    ]);
    expect(messages[0]?.content).toBe('look');
  });

  it('falls back to the text surface when the bytes could not load', async () => {
    const cache = new Map<
      string,
      { mediaType: string; dataBase64: string } | null
    >([['blob1', null]]);
    const messages: ChatWireMessage[] = [
      { role: 'user', content: '', attachmentRefs: [REF] },
    ];
    await settleWireAttachments(ctx, ORG, messages, { vision: true, cache });
    expect(messages[0]?.content).toBe('[attachment: shot.png]');
    expect(messages[0]?.images).toBeUndefined();
  });
});

describe('executeTurn — the attachment gate', () => {
  const SEND = {
    organizationId: ORG,
    userId: USER,
    threadId: 'thread_gate',
    userText: 'look at this',
    modelId: 'test-model',
    sandbox: false,
    locale: 'en',
  };
  const IMAGE = {
    fileId: 'blob_mine',
    fileName: 'shot.png',
    fileType: 'image/png',
    fileSize: 10,
  };

  async function seedFile(t: T, organizationId: string, storageId: string) {
    await t.run(async (ctx) => {
      await ctx.db.insert('fileMetadata', {
        organizationId,
        storageId,
        fileName: 'shot.png',
        contentType: 'image/png',
        size: 10,
      });
    });
  }

  it('refuses a blob reference from another organization', async () => {
    const t = convexTest(schema, modules);
    await seedFile(t, 'org_other', 'blob_foreign');

    const outcome = await t.action(async (ctx) =>
      executeTurn(ctx, {
        ...SEND,
        attachments: [{ ...IMAGE, fileId: 'blob_foreign' }],
      }),
    );

    expect(outcome.status).toBe('refused');
    if (outcome.status === 'refused') {
      expect(outcome.reason).toContain('not found');
    }
  });

  it('refuses a trashed blob — deletion is not resurrectable via send', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('fileMetadata', {
        organizationId: ORG,
        storageId: 'blob_trashed',
        fileName: 'shot.png',
        contentType: 'image/png',
        size: 10,
        lifecycleStatus: 'trashed',
      });
    });

    const outcome = await t.action(async (ctx) =>
      executeTurn(ctx, {
        ...SEND,
        attachments: [{ ...IMAGE, fileId: 'blob_trashed' }],
      }),
    );

    expect(outcome.status).toBe('refused');
  });

  it('refuses a non-image attachment', async () => {
    const t = convexTest(schema, modules);
    await seedFile(t, ORG, 'blob_mine');

    const outcome = await t.action(async (ctx) =>
      executeTurn(ctx, {
        ...SEND,
        attachments: [
          { ...IMAGE, fileName: 'report.pdf', fileType: 'application/pdf' },
        ],
      }),
    );

    expect(outcome.status).toBe('refused');
    if (outcome.status === 'refused') {
      expect(outcome.reason).toContain('image');
    }
  });

  it('re-enforces the composer count cap server-side', async () => {
    const t = convexTest(schema, modules);

    const outcome = await t.action(async (ctx) =>
      executeTurn(ctx, {
        ...SEND,
        attachments: Array.from({ length: 11 }, (_, index) => ({
          ...IMAGE,
          fileId: `blob_${index}`,
        })),
      }),
    );

    expect(outcome.status).toBe('refused');
    if (outcome.status === 'refused') {
      expect(outcome.reason).toContain('at most');
    }
  });
});
