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
