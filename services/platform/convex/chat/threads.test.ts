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

describe('chat threads — sharing', () => {
  /** Alice's thread with three messages stamped before any share. */
  async function seedSharedFixture(t: T) {
    await seedMember(t, ALICE, ORG_A);
    const threadId = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'direct',
        title: 'Quarterly numbers',
      });
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert('messages', {
          organizationId: ORG_A,
          threadId,
          role: i % 2 === 0 ? 'user' : 'assistant',
          parts: [{ type: 'text', text: `m${i}` }],
          sequence: i,
          createdAt: i,
        });
      }
    });
    return threadId;
  }

  /** The thread row as stored — sharing state lives on it. */
  async function readThread(t: T, threadId: string) {
    return await t.run(async (ctx) => {
      const id = ctx.db.normalizeId('threads', threadId);
      return id ? await ctx.db.get(id) : null;
    });
  }

  it('mints a stable token and re-sharing only moves the snapshot boundary', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedSharedFixture(t);

    const first = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.shareThread, {
        organizationId: ORG_A,
        threadId,
      });
    expect(first).not.toBeNull();
    // The token is the whole credential of the URL — long and URL-safe.
    expect(first?.shareToken).toMatch(/^[0-9a-f]{64}$/);

    // Age the boundary, then re-share: the token must survive, the boundary
    // must move.
    await t.run(async (ctx) => {
      const id = ctx.db.normalizeId('threads', threadId);
      if (id) await ctx.db.patch(id, { sharedAt: 1 });
    });
    const again = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.shareThread, {
        organizationId: ORG_A,
        threadId,
      });
    expect(again?.shareToken).toBe(first?.shareToken);
    const thread = await readThread(t, threadId);
    expect(thread?.sharedAt).toBeGreaterThan(1);
    expect(thread?.isShared).toBe(true);
    expect(thread?.sharedBy).toBe(ALICE);
  });

  it('refuses to share a thread the caller does not own', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedSharedFixture(t);
    await seedMember(t, BOB, ORG_A);

    const asBob = await t
      .withIdentity({ subject: BOB })
      .mutation(api.chat.threads.shareThread, {
        organizationId: ORG_A,
        threadId,
      });
    expect(asBob).toBeNull();
    expect((await readThread(t, threadId))?.isShared).toBeUndefined();
  });

  it('serves the snapshot to another member of the organization, in order', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedSharedFixture(t);
    await seedMember(t, BOB, ORG_A);

    const shared = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.shareThread, {
        organizationId: ORG_A,
        threadId,
      });

    const view = await t
      .withIdentity({ subject: BOB })
      .query(api.chat.threads.getSharedThread, {
        shareToken: shared?.shareToken ?? '',
      });
    expect(view).not.toBeNull();
    expect(view?.threadId).toBe(threadId);
    expect(view?.title).toBe('Quarterly numbers');
    expect(view?.sharedBy).toBe(ALICE);
    expect(view?.messages.map((m) => m.sequence)).toEqual([0, 1, 2]);
    expect(view?.messages.map((m) => m.parts)).toEqual([
      [{ type: 'text', text: 'm0' }],
      [{ type: 'text', text: 'm1' }],
      [{ type: 'text', text: 'm2' }],
    ]);
  });

  it('cuts the snapshot at sharedAt — a message appended after the share stays private', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedSharedFixture(t);

    const shared = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.shareThread, {
        organizationId: ORG_A,
        threadId,
      });
    const sharedAt = (await readThread(t, threadId))?.sharedAt ?? 0;

    // The conversation continues after the share.
    await t.run(async (ctx) => {
      await ctx.db.insert('messages', {
        organizationId: ORG_A,
        threadId,
        role: 'assistant',
        parts: [{ type: 'text', text: 'after the share' }],
        sequence: 3,
        createdAt: sharedAt + 1,
      });
    });

    const view = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.getSharedThread, {
        shareToken: shared?.shareToken ?? '',
      });
    expect(view?.messages).toHaveLength(3);
    expect(view?.messages.map((m) => m.sequence)).toEqual([0, 1, 2]);
  });

  it('answers null for an unknown token and for an unshared thread', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedSharedFixture(t);

    const unknown = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.getSharedThread, { shareToken: 'nope' });
    expect(unknown).toBeNull();

    const shared = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.shareThread, {
        organizationId: ORG_A,
        threadId,
      });
    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.unshareThread, {
        organizationId: ORG_A,
        threadId,
      });

    const afterUnshare = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.getSharedThread, {
        shareToken: shared?.shareToken ?? '',
      });
    expect(afterUnshare).toBeNull();

    // Re-sharing restores the exact same URL — the token survived the unshare.
    const reshared = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.shareThread, {
        organizationId: ORG_A,
        threadId,
      });
    expect(reshared?.shareToken).toBe(shared?.shareToken);
  });

  it('answers null for a caller outside the thread’s organization', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedSharedFixture(t);
    // Bob belongs to another org. In the thread's org he is mirrored only as
    // DISABLED — a mirror hit that denies, keeping the deny path off the
    // Better Auth fallback convexTest cannot register.
    await seedMember(t, BOB, ORG_B);
    await t.run(async (ctx) => {
      await ctx.db.insert('memberMirror', {
        memberId: `m_${BOB}_${ORG_A}_disabled`,
        userId: BOB,
        organizationId: ORG_A,
        role: 'disabled',
        createdAt: 0,
      });
    });

    const shared = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.shareThread, {
        organizationId: ORG_A,
        threadId,
      });

    const asOutsider = await t
      .withIdentity({ subject: BOB })
      .query(api.chat.threads.getSharedThread, {
        shareToken: shared?.shareToken ?? '',
      });
    expect(asOutsider).toBeNull();
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

