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
import { decodeChatError } from '../../lib/shared/chat-errors';
import type { ModelCatalogEntry } from '../../lib/shared/schemas/providers';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
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
