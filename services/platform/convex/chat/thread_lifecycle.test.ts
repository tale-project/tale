/**
 * The trash lifecycle: Delete moves a thread to Trash where its owner (or an
 * admin, via governance) can restore it during the grace window; the purge
 * removes everything. These tests pin the lifecycle transitions, the
 * legal-hold refusals, the page-bounded purge, and the retention sweep's
 * selection queries — a regression in any of them either loses user data
 * early or keeps it past policy.
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

const ORG = 'org_a';
const ALICE = 'user_alice';
const BOB = 'user_bob';

async function seedMember(
  t: T,
  userId: string,
  role: 'member' | 'admin' = 'member',
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}_${ORG}`,
      userId,
      organizationId: ORG,
      role,
      createdAt: 0,
    });
  });
}

async function seedThread(
  t: T,
  userId: string,
  title: string,
  updatedAt = 1000,
): Promise<string> {
  const id = await t
    .withIdentity({ subject: userId })
    .mutation(api.chat.threads.createThread, {
      organizationId: ORG,
      kind: 'direct',
      title,
    });
  await t.run(async (ctx) => {
    await ctx.db.patch(id, { updatedAt, createdAt: updatedAt });
  });
  return id;
}

async function seedOrgHold(t: T): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('legalHolds', {
      organizationId: ORG,
      targetType: 'org',
      targetId: ORG,
      targetLabel: 'Org A',
      reason: 'litigation',
      placedBy: 'admin',
      placedAt: 1,
    });
  });
}

describe('chat thread trash lifecycle', () => {
  it('trash hides the thread everywhere; owner restore brings it back', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    const id = await seedThread(t, ALICE, 'doomed');
    const alice = t.withIdentity({ subject: ALICE });

    await expect(
      alice.mutation(api.chat.thread_lifecycle.trashThread, {
        organizationId: ORG,
        threadId: id,
      }),
    ).resolves.toBe(true);

    expect(
      await alice.query(api.chat.threads.listThreads, { organizationId: ORG }),
    ).toHaveLength(0);
    expect(
      await alice.query(api.chat.threads.getThread, {
        organizationId: ORG,
        threadId: id,
      }),
    ).toBeNull();
    expect(
      await alice.query(api.chat.messages.listMessages, {
        organizationId: ORG,
        threadId: id,
      }),
    ).toHaveLength(0);
    // Trashing again reports success (idempotent), never an error.
    await expect(
      alice.mutation(api.chat.thread_lifecycle.trashThread, {
        organizationId: ORG,
        threadId: id,
      }),
    ).resolves.toBe(true);

    await expect(
      alice.mutation(api.chat.thread_lifecycle.restoreThread, {
        organizationId: ORG,
        threadId: id,
      }),
    ).resolves.toBe(true);
    const rows = await alice.query(api.chat.threads.listThreads, {
      organizationId: ORG,
    });
    expect(rows.map((row) => row.title)).toEqual(['doomed']);

    const audits = await t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect()).map((row) => row.action),
    );
    expect(audits).toContain('chat_thread.trashed');
    expect(audits).toContain('chat_thread.restored_by_user');
  });

  it('refuses a foreign caller, a generating thread, and an expired self-restore', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    await seedMember(t, BOB);
    const id = await seedThread(t, ALICE, 'busy');

    await expect(
      t
        .withIdentity({ subject: BOB })
        .mutation(api.chat.thread_lifecycle.trashThread, {
          organizationId: ORG,
          threadId: id,
        }),
    ).resolves.toBe(false);

    await t.mutation(internal.chat.generations.beginGenerationInternal, {
      organizationId: ORG,
      threadId: id,
      streamId: 's1',
    });
    await expect(
      t
        .withIdentity({ subject: ALICE })
        .mutation(api.chat.thread_lifecycle.trashThread, {
          organizationId: ORG,
          threadId: id,
        }),
    ).resolves.toBe(false);
    await t.mutation(internal.chat.generations.endGenerationInternal, {
      organizationId: ORG,
      threadId: id,
    });

    // Expired (retention-marked) rows are the admin override's territory —
    // the owner's one-click restore only serves 'trashed'.
    await t.run(async (ctx) => {
      const normalized = ctx.db.normalizeId('threads', id);
      if (!normalized) throw new Error('bad id');
      await ctx.db.patch(normalized, {
        lifecycleStatus: 'expired',
        statusChangedAt: 1,
      });
    });
    await expect(
      t
        .withIdentity({ subject: ALICE })
        .mutation(api.chat.thread_lifecycle.restoreThread, {
          organizationId: ORG,
          threadId: id,
        }),
    ).resolves.toBe(false);
  });

  it('refuses to trash under an org-wide legal hold', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    const id = await seedThread(t, ALICE, 'held');
    await seedOrgHold(t);

    await expect(
      t
        .withIdentity({ subject: ALICE })
        .mutation(api.chat.thread_lifecycle.trashThread, {
          organizationId: ORG,
          threadId: id,
        }),
    ).rejects.toThrow(/legal hold/i);
  });

  it('purges page-bounded: children first, the thread row and audit last', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    const id = await seedThread(t, ALICE, 'big');
    await t.run(async (ctx) => {
      const threadId = ctx.db.normalizeId('threads', id);
      if (!threadId) throw new Error('bad id');
      for (let index = 0; index < 230; index += 1) {
        await ctx.db.insert('messages', {
          organizationId: ORG,
          threadId: id,
          role: 'user',
          parts: [{ type: 'text', text: `m${index}` }],
          sequence: index,
          createdAt: index,
        });
      }
      await ctx.db.insert('messageFeedback', {
        organizationId: ORG,
        threadId: id,
        messageId: 'm_1',
        userId: ALICE,
        rating: 'positive',
        createdAt: 1,
      });
      await ctx.db.patch(threadId, {
        lifecycleStatus: 'trashed',
        statusChangedAt: 1,
      });
    });

    const first = await t.mutation(
      internal.chat.thread_lifecycle.purgeThreadInternal,
      { organizationId: ORG, threadId: id },
    );
    expect(first.done).toBe(false);

    const second = await t.mutation(
      internal.chat.thread_lifecycle.purgeThreadInternal,
      { organizationId: ORG, threadId: id },
    );
    expect(second.done).toBe(true);

    const leftovers = await t.run(async (ctx) => {
      const threadId = ctx.db.normalizeId('threads', id);
      return {
        thread: threadId ? await ctx.db.get(threadId) : null,
        messages: (await ctx.db.query('messages').collect()).length,
        feedback: (await ctx.db.query('messageFeedback').collect()).length,
        audits: (await ctx.db.query('auditLogs').collect()).map(
          (row) => row.action,
        ),
      };
    });
    expect(leftovers.thread).toBeNull();
    expect(leftovers.messages).toBe(0);
    expect(leftovers.feedback).toBe(0);
    expect(leftovers.audits).toContain('chat_thread.retention_deleted');
  });

  it('skips the purge while a hold is active', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    const id = await seedThread(t, ALICE, 'frozen');
    await t.run(async (ctx) => {
      const threadId = ctx.db.normalizeId('threads', id);
      if (!threadId) throw new Error('bad id');
      await ctx.db.patch(threadId, {
        lifecycleStatus: 'trashed',
        statusChangedAt: 1,
      });
    });
    await seedOrgHold(t);

    const result = await t.mutation(
      internal.chat.thread_lifecycle.purgeThreadInternal,
      { organizationId: ORG, threadId: id },
    );
    expect(result).toEqual({ done: true, remaining: 0 });
    const survived = await t.run(async (ctx) => {
      const threadId = ctx.db.normalizeId('threads', id);
      return threadId ? await ctx.db.get(threadId) : null;
    });
    expect(survived).not.toBeNull();
  });

  it('selects retention candidates: live-and-old for pass A, grace-elapsed for pass B', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    await seedThread(t, ALICE, 'fresh', 9_000);
    const oldId = await seedThread(t, ALICE, 'old', 1_000);
    const trashedId = await seedThread(t, ALICE, 'trashed-old', 1_000);
    await t.run(async (ctx) => {
      const normalized = ctx.db.normalizeId('threads', trashedId);
      if (!normalized) throw new Error('bad id');
      await ctx.db.patch(normalized, {
        lifecycleStatus: 'trashed',
        statusChangedAt: 2_000,
      });
    });

    const passA = await t.query(
      internal.governance.internal_queries.listExpiredChatThreads,
      { organizationId: ORG, cutoffMs: 5_000, batchSize: 10 },
    );
    expect(passA.map((row: { title?: string }) => row.title)).toEqual(['old']);
    expect(String(passA[0]._id)).toBe(oldId);

    const passB = await t.query(
      internal.governance.internal_queries.listGraceExpiredChatThreads,
      { organizationId: ORG, graceCutoffMs: 5_000, batchSize: 10 },
    );
    expect(passB.map((row: { title?: string }) => row.title)).toEqual([
      'trashed-old',
    ]);
  });

  it('lists trashed chat threads for admins and restores them via governance', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, 'admin');
    const id = await seedThread(t, ALICE, 'admin-restorable');
    const alice = t.withIdentity({ subject: ALICE });
    await alice.mutation(api.chat.thread_lifecycle.trashThread, {
      organizationId: ORG,
      threadId: id,
    });

    const trash = await alice.query(api.governance.queries.listTrashedRows, {
      organizationId: ORG,
      resourceTypes: ['chatThread'],
    });
    expect(trash.rows).toHaveLength(1);
    expect(trash.rows[0]).toMatchObject({
      resourceType: 'chatThread',
      id,
      status: 'trashed',
      displayName: 'admin-restorable',
      ownerId: ALICE,
    });

    await alice.mutation(api.governance.restore.restoreSoftDeletedRow, {
      organizationId: ORG,
      resourceType: 'chatThread',
      rowId: id,
    });
    const restored = await t.run(async (ctx) => {
      const normalized = ctx.db.normalizeId('threads', id);
      return normalized ? await ctx.db.get(normalized) : null;
    });
    expect(restored?.lifecycleStatus).toBeUndefined();
    const audits = await t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect()).map((row) => row.action),
    );
    expect(audits).toContain('chat_thread.restored_by_admin');
  });
});
