import { convexTest, type TestConvex } from 'convex-test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `postDiscussionSystemNotice` persists through the @convex-dev/agent message
// store; convexTest registers no components, so stub the two component calls
// its module imports and assert on the stub.
const mockSaveMessage = vi.fn();
vi.mock('@convex-dev/agent', () => ({
  createThread: vi.fn(),
  saveMessage: (...args: unknown[]) => mockSaveMessage(...args),
}));

import schema from '../schema';
import { postDiscussionSystemNotice } from './internal_mutations';

const TEST_DIR_FROM_CONVEX_ROOT = 'discussions';
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

const ORG = 'org_system_notice';
const THREAD = 'thread_notice_1';
type T = TestConvex<typeof schema>;

async function seedDiscussion(
  t: T,
  overrides: {
    discussionStatus?: 'open' | 'resolved' | 'locked';
    kind?: 'chat' | 'project_discussion';
  } = {},
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('threadMetadata', {
      threadId: THREAD,
      userId: 'system',
      chatType: 'general',
      status: 'active',
      kind: overrides.kind ?? 'project_discussion',
      discussionStatus: overrides.discussionStatus ?? 'open',
      organizationId: ORG,
      title: 'How should we get started?',
      createdAt: 0,
      updatedAt: 0,
      lastReplyAt: 0,
      agentReplyDepth: 0,
    });
  });
}

describe('postDiscussionSystemNotice', () => {
  beforeEach(() => {
    mockSaveMessage.mockClear();
  });

  it('posts a System-authored assistant message without advancing the agent reply depth', async () => {
    const t = convexTest(schema, modules);
    await seedDiscussion(t);

    const result = await t.run((ctx) =>
      postDiscussionSystemNotice(ctx, {
        organizationId: ORG,
        threadId: THREAD,
        message:
          'The agent "assistant" was mentioned here but could not reply: provider unavailable',
      }),
    );

    expect(result).toEqual({ posted: true });
    expect(mockSaveMessage).toHaveBeenCalledTimes(1);
    expect(mockSaveMessage.mock.calls[0]?.[2]).toEqual({
      threadId: THREAD,
      message: {
        role: 'assistant',
        content:
          'The agent "assistant" was mentioned here but could not reply: provider unavailable',
      },
      userId: 'system',
    });

    const meta = await t.run((ctx) =>
      ctx.db
        .query('threadMetadata')
        .withIndex('by_threadId', (q) => q.eq('threadId', THREAD))
        .first(),
    );
    // Activity timestamps advance; the notice is NOT an agent turn.
    expect(meta?.updatedAt).toBeGreaterThan(0);
    expect(meta?.lastReplyAt).toBeGreaterThan(0);
    expect(meta?.agentReplyDepth).toBe(0);
  });

  it('refuses on a locked discussion without writing', async () => {
    const t = convexTest(schema, modules);
    await seedDiscussion(t, { discussionStatus: 'locked' });

    const result = await t.run((ctx) =>
      postDiscussionSystemNotice(ctx, {
        organizationId: ORG,
        threadId: THREAD,
        message: 'notice',
      }),
    );

    expect(result).toEqual({ posted: false, reason: 'discussion_locked' });
    expect(mockSaveMessage).not.toHaveBeenCalled();
  });

  it('refuses when the thread is missing or not a discussion', async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.run((ctx) =>
        postDiscussionSystemNotice(ctx, {
          organizationId: ORG,
          threadId: 'thread_nonexistent',
          message: 'notice',
        }),
      ),
    ).resolves.toEqual({ posted: false, reason: 'discussion_not_found' });

    // A private chat thread must never accept a discussion notice.
    await seedDiscussion(t, { kind: 'chat' });
    await expect(
      t.run((ctx) =>
        postDiscussionSystemNotice(ctx, {
          organizationId: ORG,
          threadId: THREAD,
          message: 'notice',
        }),
      ),
    ).resolves.toEqual({ posted: false, reason: 'discussion_not_found' });
    expect(mockSaveMessage).not.toHaveBeenCalled();
  });
});
