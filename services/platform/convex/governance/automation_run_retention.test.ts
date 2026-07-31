/**
 * The `workflowLog` sweep over `automationRuns`.
 *
 * The load-bearing guarantee is the terminal-only filter: a `waiting` run is
 * parked on a human decision and may sit for weeks, and a `running` one is
 * mid-flight, so age alone must never make either a candidate. Everything else
 * here (the flag gate, the Trash flip, the grace delete) follows the shape the
 * other retention categories already use.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import {
  isTerminalRunStatus,
  TERMINAL_RUN_STATUSES,
} from '../automations/run_status';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'governance';
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

const ORG = 'org_run_retention';
const DAY = 24 * 60 * 60 * 1000;
type T = TestConvex<typeof schema>;

interface RunSeed {
  status: 'success' | 'failed' | 'cancelled' | 'running' | 'waiting';
  finishedAgoDays?: number;
  startedAgoDays: number;
  lifecycleStatus?: 'expired';
  statusChangedAgoDays?: number;
  startedBy?: string;
  organizationId?: string;
}

async function seedRuns(t: T, runs: RunSeed[]): Promise<void> {
  const now = Date.now();
  await t.run(async (ctx) => {
    for (const [i, run] of runs.entries()) {
      await ctx.db.insert('automationRuns', {
        organizationId: run.organizationId ?? ORG,
        name: `automation-${i}`,
        version: 1,
        status: run.status,
        mode: 'live',
        startedBy: run.startedBy ?? 'trigger:t1',
        input: null,
        startedAt: now - run.startedAgoDays * DAY,
        ...(run.finishedAgoDays !== undefined && {
          finishedAt: now - run.finishedAgoDays * DAY,
        }),
        ...(run.lifecycleStatus !== undefined && {
          lifecycleStatus: run.lifecycleStatus,
        }),
        ...(run.statusChangedAgoDays !== undefined && {
          statusChangedAt: now - run.statusChangedAgoDays * DAY,
        }),
      });
    }
  });
}

describe('isTerminalRunStatus', () => {
  it.each(TERMINAL_RUN_STATUSES)('treats %s as terminal', (status) => {
    expect(isTerminalRunStatus(status)).toBe(true);
  });

  it.each(['running', 'waiting', 'queued', ''])(
    'refuses to treat %s as terminal',
    (status) => {
      expect(isTerminalRunStatus(status)).toBe(false);
    },
  );
});

describe('listExpiredAutomationRuns', () => {
  it('lists aged terminal runs', async () => {
    const t = convexTest(schema, modules);
    await seedRuns(t, [
      { status: 'success', startedAgoDays: 60, finishedAgoDays: 60 },
      { status: 'failed', startedAgoDays: 45, finishedAgoDays: 45 },
    ]);

    const rows = await t.query(
      internal.governance.internal_queries.listExpiredAutomationRuns,
      { organizationId: ORG, cutoffMs: Date.now() - 30 * DAY, batchSize: 50 },
    );

    expect(rows).toHaveLength(2);
  });

  it('NEVER lists a waiting run — it is parked on a human decision', async () => {
    const t = convexTest(schema, modules);
    await seedRuns(t, [{ status: 'waiting', startedAgoDays: 400 }]);

    const rows = await t.query(
      internal.governance.internal_queries.listExpiredAutomationRuns,
      { organizationId: ORG, cutoffMs: Date.now() - 30 * DAY, batchSize: 50 },
    );

    expect(rows).toHaveLength(0);
  });

  it('NEVER lists a running run, however old', async () => {
    const t = convexTest(schema, modules);
    await seedRuns(t, [{ status: 'running', startedAgoDays: 400 }]);

    const rows = await t.query(
      internal.governance.internal_queries.listExpiredAutomationRuns,
      { organizationId: ORG, cutoffMs: Date.now() - 30 * DAY, batchSize: 50 },
    );

    expect(rows).toHaveLength(0);
  });

  it('leaves a run inside the window alone', async () => {
    const t = convexTest(schema, modules);
    await seedRuns(t, [
      { status: 'success', startedAgoDays: 3, finishedAgoDays: 3 },
    ]);

    const rows = await t.query(
      internal.governance.internal_queries.listExpiredAutomationRuns,
      { organizationId: ORG, cutoffMs: Date.now() - 30 * DAY, batchSize: 50 },
    );

    expect(rows).toHaveLength(0);
  });

  it('ages on finishedAt, not startedAt — a long run that ended recently is kept', async () => {
    const t = convexTest(schema, modules);
    await seedRuns(t, [
      { status: 'success', startedAgoDays: 200, finishedAgoDays: 2 },
    ]);

    const rows = await t.query(
      internal.governance.internal_queries.listExpiredAutomationRuns,
      { organizationId: ORG, cutoffMs: Date.now() - 30 * DAY, batchSize: 50 },
    );

    expect(rows).toHaveLength(0);
  });

  it('falls back to startedAt when a run ended without stamping finishedAt', async () => {
    const t = convexTest(schema, modules);
    await seedRuns(t, [{ status: 'failed', startedAgoDays: 90 }]);

    const rows = await t.query(
      internal.governance.internal_queries.listExpiredAutomationRuns,
      { organizationId: ORG, cutoffMs: Date.now() - 30 * DAY, batchSize: 50 },
    );

    expect(rows).toHaveLength(1);
  });

  it('never crosses an organization boundary', async () => {
    const t = convexTest(schema, modules);
    await seedRuns(t, [
      {
        status: 'success',
        startedAgoDays: 90,
        finishedAgoDays: 90,
        organizationId: 'other_org',
      },
    ]);

    const rows = await t.query(
      internal.governance.internal_queries.listExpiredAutomationRuns,
      { organizationId: ORG, cutoffMs: Date.now() - 30 * DAY, batchSize: 50 },
    );

    expect(rows).toHaveLength(0);
  });

  it('skips a run already in the Trash window', async () => {
    const t = convexTest(schema, modules);
    await seedRuns(t, [
      {
        status: 'success',
        startedAgoDays: 90,
        finishedAgoDays: 90,
        lifecycleStatus: 'expired',
        statusChangedAgoDays: 1,
      },
    ]);

    const rows = await t.query(
      internal.governance.internal_queries.listExpiredAutomationRuns,
      { organizationId: ORG, cutoffMs: Date.now() - 30 * DAY, batchSize: 50 },
    );

    expect(rows).toHaveLength(0);
  });

  it('honours the batch size', async () => {
    const t = convexTest(schema, modules);
    await seedRuns(
      t,
      Array.from({ length: 5 }, () => ({
        status: 'success' as const,
        startedAgoDays: 90,
        finishedAgoDays: 90,
      })),
    );

    const rows = await t.query(
      internal.governance.internal_queries.listExpiredAutomationRuns,
      { organizationId: ORG, cutoffMs: Date.now() - 30 * DAY, batchSize: 2 },
    );

    expect(rows).toHaveLength(2);
  });
});

describe('listGraceExpiredAutomationRuns', () => {
  it('lists a run whose Trash window has elapsed', async () => {
    const t = convexTest(schema, modules);
    await seedRuns(t, [
      {
        status: 'success',
        startedAgoDays: 90,
        finishedAgoDays: 90,
        lifecycleStatus: 'expired',
        statusChangedAgoDays: 30,
      },
    ]);

    const rows = await t.query(
      internal.governance.internal_queries.listGraceExpiredAutomationRuns,
      {
        organizationId: ORG,
        graceCutoffMs: Date.now() - 7 * DAY,
        batchSize: 50,
      },
    );

    expect(rows).toHaveLength(1);
  });

  it('keeps a run still inside its Trash window', async () => {
    const t = convexTest(schema, modules);
    await seedRuns(t, [
      {
        status: 'success',
        startedAgoDays: 90,
        finishedAgoDays: 90,
        lifecycleStatus: 'expired',
        statusChangedAgoDays: 1,
      },
    ]);

    const rows = await t.query(
      internal.governance.internal_queries.listGraceExpiredAutomationRuns,
      {
        organizationId: ORG,
        graceCutoffMs: Date.now() - 7 * DAY,
        batchSize: 50,
      },
    );

    expect(rows).toHaveLength(0);
  });

  it('ignores a live run that was never flipped', async () => {
    const t = convexTest(schema, modules);
    await seedRuns(t, [
      { status: 'success', startedAgoDays: 90, finishedAgoDays: 90 },
    ]);

    const rows = await t.query(
      internal.governance.internal_queries.listGraceExpiredAutomationRuns,
      {
        organizationId: ORG,
        graceCutoffMs: Date.now() - 7 * DAY,
        batchSize: 50,
      },
    );

    expect(rows).toHaveLength(0);
  });
});

describe('deleteExpiredAutomationRun', () => {
  it('deletes an aged terminal run', async () => {
    const t = convexTest(schema, modules);
    await seedRuns(t, [
      { status: 'success', startedAgoDays: 90, finishedAgoDays: 90 },
    ]);
    const [row] = await t.query(
      internal.governance.internal_queries.listExpiredAutomationRuns,
      { organizationId: ORG, cutoffMs: Date.now() - 30 * DAY, batchSize: 50 },
    );

    await t.mutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredAutomationRun,
      { runId: row._id, organizationId: ORG, cutoffMs: Date.now() - 30 * DAY },
    );

    const left = await t.run((ctx) => ctx.db.get(row._id));
    expect(left).toBeNull();
  });

  /**
   * The scan and the delete are separate transactions. If a run is resumed in
   * between, the delete must refuse — otherwise retention deletes a row out
   * from under a live walker.
   */
  it('refuses once the run has been resumed since it was listed', async () => {
    const t = convexTest(schema, modules);
    await seedRuns(t, [
      { status: 'success', startedAgoDays: 90, finishedAgoDays: 90 },
    ]);
    const [row] = await t.query(
      internal.governance.internal_queries.listExpiredAutomationRuns,
      { organizationId: ORG, cutoffMs: Date.now() - 30 * DAY, batchSize: 50 },
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(row._id, { status: 'running' });
    });

    await t.mutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredAutomationRun,
      { runId: row._id, organizationId: ORG, cutoffMs: Date.now() - 30 * DAY },
    );

    const left = await t.run((ctx) => ctx.db.get(row._id));
    expect(left).not.toBeNull();
  });

  it('refuses a cross-org delete', async () => {
    const t = convexTest(schema, modules);
    await seedRuns(t, [
      { status: 'success', startedAgoDays: 90, finishedAgoDays: 90 },
    ]);
    const [row] = await t.query(
      internal.governance.internal_queries.listExpiredAutomationRuns,
      { organizationId: ORG, cutoffMs: Date.now() - 30 * DAY, batchSize: 50 },
    );

    await t.mutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredAutomationRun,
      {
        runId: row._id,
        organizationId: 'other_org',
        cutoffMs: Date.now() - 30 * DAY,
      },
    );

    const left = await t.run((ctx) => ctx.db.get(row._id));
    expect(left).not.toBeNull();
  });
});
