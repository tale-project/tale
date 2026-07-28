/**
 * Threads are user-private within an organization. These tests pin both
 * isolation directions — a member never sees another member's threads, and no
 * organization sees another's — and the branch/archive behaviour, because a
 * scoping regression here leaks one person's conversations to another.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../_generated/api';
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

describe('chat threads — AI title write', () => {
  it('fills an absent title and refuses to clobber one that exists', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const threadId = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'direct',
      });

    await t.mutation(internal.chat.threads.setThreadTitleInternal, {
      organizationId: ORG_A,
      threadId,
      title: 'Configure Git Identity',
    });
    const titled = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.getThread, { organizationId: ORG_A, threadId });
    expect(titled?.title).toBe('Configure Git Identity');

    // A second write — a slow generation landing after the first — is a no-op.
    await t.mutation(internal.chat.threads.setThreadTitleInternal, {
      organizationId: ORG_A,
      threadId,
      title: 'Late Duplicate',
    });
    const after = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.getThread, { organizationId: ORG_A, threadId });
    expect(after?.title).toBe('Configure Git Identity');
  });

  it('ignores a blank title and a thread outside the organization', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const threadId = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'direct',
      });

    await t.mutation(internal.chat.threads.setThreadTitleInternal, {
      organizationId: ORG_A,
      threadId,
      title: '   ',
    });
    await t.mutation(internal.chat.threads.setThreadTitleInternal, {
      organizationId: ORG_B,
      threadId,
      title: 'Cross-org write',
    });

    const thread = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.getThread, { organizationId: ORG_A, threadId });
    expect(thread?.title).toBeUndefined();
  });

  it('does not disturb the list ordering — a title is metadata, not activity', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const older = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'direct',
      });
    const newer = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'direct',
      });
    // Force distinct updatedAt stamps so the order is unambiguous.
    await t.run(async (ctx) => {
      await ctx.db.patch(older, { updatedAt: 1000 });
      await ctx.db.patch(newer, { updatedAt: 2000 });
    });

    await t.mutation(internal.chat.threads.setThreadTitleInternal, {
      organizationId: ORG_A,
      threadId: older,
      title: 'Named Later',
    });

    const threads = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.listThreads, { organizationId: ORG_A });
    expect(threads.map((thread) => thread.id)).toEqual([newer, older]);
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

/**
 * The conversation's capability assembly must OUTLIVE the message it was
 * toggled for: it is written on every toggle (`setThreadCapabilities`) and
 * surfaced by the list/get projections so the composer re-hydrates after a
 * remount. Before this, the assembly was frozen at `createThread` and never
 * read back — re-toggling mid-conversation was a silent no-op and the menu
 * reset to empty after the first send.
 */
describe('chat threads — capability assembly', () => {
  it('persists a capability update and surfaces it through both projections', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);

    const threadId = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'sandbox',
        harness: 'claude-code',
        capabilities: { skills: [], connectors: ['github'] },
      });

    const updated = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.setThreadCapabilities, {
        organizationId: ORG_A,
        threadId,
        capabilities: { skills: ['docx'], connectors: ['github', 'tavily'] },
      });
    expect(updated).toBe(true);

    const listed = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.listThreads, { organizationId: ORG_A });
    expect(listed[0]?.capabilities).toEqual({
      skills: ['docx'],
      connectors: ['github', 'tavily'],
    });

    const fetched = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.getThread, { organizationId: ORG_A, threadId });
    expect(fetched?.capabilities).toEqual({
      skills: ['docx'],
      connectors: ['github', 'tavily'],
    });
  });

  it('clears the assembly when every pick is toggled off, and dedupes on write', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);

    const threadId = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'sandbox',
        capabilities: { skills: [], connectors: ['github'] },
      });

    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.setThreadCapabilities, {
        organizationId: ORG_A,
        threadId,
        capabilities: { skills: ['docx', 'docx', ''], connectors: [] },
      });
    const deduped = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.getThread, { organizationId: ORG_A, threadId });
    expect(deduped?.capabilities).toEqual({ skills: ['docx'], connectors: [] });

    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.setThreadCapabilities, {
        organizationId: ORG_A,
        threadId,
        capabilities: { skills: [], connectors: [] },
      });
    const cleared = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.getThread, { organizationId: ORG_A, threadId });
    expect(cleared?.capabilities).toBeUndefined();
  });

  it('refuses an update on a thread the caller does not own', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    await seedMember(t, BOB, ORG_A);

    const threadId = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'sandbox',
      });

    const asBob = await t
      .withIdentity({ subject: BOB })
      .mutation(api.chat.threads.setThreadCapabilities, {
        organizationId: ORG_A,
        threadId,
        capabilities: { skills: [], connectors: ['github'] },
      });
    expect(asBob).toBe(false);

    const asAlice = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.getThread, { organizationId: ORG_A, threadId });
    expect(asAlice?.capabilities).toBeUndefined();
  });

  it('rejects an assembly beyond the per-conversation ceiling', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);

    const threadId = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'sandbox',
      });

    await expect(
      t
        .withIdentity({ subject: ALICE })
        .mutation(api.chat.threads.setThreadCapabilities, {
          organizationId: ORG_A,
          threadId,
          capabilities: {
            skills: Array.from({ length: 26 }, (_, i) => `skill-${i}`),
            connectors: [],
          },
        }),
    ).rejects.toThrow(/at most/);
  });
});

