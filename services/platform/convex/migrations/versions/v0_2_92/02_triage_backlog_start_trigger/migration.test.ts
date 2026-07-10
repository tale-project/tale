// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import {
  defineMigrationTest,
  type WorldHandle,
} from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_2_92/02_triage_backlog_start_trigger';
const WORKFLOW_SLUG = 'projects/tasks/triage-unassigned-tasks';

async function subsFor(
  world: WorldHandle,
  organizationId: string,
): Promise<Array<Record<string, unknown>>> {
  const all = (await world.run((ctx) =>
    ctx.db.query('wfEventSubscriptions').collect(),
  )) as Array<Record<string, unknown>>;
  return all.filter((s) => s.organizationId === organizationId);
}

// The harness runs the standard ritual automatically: up through the real
// runner, true handler idempotency over migrated state (a second up adds no
// duplicate sibling), down restoring the seed digest byte-for-byte (the added
// subscription removed, the task.created originals untouched), and the ledger
// transitions.
defineMigrationTest({
  id: '0.2.92/02_triage_backlog_start_trigger',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('wfEventSubscriptions', {
      organizationId: 'org_1',
      workflowSlug: WORKFLOW_SLUG,
      eventType: 'task.created',
      isActive: true,
      createdAt: 1,
      createdBy: 'system',
    });
    // An org whose only task.created subscription belongs to ANOTHER
    // workflow must never gain the sibling.
    await ctx.db.insert('wfEventSubscriptions', {
      organizationId: 'org_2',
      workflowSlug: 'projects/tasks/enforce-task-slas',
      eventType: 'task.created',
      isActive: true,
      createdAt: 1,
      createdBy: 'system',
    });
  },

  async expectUp(world) {
    const org1 = await subsFor(world, 'org_1');
    expect(org1).toHaveLength(2);
    const added = org1.find((s) => s.eventType === 'task.status_changed');
    expect(added?.workflowSlug).toBe(WORKFLOW_SLUG);
    expect(added?.eventFilter).toEqual({
      fromStatus: 'backlog',
      toStatus: 'todo',
    });
    expect(added?.isActive).toBe(true);
    expect(added?.createdBy).toBe('system');

    expect(await subsFor(world, 'org_2')).toHaveLength(1);
  },

  cases: {
    'an operator-created identical subscription blocks the insert and survives down':
      async (world) => {
        await world.run(async (ctx) => {
          await ctx.db.insert('wfEventSubscriptions', {
            organizationId: 'org_3',
            workflowSlug: WORKFLOW_SLUG,
            eventType: 'task.created',
            isActive: true,
            createdAt: 2,
            createdBy: 'system',
          });
          // Operator-created sibling (createdBy != 'system').
          await ctx.db.insert('wfEventSubscriptions', {
            organizationId: 'org_3',
            workflowSlug: WORKFLOW_SLUG,
            eventType: 'task.status_changed',
            eventFilter: { fromStatus: 'backlog', toStatus: 'todo' },
            isActive: true,
            createdAt: 2,
            createdBy: 'user_1',
          });
        });

        await world.applyUpOnly();
        // The operator's subscription counts as the sibling — nothing added.
        expect(await subsFor(world, 'org_3')).toHaveLength(2);

        await world.applyDownOnly();
        // down deletes only system-created siblings — the operator's survives.
        const after = await subsFor(world, 'org_3');
        expect(after).toHaveLength(2);
        expect(
          after.some(
            (s) =>
              s.eventType === 'task.status_changed' && s.createdBy === 'user_1',
          ),
        ).toBe(true);
      },
  },
});
