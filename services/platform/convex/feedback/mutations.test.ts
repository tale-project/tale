/**
 * Feedback targets the chat-v2 tables: a rating must land on an assistant
 * message of the CALLER'S OWN conversation, and attribution is stamped
 * server-side from the thread and message rows — the analytics this table
 * feeds must never trust a client-supplied model label.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'feedback';
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

/** A thread of `userId` with one user turn and one attributed assistant
 * reply; returns both ids. */
async function seedConversation(
  t: T,
  userId: string,
): Promise<{ threadId: string; assistantId: string; userMessageId: string }> {
  const threadId = await t
    .withIdentity({ subject: userId })
    .mutation(api.chat.threads.createThread, {
      organizationId: ORG,
      kind: 'direct',
      title: 'rated',
      agentSlug: 'assistant',
    });
  const { userMessageId, assistantId } = await t.run(async (ctx) => {
    const user = await ctx.db.insert('messages', {
      organizationId: ORG,
      threadId,
      role: 'user',
      parts: [{ type: 'text', text: 'hi' }],
      sequence: 0,
      createdAt: 1,
    });
    const assistant = await ctx.db.insert('messages', {
      organizationId: ORG,
      threadId,
      role: 'assistant',
      parts: [{ type: 'text', text: 'hello' }],
      sequence: 1,
      model: 'claude-fable-5',
      providerSlug: 'anthropic',
      createdAt: 2,
    });
    return { userMessageId: String(user), assistantId: String(assistant) };
  });
  return { threadId, assistantId, userMessageId };
}

describe('feedback on chat-v2 messages', () => {
  it('stamps attribution server-side, on insert and on re-rate', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    const { threadId, assistantId } = await seedConversation(t, ALICE);
    const alice = t.withIdentity({ subject: ALICE });

    await alice.mutation(api.feedback.mutations.submitFeedback, {
      organizationId: ORG,
      threadId,
      messageId: assistantId,
      rating: 'positive',
    });
    let row = await t.run(async (ctx) =>
      ctx.db.query('messageFeedback').first(),
    );
    expect(row).toMatchObject({
      rating: 'positive',
      model: 'claude-fable-5',
      provider: 'anthropic',
      agentSlug: 'assistant',
      userId: ALICE,
    });

    await alice.mutation(api.feedback.mutations.submitFeedback, {
      organizationId: ORG,
      threadId,
      messageId: assistantId,
      rating: 'negative',
      comment: 'too short',
    });
    const rows = await t.run(async (ctx) =>
      ctx.db.query('messageFeedback').collect(),
    );
    expect(rows).toHaveLength(1);
    row = rows[0] ?? null;
    expect(row).toMatchObject({
      rating: 'negative',
      comment: 'too short',
      model: 'claude-fable-5',
    });
  });

  it("refuses another member's conversation and non-assistant targets", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    await seedMember(t, BOB);
    const { threadId, assistantId, userMessageId } = await seedConversation(
      t,
      ALICE,
    );

    await expect(
      t
        .withIdentity({ subject: BOB })
        .mutation(api.feedback.mutations.submitFeedback, {
          organizationId: ORG,
          threadId,
          messageId: assistantId,
          rating: 'positive',
        }),
    ).rejects.toThrow();

    await expect(
      t
        .withIdentity({ subject: ALICE })
        .mutation(api.feedback.mutations.submitFeedback, {
          organizationId: ORG,
          threadId,
          messageId: userMessageId,
          rating: 'positive',
        }),
    ).rejects.toThrow();
  });

  it('lists only the caller’s ratings for a thread, and delete removes them', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ALICE);
    await seedMember(t, BOB);
    const { threadId, assistantId } = await seedConversation(t, ALICE);
    const alice = t.withIdentity({ subject: ALICE });

    await alice.mutation(api.feedback.mutations.submitFeedback, {
      organizationId: ORG,
      threadId,
      messageId: assistantId,
      rating: 'positive',
    });
    // A foreign row on the same thread (seeded directly — Bob could never
    // submit one) must never leak into Alice's map.
    await t.run(async (ctx) => {
      await ctx.db.insert('messageFeedback', {
        organizationId: ORG,
        threadId,
        messageId: assistantId,
        userId: BOB,
        rating: 'negative',
        createdAt: 1,
      });
    });

    const mine = await alice.query(api.feedback.queries.listThreadFeedback, {
      organizationId: ORG,
      threadId,
    });
    expect(mine).toEqual([
      { messageId: assistantId, rating: 'positive', comment: undefined },
    ]);

    await alice.mutation(api.feedback.mutations.deleteFeedback, {
      organizationId: ORG,
      messageId: assistantId,
    });
    await expect(
      alice.query(api.feedback.queries.listThreadFeedback, {
        organizationId: ORG,
        threadId,
      }),
    ).resolves.toEqual([]);
  });
});
