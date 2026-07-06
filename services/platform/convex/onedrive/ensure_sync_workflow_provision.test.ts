import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';
import { ONEDRIVE_SYNC_WORKFLOW_SLUG } from './ensure_sync_workflow_constants';

const TEST_DIR_FROM_CONVEX_ROOT = 'onedrive';
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

const ORG = 'org-provision';
const SLUG = ONEDRIVE_SYNC_WORKFLOW_SLUG;
const SCHEDULES = [{ cron: '*/15 * * * *', timezone: 'UTC' }];
const HASH = 'hash-sync-v1';

async function runProvision(t: T) {
  return await t.mutation(
    internal.onedrive.ensure_sync_workflow_provision
      .ensureSyncWorkflowEngineProvision,
    {
      organizationId: ORG,
      workflowSlug: SLUG,
      contentHash: HASH,
      schedules: SCHEDULES,
    },
  );
}

describe('ensureSyncWorkflowEngineProvision', () => {
  it('creates installation and schedule on first run', async () => {
    const t = convexTest(schema, modules);
    const first = await runProvision(t);

    expect(first.installationCreated).toBe(true);
    expect(first.schedulesCreated).toBe(1);
    expect(first.schedulesActive).toBe(1);
    expect(first.complete).toBe(true);
  });

  it('is idempotent on repeated runs', async () => {
    const t = convexTest(schema, modules);
    await runProvision(t);
    const second = await runProvision(t);

    expect(second.installationCreated).toBe(false);
    expect(second.schedulesCreated).toBe(0);
    expect(second.schedulesReactivated).toBe(0);
    expect(second.complete).toBe(true);
  });

  it('reactivates a deactivated schedule without creating a duplicate', async () => {
    const t = convexTest(schema, modules);
    await runProvision(t);

    await t.run(async (ctx) => {
      for await (const sched of ctx.db
        .query('wfSchedules')
        .withIndex('by_workflowSlug', (q) => q.eq('workflowSlug', SLUG))) {
        if (sched.organizationId === ORG) {
          await ctx.db.patch(sched._id, { isActive: false });
        }
      }
    });

    const compensated = await runProvision(t);

    expect(compensated.schedulesCreated).toBe(0);
    expect(compensated.schedulesReactivated).toBe(1);
    expect(compensated.schedulesActive).toBe(1);
    expect(compensated.complete).toBe(true);
  });

  async function slugSchedules(t: T) {
    return await t.run(async (ctx) => {
      const rows: Array<{ cron: string; active: boolean }> = [];
      for await (const sched of ctx.db
        .query('wfSchedules')
        .withIndex('by_workflowSlug', (q) => q.eq('workflowSlug', SLUG))) {
        if (sched.organizationId === ORG) {
          rows.push({ cron: sched.cronExpression, active: sched.isActive });
        }
      }
      return rows;
    });
  }

  async function retune(
    t: T,
    patch: { cronExpression: string; isActive?: boolean },
  ) {
    await t.run(async (ctx) => {
      for await (const sched of ctx.db
        .query('wfSchedules')
        .withIndex('by_workflowSlug', (q) => q.eq('workflowSlug', SLUG))) {
        if (sched.organizationId === ORG) {
          await ctx.db.patch(sched._id, patch);
        }
      }
    });
  }

  it('keeps an operator-retuned interval instead of adding the builtin cron', async () => {
    const t = convexTest(schema, modules);
    await runProvision(t);

    // Operator retunes the interval (e.g. via the trigger editor) to every 2 min.
    await retune(t, { cronExpression: '*/2 * * * *' });

    const compensated = await runProvision(t);

    expect(compensated.schedulesCreated).toBe(0);
    expect(compensated.schedulesActive).toBe(1);
    expect(compensated.complete).toBe(true);
    expect(await slugSchedules(t)).toEqual([
      { cron: '*/2 * * * *', active: true },
    ]);
  });

  it('revives a paused, retuned schedule instead of adding the builtin cron', async () => {
    const t = convexTest(schema, modules);
    await runProvision(t);

    await retune(t, { cronExpression: '*/2 * * * *', isActive: false });

    const compensated = await runProvision(t);

    expect(compensated.schedulesCreated).toBe(0);
    expect(compensated.schedulesReactivated).toBe(1);
    expect(compensated.schedulesActive).toBe(1);
    expect(await slugSchedules(t)).toEqual([
      { cron: '*/2 * * * *', active: true },
    ]);
  });
});
