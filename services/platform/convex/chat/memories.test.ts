/**
 * A memory is durable state about a person, so two properties must hold: it
 * lands pending and is invisible to retrieval until a human approves it, and
 * proposing one is auditable the moment it happens. These tests pin both, plus
 * the isolation every memory read and the approval decision are scoped by.
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

describe('chat memories — save and approval gate', () => {
  it('saves a memory as pending and records the proposal in the audit trail', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);

    const memoryId = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.memories.saveMemory, {
        organizationId: ORG_A,
        content: 'Alice prefers metric units.',
      });

    // The row is pending, not approved.
    const row = await t.run(async (ctx) => ctx.db.get(memoryId));
    expect(row?.status).toBe('pending');
    expect(row?.userId).toBe(ALICE);
    expect(row?.organizationId).toBe(ORG_A);

    // An audit entry names the proposal.
    const audits = await t.run(async (ctx) =>
      ctx.db
        .query('auditLogs')
        .withIndex('by_organizationId', (q) => q.eq('organizationId', ORG_A))
        .collect(),
    );
    const saved = audits.find((a) => a.action === 'memory.save');
    expect(saved).toBeDefined();
    expect(saved?.category).toBe('ai');
    expect(saved?.resourceId).toBe(memoryId);
    expect(saved?.actorId).toBe(ALICE);
  });

  it('returns only approved memories from search, never pending ones', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);

    const pendingId = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.memories.saveMemory, {
        organizationId: ORG_A,
        content: 'Pending fact about Alice.',
      });

    // Nothing approved yet — search is empty.
    let found = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.memories.searchMemories, { organizationId: ORG_A });
    expect(found).toHaveLength(0);

    // Approve it, then it becomes searchable.
    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.memories.reviewMemory, {
        organizationId: ORG_A,
        memoryId: pendingId,
        decision: 'approved',
      });

    found = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.memories.searchMemories, { organizationId: ORG_A });
    expect(found).toHaveLength(1);
    expect(found[0]?.content).toBe('Pending fact about Alice.');

    // listMemories separates the buckets.
    const listed = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.memories.listMemories, { organizationId: ORG_A });
    expect(listed.pending).toHaveLength(0);
    expect(listed.approved).toHaveLength(1);
  });

  it('rejects a memory so it never reaches search', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);

    const id = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.memories.saveMemory, {
        organizationId: ORG_A,
        content: 'A fact to reject.',
      });
    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.memories.reviewMemory, {
        organizationId: ORG_A,
        memoryId: id,
        decision: 'rejected',
      });

    const found = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.memories.searchMemories, { organizationId: ORG_A });
    expect(found).toHaveLength(0);
  });
});

describe('chat memories — scoping', () => {
  it('never returns one member’s memory to another, or across organizations', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    await seedMember(t, BOB, ORG_A);
    await seedMember(t, ALICE, ORG_B);

    const id = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.memories.saveMemory, {
        organizationId: ORG_A,
        content: 'Alice-only fact.',
      });
    await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.memories.reviewMemory, {
        organizationId: ORG_A,
        memoryId: id,
        decision: 'approved',
      });

    // Bob, same org, sees nothing.
    const asBob = await t
      .withIdentity({ subject: BOB })
      .query(api.chat.memories.searchMemories, { organizationId: ORG_A });
    expect(asBob).toHaveLength(0);

    // Alice under a different org sees nothing.
    const asAliceInB = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.memories.searchMemories, { organizationId: ORG_B });
    expect(asAliceInB).toHaveLength(0);
  });

  it('refuses to review a memory the caller does not own', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE, ORG_A);
    await seedMember(t, BOB, ORG_A);

    const id = await t
      .withIdentity({ subject: ALICE })
      .mutation(api.chat.memories.saveMemory, {
        organizationId: ORG_A,
        content: 'Alice-only.',
      });

    const bobReview = await t
      .withIdentity({ subject: BOB })
      .mutation(api.chat.memories.reviewMemory, {
        organizationId: ORG_A,
        memoryId: id,
        decision: 'approved',
      });
    expect(bobReview).toBe(false);

    const stillPending = await t.run(async (ctx) => ctx.db.get(id));
    expect(stillPending?.status).toBe('pending');
  });
});
