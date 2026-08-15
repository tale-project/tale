/**
 * The merged turn-open write. These pin the contract the merge must keep
 * identical to the three standalone writes it replaced: sequence assignment,
 * ordering, the generation row's reset-or-insert, the first-message title
 * schedule — and the one thing the merge newly guarantees, atomicity (a
 * failing open persists NOTHING, where the split writes stranded a user
 * message or an orphaned placeholder).
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
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

const ORG = 'org_turn_setup';
const USER = 'user_turn_setup';

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

async function threadMessages(t: T, threadId: Id<'threads'>) {
  return t.run(async (ctx) =>
    ctx.db
      .query('messages')
      .withIndex('by_thread_sequence', (q) => q.eq('threadId', threadId))
      .collect(),
  );
}

async function threadGenerations(t: T, threadId: Id<'threads'>) {
  return t.run(async (ctx) =>
    ctx.db
      .query('generations')
      .withIndex('by_thread', (q) => q.eq('threadId', threadId))
      .collect(),
  );
}

describe('chat turn open — one transaction', () => {
  it('lands the user message, the placeholder, and the generation row together', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);

    const opened = await t.mutation(
      internal.chat.turn_setup.beginTurnInternal,
      {
        organizationId: ORG,
        threadId,
        userParts: [{ type: 'text', text: 'Hi there' }],
        truncation: { droppedMessages: 4 },
      },
    );

    expect(opened.userMessage?.sequence).toBe(0);
    expect(opened.assistantMessage.sequence).toBe(1);

    const messages = await threadMessages(t, threadId);
    expect(messages.map((m) => [m.role, m.sequence])).toEqual([
      ['user', 0],
      ['assistant', 1],
    ]);
    expect(messages[0]?.parts).toEqual([{ type: 'text', text: 'Hi there' }]);
    expect(messages[1]?.parts).toEqual([]);
    // The truncation stamp rides the reply row, exactly as the split writes
    // stamped it.
    expect(messages[1]?.truncation).toEqual({ droppedMessages: 4 });

    const generations = await threadGenerations(t, threadId);
    expect(generations).toHaveLength(1);
    expect(generations[0]?.status).toBe('queued');
    expect(generations[0]?.messageId).toBe(opened.assistantMessage.id);

    // The thread's freshness stamps moved, and the assistant row stamped the
    // unread watermark.
    const thread = await t.run(async (ctx) => ctx.db.get(threadId));
    expect(thread?.updatedAt).toBeGreaterThan(0);
    expect(thread?.lastReplyAt).toBeGreaterThan(0);
  });

  it('a user-less open (regenerate) continues the sequence with the placeholder alone', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    await t.mutation(internal.chat.messages.appendMessageInternal, {
      organizationId: ORG,
      threadId,
      role: 'user',
      parts: [{ type: 'text', text: 'again please' }],
    });

    const opened = await t.mutation(
      internal.chat.turn_setup.beginTurnInternal,
      {
        organizationId: ORG,
        threadId,
      },
    );

    expect(opened.userMessage).toBeUndefined();
    expect(opened.assistantMessage.sequence).toBe(1);
    const messages = await threadMessages(t, threadId);
    expect(messages.map((m) => [m.role, m.sequence])).toEqual([
      ['user', 0],
      ['assistant', 1],
    ]);
  });

  it('schedules the title exactly once — for the opening user message, never the placeholder', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);

    await t.mutation(internal.chat.turn_setup.beginTurnInternal, {
      organizationId: ORG,
      threadId,
      userParts: [{ type: 'text', text: 'Name this conversation' }],
    });

    const scheduled = await t.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    const titleJobs = scheduled.filter((job) =>
      job.name.includes('generateThreadTitle'),
    );
    expect(titleJobs).toHaveLength(1);
    expect(titleJobs[0]?.args[0]).toMatchObject({
      organizationId: ORG,
      threadId,
      userId: USER,
      firstMessage: 'Name this conversation',
    });
  });

  it('resets an existing generation row instead of stacking a second one', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    await t.mutation(internal.chat.generations.beginGenerationInternal, {
      organizationId: ORG,
      threadId,
    });

    const opened = await t.mutation(
      internal.chat.turn_setup.beginTurnInternal,
      {
        organizationId: ORG,
        threadId,
        userParts: [{ type: 'text', text: 'take two' }],
      },
    );

    const generations = await threadGenerations(t, threadId);
    expect(generations).toHaveLength(1);
    expect(generations[0]?.status).toBe('queued');
    expect(generations[0]?.messageId).toBe(opened.assistantMessage.id);
  });

  it('persists NOTHING when the open fails — no stranded user message, no orphan placeholder', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    const foreign = 'org_someone_else';

    await expect(
      t.mutation(internal.chat.turn_setup.beginTurnInternal, {
        organizationId: foreign,
        threadId,
        userParts: [{ type: 'text', text: 'should never land' }],
      }),
    ).rejects.toThrow(/not in organization/);

    expect(await threadMessages(t, threadId)).toEqual([]);
    expect(await threadGenerations(t, threadId)).toEqual([]);
  });
});
