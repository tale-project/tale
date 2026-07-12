import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import {
  TASK_MENTION_EVENT,
  TASK_MENTION_INSTRUCTIONS,
  dispatchAgentTaskMentionRuns,
} from './mention_dispatch';

const TEST_DIR_FROM_CONVEX_ROOT = 'tasks';
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

const ORG = 'org_task_mention_dispatch';
const TASK_ID = 'task_1';
const PACK_SLUG = 'projects/tasks/react-to-task-mention';
type T = TestConvex<typeof schema>;

async function seedSubscription(
  t: T,
  overrides: { isActive?: boolean; workflowSlug?: string } = {},
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('wfEventSubscriptions', {
      organizationId: ORG,
      workflowSlug: overrides.workflowSlug ?? PACK_SLUG,
      eventType: TASK_MENTION_EVENT,
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
  return scheduled.filter((job) => job.name.includes('runAgentOnTask'));
}

function dispatch(
  t: T,
  args?: Partial<Parameters<typeof dispatchAgentTaskMentionRuns>[1]>,
) {
  return t.run((ctx) =>
    dispatchAgentTaskMentionRuns(ctx, {
      organizationId: ORG,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only id
      taskId: TASK_ID as Id<'tasks'>,
      description: 'Please take a look @assistant',
      mentions: [{ type: 'agent', id: 'assistant' }],
      actorType: 'user',
      actorId: 'user_author',
      ...args,
    }),
  );
}

describe('dispatchAgentTaskMentionRuns (#2637 sibling — task mentions)', () => {
  it('schedules one runAgentOnTask per agent mention when no automation is live', async () => {
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
        taskId: TASK_ID,
        trigger: 'mention',
        instructions: TASK_MENTION_INSTRUCTIONS,
        promptContext: 'Please take a look @assistant',
      },
      {
        organizationId: ORG,
        agentSlug: 'content-writer',
        taskId: TASK_ID,
        trigger: 'mention',
        instructions: TASK_MENTION_INSTRUCTIONS,
        promptContext: 'Please take a look @assistant',
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

  it('dispatches when the subscribed workflow has no installation — the fresh-org path (no pack installed yet)', async () => {
    const t = convexTest(schema, modules);
    await seedSubscription(t);

    const count = await dispatch(t);

    expect(count).toBe(1);
    expect(await scheduledAgentRuns(t)).toHaveLength(1);
  });

  it('dispatches on a completely fresh org with no subscription and no installation at all', async () => {
    const t = convexTest(schema, modules);

    const count = await dispatch(t);

    expect(count).toBe(1);
    expect(await scheduledAgentRuns(t)).toHaveLength(1);
  });
});