/**
 * The reasoning-effort pick is an explicit, per-conversation user choice —
 * stored like the capability assembly, cleared by an absent argument, and
 * surfaced through both summary projections so the composer re-hydrates it.
 */
describe('chat threads — reasoning effort', () => {
  it('persists a pick and surfaces it through both projections', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);

    const threadId = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'direct',
      });

    const updated = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.setThreadReasoningEffort, {
        organizationId: ORG_A,
        threadId,
        reasoningEffort: 'extra',
      });
    expect(updated).toBe(true);

    const listed = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.listThreads, { organizationId: ORG_A });
    expect(listed[0]?.reasoningEffort).toBe('extra');

    const fetched = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.getThread, { organizationId: ORG_A, threadId });
    expect(fetched?.reasoningEffort).toBe('extra');
  });

  it('clears the pick when the argument is absent, without touching recency', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);

    const threadId = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'direct',
      });
    const before = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.getThread, { organizationId: ORG_A, threadId });

    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.setThreadReasoningEffort, {
        organizationId: ORG_A,
        threadId,
        reasoningEffort: 'max',
      });
    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.threads.setThreadReasoningEffort, {
        organizationId: ORG_A,
        threadId,
      });

    const after = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.getThread, { organizationId: ORG_A, threadId });
    expect(after?.reasoningEffort).toBeUndefined();
    // A metadata edit, not chat activity: the list keeps its recency order.
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it('refuses a pick on a thread the caller does not own', async () => {
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
      .mutation(api.chat.threads.setThreadReasoningEffort, {
        organizationId: ORG_A,
        threadId,
        reasoningEffort: 'high',
      });
    expect(asBob).toBe(false);

    const asAlice = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.threads.getThread, { organizationId: ORG_A, threadId });
    expect(asAlice?.reasoningEffort).toBeUndefined();
  });
});

