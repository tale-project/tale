import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../../../_generated/api';
import {
  buildModules,
  historicalSchema,
} from '../../../framework/test_helpers';
import { meta } from './meta';

const DIR = 'migrations/versions/v0_2_92/02_triage_backlog_start_trigger';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const WORKFLOW_SLUG = 'projects/tasks/triage-unassigned-tasks';

async function seedTaskCreatedSub(
  t: ReturnType<typeof convexTest>,
  organizationId: string,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert('wfEventSubscriptions', {
      organizationId,
      workflowSlug: WORKFLOW_SLUG,
      eventType: 'task.created',
      isActive: true,
      createdAt: Date.now(),
      createdBy: 'system',
    });
  });
}

const subsFor = async (
  t: ReturnType<typeof convexTest>,
  organizationId: string,
): Promise<Array<Record<string, unknown>>> => {
  const all = (await t.run((ctx) =>
    ctx.db.query('wfEventSubscriptions').collect(),
  )) as Array<Record<string, unknown>>;
  return all.filter((s) => s.organizationId === organizationId);
};

describe('0.2.92/02 triage_backlog_start_trigger', () => {
  it('up adds the task.status_changed sibling subscription', async () => {
    const t = convexTest(historicalSchema, modules);
    await seedTaskCreatedSub(t, 'org_1');

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });

    const subs = await subsFor(t, 'org_1');
    expect(subs).toHaveLength(2);
    const added = subs.find((s) => s.eventType === 'task.status_changed');
    expect(added?.workflowSlug).toBe(WORKFLOW_SLUG);
    expect(added?.eventFilter).toEqual({
      fromStatus: 'backlog',
      toStatus: 'todo',
    });
    expect(added?.isActive).toBe(true);
    expect(added?.createdBy).toBe('system');
  });

  it('is idempotent — a second run adds nothing more', async () => {
    const t = convexTest(historicalSchema, modules);
    await seedTaskCreatedSub(t, 'org_1');

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });
    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });

    expect(await subsFor(t, 'org_1')).toHaveLength(2);
  });

  it('never touches an org without the task.created subscription', async () => {
    const t = convexTest(historicalSchema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('wfEventSubscriptions', {
        organizationId: 'org_2',
        workflowSlug: 'projects/tasks/enforce-task-slas',
        eventType: 'task.created',
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'system',
      });
    });

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });

    expect(await subsFor(t, 'org_2')).toHaveLength(1);
  });

  it('down removes exactly the subscription up added, preserving an operator override', async () => {
    const t = convexTest(historicalSchema, modules);
    await seedTaskCreatedSub(t, 'org_1');

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });
    await t.action(internal.migrations.framework.entrypoints.applyDown, {
      to: '0.2.91',
      only: [meta.id],
    });

    const subs = await subsFor(t, 'org_1');
    expect(subs).toHaveLength(1);
    expect(subs[0].eventType).toBe('task.created');

    // An operator-created subscription (createdBy != 'system') must survive.
    await seedTaskCreatedSub(t, 'org_3');
    await t.run(async (ctx) => {
      await ctx.db.insert('wfEventSubscriptions', {
        organizationId: 'org_3',
        workflowSlug: WORKFLOW_SLUG,
        eventType: 'task.status_changed',
        eventFilter: { fromStatus: 'backlog', toStatus: 'todo' },
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'user_1',
      });
    });
    await t.action(internal.migrations.framework.entrypoints.applyDown, {
      to: '0.2.91',
      only: [meta.id],
    });
    expect(await subsFor(t, 'org_3')).toHaveLength(2);
  });
});
