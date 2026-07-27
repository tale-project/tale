/**
 * Chat search is a bounded scan over the CALLER'S OWN active threads — the
 * isolation and the AND-matching are the contract; a regression either leaks
 * another member's conversations into the palette or floods it with noise.
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

const ORG = 'org_a';
const ALICE = 'user_alice';
const BOB = 'user_bob';

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

async function seedThreadWithMessage(
  t: T,
  userId: string,
  title: string,
  messageText: string,
): Promise<string> {
  const threadId = await t
    .withIdentity({ subject: userId })
    .mutation(api.chat.threads.createThread, {
      organizationId: ORG,
      kind: 'direct',
      title,
    });
  await t.run(async (ctx) => {
    await ctx.db.insert('messages', {
      organizationId: ORG,
      threadId,
      role: 'assistant',
      parts: [{ type: 'text', text: messageText }],
      sequence: 0,
      createdAt: 1,
    });
  });
  return threadId;
}

describe('chat search', () => {
  it('matches title OR message text with every token, newest first', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    const byTitle = await seedThreadWithMessage(
      t,
      ALICE,
      'Printer return policy',
      'irrelevant',
    );
    const byBody = await seedThreadWithMessage(
      t,
      ALICE,
      'untitled-ish',
      'You can return the printer within 30 days.',
    );
    await seedThreadWithMessage(t, ALICE, 'other topic', 'about invoices');

    const hits = await t
      .withIdentity({ subject: ALICE })
      .query(api.chat.search.searchChats, {
        organizationId: ORG,
        query: 'printer return',
      });
    expect(hits.map((hit) => hit.threadId).sort()).toEqual(
      [byTitle, byBody].sort(),
    );
    const bodyHit = hits.find((hit) => hit.threadId === byBody);
    expect(bodyHit?.snippet).toContain('within 30 days');
  });

  it("never surfaces another member's conversations", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    await seedMember(t, BOB);
    await seedThreadWithMessage(t, ALICE, 'secret plans', 'the secret roadmap');

    const hits = await t
      .withIdentity({ subject: BOB })
      .query(api.chat.search.searchChats, {
        organizationId: ORG,
        query: 'secret',
      });
    expect(hits).toEqual([]);
  });

  it('answers nothing for a blank query and skips trashed threads', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    const threadId = await seedThreadWithMessage(
      t,
      ALICE,
      'doomed',
      'doomed text',
    );
    await t.run(async (ctx) => {
      const id = ctx.db.normalizeId('threads', threadId);
      if (!id) throw new Error('bad id');
      await ctx.db.patch(id, {
        lifecycleStatus: 'trashed',
        statusChangedAt: 1,
      });
    });

    const alice = t.withIdentity({ subject: ALICE });
    await expect(
      alice.query(api.chat.search.searchChats, {
        organizationId: ORG,
        query: '   ',
      }),
    ).resolves.toEqual([]);
    await expect(
      alice.query(api.chat.search.searchChats, {
        organizationId: ORG,
        query: 'doomed',
      }),
    ).resolves.toEqual([]);
  });
});
