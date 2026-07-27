/**
 * Branch mechanics: the copy boundary is the contract. An EDIT branch stops
 * BEFORE the edited user message (its replacement lands at the same
 * sequence); a REGENERATE branch keeps the prompt THROUGH it. Both stay
 * hidden from the sidebar, surface their activity on the root, and travel
 * with the root through the trash.
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

async function seedMember(t: T, userId: string): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}_${ORG}`,
      userId,
      organizationId: ORG,
      role: 'member',
      createdAt: 0,
    });
  });
}

/** A four-turn conversation: user(0) assistant(1) user(2) assistant(3). */
async function seedConversation(
  t: T,
): Promise<{ threadId: string; messageIds: string[] }> {
  const threadId = await t
    .withIdentity({ subject: ALICE })
    .mutation(api.chat.threads.createThread, {
      organizationId: ORG,
      kind: 'direct',
      title: 'rooted',
    });
  const messageIds = await t.run(async (ctx) => {
    const ids: string[] = [];
    const texts = ['q1', 'a1', 'q2', 'a2'];
    for (let sequence = 0; sequence < texts.length; sequence += 1) {
      ids.push(
        String(
          await ctx.db.insert('messages', {
            organizationId: ORG,
            threadId,
            role: sequence % 2 === 0 ? 'user' : 'assistant',
            parts: [{ type: 'text', text: texts[sequence] ?? '' }],
            sequence,
            createdAt: sequence,
          }),
        ),
      );
    }
    return ids;
  });
  return { threadId, messageIds };
}

async function branchMessages(
  t: T,
  branchId: string,
): Promise<Array<{ sequence: number; text: string }>> {
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query('messages')
      .withIndex('by_thread_sequence', (q) => q.eq('threadId', branchId))
      .collect();
    return rows.map((row) => {
      const parts: unknown = row.parts;
      const first = Array.isArray(parts) ? parts[0] : undefined;
      const text =
        first !== null &&
        typeof first === 'object' &&
        'text' in first &&
        typeof first.text === 'string'
          ? first.text
          : '';
      return { sequence: row.sequence, text };
    });
  });
}

describe('chat branches', () => {
  it('edit copies BEFORE the message; regenerate copies THROUGH the prompt', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    const { threadId, messageIds } = await seedConversation(t);
    const alice = t.withIdentity({ subject: ALICE });

    const editBranch = await alice.mutation(api.chat.branches.branchForEdit, {
      organizationId: ORG,
      threadId,
      editedMessageId: messageIds[2] ?? '',
    });
    expect(editBranch).not.toBeNull();
    expect(await branchMessages(t, editBranch ?? '')).toEqual([
      { sequence: 0, text: 'q1' },
      { sequence: 1, text: 'a1' },
    ]);

    const regenBranch = await alice.mutation(
      api.chat.branches.branchForRegenerate,
      {
        organizationId: ORG,
        threadId,
        assistantMessageId: messageIds[3] ?? '',
      },
    );
    expect(regenBranch).not.toBeNull();
    expect(await branchMessages(t, regenBranch ?? '')).toEqual([
      { sequence: 0, text: 'q1' },
      { sequence: 1, text: 'a1' },
      { sequence: 2, text: 'q2' },
    ]);

    // Both stay hidden: the sidebar shows one row per lineage.
    const listed = await alice.query(api.chat.threads.listThreads, {
      organizationId: ORG,
    });
    expect(listed.map((row) => row.id)).toEqual([threadId]);

    // And the lineage listing carries both with their fork points.
    const lineage = await alice.query(api.chat.branches.listThreadBranches, {
      organizationId: ORG,
      rootThreadId: threadId,
    });
    expect(
      lineage.branches
        .map((row) => `${row.id}:${row.forkSequence}`)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(
      [`${editBranch}:2`, `${regenBranch}:2`].sort((a, b) =>
        a.localeCompare(b),
      ),
    );
  });

  it('refuses the wrong roles and foreign threads', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    const { threadId, messageIds } = await seedConversation(t);
    const alice = t.withIdentity({ subject: ALICE });

    await expect(
      alice.mutation(api.chat.branches.branchForEdit, {
        organizationId: ORG,
        threadId,
        editedMessageId: messageIds[1] ?? '',
      }),
    ).resolves.toBeNull();
    await expect(
      alice.mutation(api.chat.branches.branchForRegenerate, {
        organizationId: ORG,
        threadId,
        assistantMessageId: messageIds[0] ?? '',
      }),
    ).resolves.toBeNull();
  });

  it('branch activity bumps the ROOT row the sidebar shows', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    const { threadId, messageIds } = await seedConversation(t);
    const alice = t.withIdentity({ subject: ALICE });
    await t.run(async (ctx) => {
      const id = ctx.db.normalizeId('threads', threadId);
      if (!id) throw new Error('bad id');
      await ctx.db.patch(id, { updatedAt: 1000 });
    });

    const branchId = await alice.mutation(api.chat.branches.branchForEdit, {
      organizationId: ORG,
      threadId,
      editedMessageId: messageIds[2] ?? '',
    });
    await t.mutation(internal.chat.messages.appendMessageInternal, {
      organizationId: ORG,
      threadId: branchId ?? '',
      role: 'assistant',
      parts: [{ type: 'text', text: 'new answer' }],
    });

    const root = (
      await alice.query(api.chat.threads.listThreads, { organizationId: ORG })
    )[0];
    expect(root?.updatedAt).toBeGreaterThan(1000);
    expect(root?.lastReplyAt).toBeGreaterThan(0);
  });

  it('persists sibling selections on the root, bounded', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    const { threadId } = await seedConversation(t);
    const alice = t.withIdentity({ subject: ALICE });

    for (let index = 0; index < 55; index += 1) {
      await alice.mutation(api.chat.branches.setBranchSelection, {
        organizationId: ORG,
        rootThreadId: threadId,
        forkKey: `${threadId}:${index}`,
        selectedThreadId: `pick_${index}`,
      });
    }
    const lineage = await alice.query(api.chat.branches.listThreadBranches, {
      organizationId: ORG,
      rootThreadId: threadId,
    });
    const selections: unknown = JSON.parse(lineage.selections ?? '{}');
    const keys = Object.keys(selections as Record<string, string>);
    expect(keys.length).toBeLessThanOrEqual(50);
    expect(keys).toContain(`${threadId}:54`);
    expect(keys).not.toContain(`${threadId}:0`);
  });

  it('the lineage travels through trash and restore together', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    const { threadId, messageIds } = await seedConversation(t);
    const alice = t.withIdentity({ subject: ALICE });
    const branchId = await alice.mutation(api.chat.branches.branchForEdit, {
      organizationId: ORG,
      threadId,
      editedMessageId: messageIds[2] ?? '',
    });

    await alice.mutation(api.chat.thread_lifecycle.trashThread, {
      organizationId: ORG,
      threadId,
    });
    let branchRow = await t.run(async (ctx) => {
      const id = ctx.db.normalizeId('threads', branchId ?? '');
      return id ? await ctx.db.get(id) : null;
    });
    expect(branchRow?.lifecycleStatus).toBe('trashed');

    await alice.mutation(api.chat.thread_lifecycle.restoreThread, {
      organizationId: ORG,
      threadId,
    });
    branchRow = await t.run(async (ctx) => {
      const id = ctx.db.normalizeId('threads', branchId ?? '');
      return id ? await ctx.db.get(id) : null;
    });
    expect(branchRow?.lifecycleStatus).toBeUndefined();
  });
});
