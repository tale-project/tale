import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import schema from '../schema';
import {
  DISCUSSION_MENTION_EVENT,
  DISCUSSION_MENTION_INSTRUCTIONS,
  dispatchAgentMentionRuns,
  hasLiveDiscussionMentionAutomation,
} from './mention_dispatch';

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

const ORG = 'org_mention_dispatch';
const THREAD = 'thread_discussion_1';
const PACK_SLUG = 'projects/discussions/react-to-discussion-mention';
type T = TestConvex<typeof schema>;

async function seedSubscription(
  t: T,
  overrides: { isActive?: boolean; workflowSlug?: string } = {},
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('wfEventSubscriptions', {
      organizationId: ORG,
      workflowSlug: overrides.workflowSlug ?? PACK_SLUG,
      eventType: DISCUSSION_MENTION_EVENT,
      isActive: overrides.isActive ?? true,
      createdAt: 0,
      createdBy: 'system',
    });
  });
}

async function seedInstallation(t: T, workflowSlug = PACK_SLUG): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('wfInstallations', {
      organizationId: ORG,
      workflowSlug,
      installedAt: 0,
      installedBy: 'system',
      contentHash: 'hash',
    });
  });
}

async function scheduledAgentRuns(t: T) {
  const scheduled = await t.run((ctx) =>
    ctx.db.system.query('_scheduled_functions').collect(),
  );
  return scheduled.filter((job) => job.name.includes('runAgentOnDiscussion'));
}

function dispatch(
  t: T,
  args?: Partial<Parameters<typeof dispatchAgentMentionRuns>[1]>,
) {
  return t.run((ctx) =>
    dispatchAgentMentionRuns(ctx, {
      organizationId: ORG,
      threadId: THREAD,
      mentions: [{ type: 'agent', id: 'assistant' }],
      actorType: 'user',
      actorId: 'user_author',
      ...args,
    }),
  );
}

describe('dispatchAgentMentionRuns', () => {
  it('schedules one runAgentOnDiscussion per agent mention when no automation is live', async () => {
    const t = convexTest(schema, modules);

    const count = await dispatch(t, {
      mentions: [
        { type: 'agent', id: 'assistant' },
        { type: 'user', id: 'user_teammate' },
        { type: 'agent', id: 'content-writer' },
      ],
    });

    expect(count).toBe(2);
    const runs = await scheduledAgentRuns(t);
    expect(runs).toHaveLength(2);
    expect(runs.map((job) => job.args[0])).toEqual([
      {
        organizationId: ORG,
        agentSlug: 'assistant',
        threadId: THREAD,
        instructions: DISCUSSION_MENTION_INSTRUCTIONS,
      },
      {
        organizationId: ORG,
        agentSlug: 'content-writer',
        threadId: THREAD,
        instructions: DISCUSSION_MENTION_INSTRUCTIONS,
      },
    ]);
  });

  it('never lets an agent trigger itself (mirrors the pack is_agent guard)', async () => {
    const t = convexTest(schema, modules);

    const count = await dispatch(t, {
      mentions: [{ type: 'agent', id: 'assistant' }],
      actorType: 'agent',
      actorId: 'assistant',
    });

    expect(count).toBe(0);
    expect(await scheduledAgentRuns(t)).toHaveLength(0);
  });

  it('treats workflow-actor writes as inert (mirrors the pack not_workflow guard)', async () => {
    const t = convexTest(schema, modules);

    const count = await dispatch(t, { actorType: 'workflow' });

    expect(count).toBe(0);
    expect(await scheduledAgentRuns(t)).toHaveLength(0);
  });

  it('skips dispatch when an active subscription with an installed workflow owns the event', async () => {
    const t = convexTest(schema, modules);
    await seedSubscription(t);
    await seedInstallation(t);

    const count = await dispatch(t);

    expect(count).toBe(0);
    expect(await scheduledAgentRuns(t)).toHaveLength(0);
  });

  it('dispatches when the subscription is inactive (processEvent would skip it)', async () => {
    const t = convexTest(schema, modules);
    await seedSubscription(t, { isActive: false });
    await seedInstallation(t);

    const count = await dispatch(t);

    expect(count).toBe(1);
    expect(await scheduledAgentRuns(t)).toHaveLength(1);
  });

  it('dispatches when the subscribed workflow has no installation (processEvent would skip it)', async () => {
    const t = convexTest(schema, modules);
    await seedSubscription(t);

    const count = await dispatch(t);

    expect(count).toBe(1);
    expect(await scheduledAgentRuns(t)).toHaveLength(1);
  });
});

describe('hasLiveDiscussionMentionAutomation', () => {
  it('requires BOTH an active subscription and its installation', async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run((ctx) => hasLiveDiscussionMentionAutomation(ctx, ORG)),
    ).resolves.toBe(false);

    await seedSubscription(t);
    await expect(
      t.run((ctx) => hasLiveDiscussionMentionAutomation(ctx, ORG)),
    ).resolves.toBe(false);

    await seedInstallation(t);
    await expect(
      t.run((ctx) => hasLiveDiscussionMentionAutomation(ctx, ORG)),
    ).resolves.toBe(true);
  });
});
