import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import { notifyDiscussionMentions } from './notify';

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

const ORG = 'org_discussion_notify';
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

async function seedProject(t: T): Promise<Id<'projects'>> {
  return await t.run((ctx) =>
    ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Roadmap',
      createdBy: AUTHOR,
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

describe('notifyDiscussionMentions', () => {
  it('writes an actionable mention row for each mentioned human', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, AUTHOR);
    await seedMember(t, MENTIONED);
    const projectId = await seedProject(t);
    const threadId = 'thread_design_review';

    await t.run(async (ctx) => {
      await notifyDiscussionMentions(ctx, {
        organizationId: ORG,
        threadId,
        discussionTitle: 'API shape',
        projectId,
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
    expect(rows[0]).toMatchObject({
      type: 'mention',
      resourceType: 'thread',
      resourceId: threadId,
      read: false,
      titleKey: 'mention',
      params: {
        title: 'API shape',
        projectId: String(projectId),
        threadId,
      },
    });
  });

  it('skips self-mentions and agent mentions', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, AUTHOR);
    const projectId = await seedProject(t);

    await t.run(async (ctx) => {
      await notifyDiscussionMentions(ctx, {
        organizationId: ORG,
        threadId: 'thread_self',
        discussionTitle: 'Solo',
        projectId,
        mentions: [
          { type: 'user', id: AUTHOR },
          { type: 'agent', id: 'ops-agent' },
        ],
        actorType: 'user',
        actorId: AUTHOR,
      });
    });

    const rows = await t.run(async (ctx) =>
      ctx.db.query('userNotifications').collect(),
    );
    expect(rows).toHaveLength(0);
  });
});
