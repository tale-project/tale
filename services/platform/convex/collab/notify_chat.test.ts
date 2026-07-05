import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import { notifyChatMentions } from './notify';

const TEST_DIR_FROM_CONVEX_ROOT = 'collab';
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

const ORG = 'org_chat_notify';
const AUTHOR = 'user_author';
const MENTIONED = 'user_mentioned';
type T = TestConvex<typeof schema>;

async function seedMember(t: T, userId: string): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}`,
      userId,
      organizationId: ORG,
      role: 'editor',
      createdAt: 0,
    });
  });
}

describe('notifyChatMentions', () => {
  it('writes a mention row with chat deep-link params', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, AUTHOR);
    await seedMember(t, MENTIONED);
    const threadId = 'thread_planning';

    await t.run(async (ctx) => {
      await notifyChatMentions(ctx, {
        organizationId: ORG,
        threadId,
        threadTitle: 'Planning',
        mentions: [{ type: 'user', id: MENTIONED }],
        actorType: 'user',
        actorId: AUTHOR,
      });
    });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('userNotifications')
        .withIndex('by_user_org_created', (q) =>
          q.eq('userId', MENTIONED).eq('organizationId', ORG),
        )
        .collect(),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.params).toMatchObject({
      title: 'Planning',
      threadId,
      chat: true,
    });
  });
});
