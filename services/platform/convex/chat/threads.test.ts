/**
 * Threads are user-private within an organization. These tests pin both
 * isolation directions — a member never sees another member's threads, and no
 * organization sees another's — and the branch/archive behaviour, because a
 * scoping regression here leaks one person's conversations to another.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
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

const ORG_A = 'org_a';
const ORG_B = 'org_b';
const ALICE = 'user_alice';
const BOB = 'user_bob';

describe('chat threads — scoping', () => {
  it('lists a thread for its owner and hides it from another member of the same org', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    await seedMember(t, BOB, ORG_A);

    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'direct',
        title: "Alice's thread",
      });

    const aliceThreads = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.listThreads, { organizationId: ORG_A });
    expect(aliceThreads).toHaveLength(1);
    expect(aliceThreads[0]?.title).toBe("Alice's thread");

    const bobThreads = await t
      .withIdentity({ subject: BOB })
      .query(api.chat.threads.listThreads, { organizationId: ORG_A });
    expect(bobThreads).toHaveLength(0);
  });

  it('does not surface a thread from another organization the same user belongs to', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    await seedMember(t, ALICE, ORG_B);

    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'direct',
      });

    const inB = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.listThreads, { organizationId: ORG_B });
    expect(inB).toHaveLength(0);
  });

  it('returns null from getThread for another member’s thread', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    await seedMember(t, BOB, ORG_A);

    const threadId = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'direct',
      });

    const asBob = await t
      .withIdentity({ subject: BOB })
      .query(api.chat.threads.getThread, {
        organizationId: ORG_A,
        threadId,
      });
    expect(asBob).toBeNull();
  });

  it('refuses to archive a thread the caller does not own', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    await seedMember(t, BOB, ORG_A);

    const threadId = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'direct',
      });

    const bobResult = await t
      .withIdentity({ subject: BOB })
      .mutation(api.chat.threads.setThreadArchived, {
        organizationId: ORG_A,
        threadId,
        archived: true,
      });
    expect(bobResult).toBe(false);

    const stillActive = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.getThread, { organizationId: ORG_A, threadId });
    expect(stillActive?.archived).toBe(false);
  });

  it('reports the generating flag from the live generation row', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);

    const threadId = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'direct',
      });

    await t.run(async (ctx) => {
      await ctx.db.insert('generations', {
        organizationId: ORG_A,
        threadId,
        status: 'streaming',
        streamId: 's1',
        startedAt: 0,
        heartbeatAt: 0,
      });
    });

    const threads = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.listThreads, { organizationId: ORG_A });
    expect(threads[0]?.generating).toBe(true);
  });
});

describe('chat threads — branching', () => {
  it('forks the conversation up to a message into a new thread with fresh sequences', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);

    const threadId = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'direct',
      });

    // Three messages; branch at the second.
    const ids = await t.run(async (ctx) => {
      const made: string[] = [];
      for (let i = 0; i < 3; i++) {
        made.push(
          await ctx.db.insert('messages', {
            organizationId: ORG_A,
            threadId,
            role: i % 2 === 0 ? 'user' : 'assistant',
            parts: [{ type: 'text', text: `m${i}` }],
            sequence: i,
            createdAt: i,
          }),
        );
      }
      return made;
    });

    const branchId = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.branchThread, {
        organizationId: ORG_A,
        threadId,
        fromMessageId: ids[1] ?? '',
      });
    expect(branchId).not.toBeNull();

    const branchMessages = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.messages.listMessages, {
        organizationId: ORG_A,
        threadId: branchId ?? '',
      });
    // Only the first two messages carried over, re-sequenced from zero.
    expect(branchMessages.map((m) => m.sequence)).toEqual([0, 1]);
    expect(branchMessages.map((m) => m.parts)).toEqual([
      [{ type: 'text', text: 'm0' }],
      [{ type: 'text', text: 'm1' }],
    ]);
  });
});