describe('chat threads — project filing', () => {
  async function seedProject(t: T, organizationId: string): Promise<string> {
    return await t.run(async (ctx) =>
      ctx.db.insert('projects', {
        organizationId,
        name: 'Roadmap',
        createdBy: ALICE,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
  }

  it('files a thread into a project and takes it back out', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const projectId = await seedProject(t, ORG_A);

    const threadId = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'direct',
      });

    const filed = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.moveThreadToProject, {
        organizationId: ORG_A,
        threadId,
        projectId,
      });
    expect(filed).toBe(true);

    const listed = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.listThreads, { organizationId: ORG_A });
    expect(listed[0]?.projectId).toBe(projectId);

    const unfiled = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.moveThreadToProject, {
        organizationId: ORG_A,
        threadId,
        projectId: null,
      });
    expect(unfiled).toBe(true);

    const relisted = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.listThreads, { organizationId: ORG_A });
    expect(relisted[0]?.projectId).toBeUndefined();
  });

  it('refuses to file a thread the caller does not own', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    await seedMember(t, BOB, ORG_A);
    const projectId = await seedProject(t, ORG_A);

    const threadId = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'direct',
      });

    const moved = await t
      .withIdentity({ subject: BOB })
      .mutation(api.chat.threads.moveThreadToProject, {
        organizationId: ORG_A,
        threadId,
        projectId,
      });
    expect(moved).toBe(false);

    const listed = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.listThreads, { organizationId: ORG_A });
    expect(listed[0]?.projectId).toBeUndefined();
  });

  it('refuses a project from another organization', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const foreignProjectId = await seedProject(t, ORG_B);

    const threadId = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'direct',
      });

    await expect(
      t
        .withIdentity({ subject: ALICE })
        .mutation(api.chat.threads.moveThreadToProject, {
          organizationId: ORG_A,
          threadId,
          projectId: foreignProjectId,
        }),
    ).rejects.toThrow();

    const listed = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.listThreads, { organizationId: ORG_A });
    expect(listed[0]?.projectId).toBeUndefined();
  });
});