describe('chat threads — sidebar actions', () => {
  /** Create a thread and force a deterministic `updatedAt`. */
  async function seedThread(
    t: T,
    userId: string,
    title: string,
    updatedAt: number,
  ): Promise<string> {
    const id = await t
      .withIdentity({ subject: userId })
      .mutation(api.chat.threads.createThread, {
        organizationId: ORG_A,
        kind: 'direct',
        title,
      });
    await t.run(async (ctx) => {
      await ctx.db.patch(id, { updatedAt, createdAt: updatedAt });
    });
    return id;
  }

  it('floats pinned threads to the top, newest pin first', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const a = await seedThread(t, ALICE, 'a', 1000);
    await seedThread(t, ALICE, 'b', 2000);
    const c = await seedThread(t, ALICE, 'c', 3000);
    const alice = t.withIdentity({ subject: ALICE });

    await alice.mutation(api.chat.threads.setThreadPinned, {
      organizationId: ORG_A,
      threadId: a,
      pinned: true,
    });
    let titles = (
      await alice.query(api.chat.threads.listThreads, {
        organizationId: ORG_A,
      })
    ).map((row) => row.title);
    expect(titles).toEqual(['a', 'c', 'b']);

    await alice.mutation(api.chat.threads.setThreadPinned, {
      organizationId: ORG_A,
      threadId: c,
      pinned: true,
    });
    titles = (
      await alice.query(api.chat.threads.listThreads, {
        organizationId: ORG_A,
      })
    ).map((row) => row.title);
    expect(titles).toEqual(['c', 'a', 'b']);

    await alice.mutation(api.chat.threads.setThreadPinned, {
      organizationId: ORG_A,
      threadId: a,
      pinned: false,
    });
    titles = (
      await alice.query(api.chat.threads.listThreads, {
        organizationId: ORG_A,
      })
    ).map((row) => row.title);
    expect(titles).toEqual(['c', 'b', 'a']);
  });

  it('renames a thread, capping the name; refuses empty and foreign renames', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    await seedMember(t, BOB, ORG_A);
    const id = await seedThread(t, ALICE, 'before', 1000);
    const alice = t.withIdentity({ subject: ALICE });

    await expect(
      alice.mutation(api.chat.threads.renameThread, {
        organizationId: ORG_A,
        threadId: id,
        title: `  ${'x'.repeat(300)}  `,
      }),
    ).resolves.toBe(true);
    const renamed = await alice.query(api.chat.threads.getThread, {
      organizationId: ORG_A,
      threadId: id,
    });
    expect(renamed?.title).toBe('x'.repeat(120));
    // Renaming is a metadata edit — the row keeps its recency slot.
    expect(renamed?.updatedAt).toBe(1000);

    await expect(
      alice.mutation(api.chat.threads.renameThread, {
        organizationId: ORG_A,
        threadId: id,
        title: '   ',
      }),
    ).resolves.toBe(false);

    await expect(
      t.withIdentity({ subject: BOB }).mutation(api.chat.threads.renameThread, {
        organizationId: ORG_A,
        threadId: id,
        title: 'stolen',
      }),
    ).resolves.toBe(false);
  });

  it('archives without disturbing recency, audits the change, and paginates the archive', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      ids.push(await seedThread(t, ALICE, `t${index}`, 1000 + index * 1000));
    }
    const alice = t.withIdentity({ subject: ALICE });

    for (const id of ids.slice(0, 3)) {
      await alice.mutation(api.chat.threads.setThreadArchived, {
        organizationId: ORG_A,
        threadId: id,
        archived: true,
      });
    }

    const active = await alice.query(api.chat.threads.listThreads, {
      organizationId: ORG_A,
    });
    expect(active.map((row) => row.title)).toEqual(['t4', 't3']);

    const pageOne = await alice.query(api.chat.threads.listArchivedThreads, {
      organizationId: ORG_A,
      limit: 2,
    });
    expect(pageOne.rows.map((row) => row.title)).toEqual(['t2', 't1']);
    // The cursor is the LAST row of the page — the next page starts below it.
    expect(pageOne.nextCursor).toBe(2000);

    const pageTwo = await alice.query(api.chat.threads.listArchivedThreads, {
      organizationId: ORG_A,
      limit: 2,
      cursor: pageOne.nextCursor ?? 0,
    });
    expect(pageTwo.rows.map((row) => row.title)).toEqual(['t0']);
    expect(pageTwo.nextCursor).toBeNull();

    // Unarchiving returns the row to its true recency slot, not the top.
    await alice.mutation(api.chat.threads.setThreadArchived, {
      organizationId: ORG_A,
      threadId: ids[0] ?? '',
      archived: false,
    });
    const after = await alice.query(api.chat.threads.listThreads, {
      organizationId: ORG_A,
    });
    expect(after.map((row) => row.title)).toEqual(['t4', 't3', 't0']);

    const audits = await t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect()).map((row) => row.action),
    );
    expect(audits).toContain('chat_thread.archived');
    expect(audits).toContain('chat_thread.unarchived');
  });

  it('excludes hidden branch siblings and trashed rows from every list', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const visible = await seedThread(t, ALICE, 'visible', 1000);
    const hiddenId = await seedThread(t, ALICE, 'hidden-branch', 2000);
    const trashedId = await seedThread(t, ALICE, 'trashed', 3000);
    await t.run(async (ctx) => {
      await ctx.db.patch(hiddenId as never, { hidden: true as const });
      await ctx.db.patch(trashedId as never, {
        lifecycleStatus: 'trashed' as const,
        statusChangedAt: 1,
      });
    });
    const alice = t.withIdentity({ subject: ALICE });

    const rows = await alice.query(api.chat.threads.listThreads, {
      organizationId: ORG_A,
    });
    expect(rows.map((row) => row.id)).toEqual([visible]);

    const archived = await alice.query(api.chat.threads.listArchivedThreads, {
      organizationId: ORG_A,
    });
    expect(archived.rows).toHaveLength(0);
  });

  it('stamps the reply watermark on assistant appends and clears it via markThreadRead', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    const id = await seedThread(t, ALICE, 'watermark', 1000);
    const alice = t.withIdentity({ subject: ALICE });

    await t.mutation(internal.chat.messages.appendMessageInternal, {
      organizationId: ORG_A,
      threadId: id,
      role: 'user',
      parts: [{ type: 'text', text: 'hi' }],
    });
    let row = (
      await alice.query(api.chat.threads.listThreads, {
        organizationId: ORG_A,
      })
    )[0];
    expect(row?.lastReplyAt).toBeUndefined();

    await t.mutation(internal.chat.messages.appendMessageInternal, {
      organizationId: ORG_A,
      threadId: id,
      role: 'assistant',
      parts: [{ type: 'text', text: 'hello' }],
    });
    row = (
      await alice.query(api.chat.threads.listThreads, {
        organizationId: ORG_A,
      })
    )[0];
    expect(row?.lastReplyAt).toBeGreaterThan(0);

    await alice.mutation(api.chat.threads.markThreadRead, {
      organizationId: ORG_A,
      threadId: id,
    });
    row = (
      await alice.query(api.chat.threads.listThreads, {
        organizationId: ORG_A,
      })
    )[0];
    expect(row?.lastReadAt ?? 0).toBeGreaterThanOrEqual(row?.lastReplyAt ?? 1);
  });
});
