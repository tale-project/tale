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
    streamId: 'stream-1',
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

  it('settles the generation row even when the model throws mid-stream', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);

    await expect(
      t.action(async (ctx) =>
        runTurn(turnRequest(threadId), {
          harnesses: new Map(),
          model: explodingModel,
          store: createConvexTurnStore(ctx),
          usage: { record: async () => undefined },
        }),
      ),
    ).rejects.toThrow(/exploded/);

    // No stale generation row: it was deleted in the turn's finally.
    const generations = await t.run(async (ctx) =>
      ctx.db
        .query('generations')
        .withIndex('by_thread', (q) => q.eq('threadId', threadId))
        .collect(),
    );
    expect(generations).toHaveLength(0);

    // The user turn was recorded; no assistant reply was written.
    const messages = await t.run(async (ctx) =>
      ctx.db
        .query('messages')
        .withIndex('by_thread_sequence', (q) => q.eq('threadId', threadId))
        .collect(),
    );
    expect(messages.some((m) => m.role === 'assistant')).toBe(false);
  });
});
