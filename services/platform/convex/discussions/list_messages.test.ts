import { convexTest, type TestConvex } from 'convex-test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `listDiscussionMessages` reads the transcript through the @convex-dev/agent
// message store; convexTest registers no components, so stub the store with an
// in-memory page and a shape-faithful `toUIMessages`.
interface FakeMessageDoc {
  _id: string;
  _creationTime: number;
  order: number;
  userId?: string;
  message: { role: 'user' | 'assistant' | 'system'; content: string };
}
let storeMessages: FakeMessageDoc[] = [];
vi.mock('@convex-dev/agent', () => ({
  // The real listMessages returns newest-first pages; getThreadMessages
  // paginates then reverses, so serve newest-first here too.
  listMessages: vi.fn(async () => ({
    page: storeMessages.toReversed(),
    continueCursor: null,
    isDone: true,
  })),
  toUIMessages: (docs: FakeMessageDoc[]) =>
    docs.map((doc) => ({
      id: doc._id,
      _creationTime: doc._creationTime,
      order: doc.order,
      role: doc.message.role,
      text: doc.message.content,
    })),
}));

import { api } from '../_generated/api';
import schema from '../schema';

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

const ORG = 'org_list_messages';
const THREAD = 'thread_lm_1';
const MEMBER = 'user_member_1';
type T = TestConvex<typeof schema>;

async function seed(t: T): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('threadMetadata', {
      threadId: THREAD,
      userId: MEMBER,
      chatType: 'general',
      status: 'active',
      kind: 'project_discussion',
      discussionStatus: 'open',
      organizationId: ORG,
      title: 'Transcript under test',
      createdAt: 0,
      updatedAt: 0,
      lastReplyAt: 0,
      agentReplyDepth: 0,
    });
    // Membership resolves through the local memberMirror (no cross-component
    // read), so seeding it is all the auth gate needs. The outsider is seeded
    // as a DISABLED member: a mirror hit that denies, keeping the deny path
    // off the Better Auth fallback convexTest cannot register.
    await ctx.db.insert('memberMirror', {
      memberId: 'ba_member_1',
      userId: MEMBER,
      organizationId: ORG,
      role: 'member',
      createdAt: 0,
    });
    await ctx.db.insert('memberMirror', {
      memberId: 'ba_member_2',
      userId: 'user_outsider',
      organizationId: ORG,
      role: 'disabled',
      createdAt: 0,
    });
  });
}

beforeEach(() => {
  storeMessages = [];
});

describe('listDiscussionMessages', () => {
  it('returns the transcript oldest-first with authorship mapped from userId', async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    storeMessages = [
      {
        _id: 'm1',
        _creationTime: 1000,
        order: 0,
        // Human-authored opener stored role:'assistant' — authorship must
        // come from userId, not the role.
        userId: MEMBER,
        message: { role: 'assistant', content: 'Opening post' },
      },
      {
        _id: 'm2',
        _creationTime: 2000,
        order: 1,
        userId: 'support-agent',
        message: { role: 'assistant', content: 'Agent reply' },
      },
      {
        _id: 'm3',
        _creationTime: 3000,
        order: 2,
        userId: 'system',
        message: { role: 'assistant', content: 'Converted to task' },
      },
    ];

    const result = await t
      .withIdentity({ subject: MEMBER })
      .query(api.discussions.queries.listDiscussionMessages, {
        organizationId: ORG,
        threadId: THREAD,
      });

    expect(result).toEqual([
      {
        messageId: 'm1',
        role: 'assistant',
        authorId: MEMBER,
        body: 'Opening post',
        createdAt: 1000,
      },
      {
        messageId: 'm2',
        role: 'assistant',
        authorId: 'support-agent',
        body: 'Agent reply',
        createdAt: 2000,
      },
      {
        messageId: 'm3',
        role: 'assistant',
        authorId: 'system',
        body: 'Converted to task',
        createdAt: 3000,
      },
    ]);
  });

  it('omits authorId for rows saved without authorship', async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    storeMessages = [
      {
        _id: 'm1',
        _creationTime: 1000,
        order: 0,
        message: { role: 'user', content: 'Legacy row' },
      },
    ];

    const result = await t
      .withIdentity({ subject: MEMBER })
      .query(api.discussions.queries.listDiscussionMessages, {
        organizationId: ORG,
        threadId: THREAD,
      });

    expect(result).toEqual([
      {
        messageId: 'm1',
        role: 'user',
        body: 'Legacy row',
        createdAt: 1000,
      },
    ]);
  });

  it('returns [] for a non-member and for an unknown thread', async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    storeMessages = [
      {
        _id: 'm1',
        _creationTime: 1000,
        order: 0,
        userId: MEMBER,
        message: { role: 'user', content: 'Members only' },
      },
    ];

    await expect(
      t
        .withIdentity({ subject: 'user_outsider' })
        .query(api.discussions.queries.listDiscussionMessages, {
          organizationId: ORG,
          threadId: THREAD,
        }),
    ).resolves.toEqual([]);

    await expect(
      t
        .withIdentity({ subject: MEMBER })
        .query(api.discussions.queries.listDiscussionMessages, {
          organizationId: ORG,
          threadId: 'thread_missing',
        }),
    ).resolves.toEqual([]);
  });
});
