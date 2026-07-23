import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import {
  TASK_MENTION_EVENT,
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
  it('schedules no runAgentOnTask for any agent mention — direct dispatch is offline while the AI backend is rewritten', async () => {
    const t = convexTest(schema, modules);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const count = await dispatch(t, {
      mentions: [
        { type: 'agent', id: 'assistant' },
        { type: 'user', id: 'user_teammate' },
        { type: 'agent', id: 'content-writer' },
      ],
    });

    // Reports 0 dispatched (honest: nothing was scheduled), not the 2 agent
    // mentions that would have run before direct dispatch went offline.
    expect(count).toBe(0);
    expect(await scheduledAgentRuns(t)).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('2 agent mention'),
    );
    warnSpy.mockRestore();
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

  it('reaches the offline no-op when the subscription is inactive (processEvent would skip it too)', async () => {
    const t = convexTest(schema, modules);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seedSubscription(t, { isActive: false });
    await seedInstallation(t);

    const count = await dispatch(t);

    // An inactive subscription still isn't live automation, so
    // hasLiveEventAutomation correctly says no — but the fallback that used to
    // pick this mention up directly is itself offline now, so nothing runs.
    expect(count).toBe(0);
    expect(await scheduledAgentRuns(t)).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('reaches the offline no-op when the subscribed workflow has no installation — the fresh-org path (no pack installed yet)', async () => {
    const t = convexTest(schema, modules);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seedSubscription(t);

    const count = await dispatch(t);

    expect(count).toBe(0);
    expect(await scheduledAgentRuns(t)).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('reaches the offline no-op on a completely fresh org with no subscription and no installation at all', async () => {
    const t = convexTest(schema, modules);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const count = await dispatch(t);

    expect(count).toBe(0);
    expect(await scheduledAgentRuns(t)).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
