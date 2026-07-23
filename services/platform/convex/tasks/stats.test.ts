import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { utcDayKey } from '../legacy/task_metrics_queries';
import schema from '../schema';
import { TASK_BOARD_CAP } from './queries';

/**
 * getTaskStatsByProject is the Issue Desk overview's single KPI read: live
 * status counts (bounded, externalSystem-scopable) + windowed sums over the
 * taskMetricsDaily rollups. These tests pin the count/filter/cap semantics,
 * the 7d ⊂ 30d window split, the rework-rate math (incl. the zero-review
 * case), the project-ACL gate, and the full return shape.
 *
 * Identity via withIdentity, org membership via a seeded `memberMirror` row
 * (the RLS local-table fast path) — mirroring subject_run_indicator.test.ts.
 */

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/tasks/), mirroring queries.test.ts.
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

const ORG = 'org_task_stats';
const USER_ID = 'user_stats';
const IDENTITY = {
  subject: USER_ID,
  email: 'stats@example.com',
  name: 'Stats Tester',
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** UTC day key `days` days before now — safely inside/outside a window. */
function dayKeyAgo(days: number): string {
  return utcDayKey(Date.now() - days * DAY_MS);
}

type T = TestConvex<typeof schema>;

function newT(): T {
  return convexTest(schema, modules);
}

async function seedMember(t: T): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      organizationId: ORG,
      userId: USER_ID,
      memberId: 'member_stats',
      role: 'member',
      createdAt: 0,
    });
  });
}

async function seedProject(t: T, name: string): Promise<Id<'projects'>> {
  return await t.run((ctx) =>
    ctx.db.insert('projects', {
      organizationId: ORG,
      name,
      createdBy: USER_ID,
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

interface TaskSpec {
  status: Doc<'tasks'>['status'];
  externalSystem?: string;
  archivedAt?: number;
}

async function seedTasks(
  t: T,
  projectId: Id<'projects'>,
  specs: TaskSpec[],
): Promise<void> {
  await t.run(async (ctx) => {
    for (const [i, spec] of specs.entries()) {
      await ctx.db.insert('tasks', {
        organizationId: ORG,
        projectId,
        title: `Task ${i}`,
        status: spec.status,
        rank: `a${i}`,
        externalSystem: spec.externalSystem,
        archivedAt: spec.archivedAt,
        createdBy: USER_ID,
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 0,
      });
    }
  });
}

function zeroPerStatus() {
  return { backlog: 0, todo: 0, in_progress: 0, in_review: 0 };
}

type DailyRow = Omit<Doc<'taskMetricsDaily'>, '_id' | '_creationTime'>;

/** Insert a taskMetricsDaily row with everything zeroed except `overrides`. */
async function seedDailyRow(
  t: T,
  projectId: Id<'projects'>,
  dateKey: string,
  overrides: Partial<DailyRow> = {},
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('taskMetricsDaily', {
      organizationId: ORG,
      projectId,
      dateKey,
      tasksCreated: 0,
      tasksCompleted: 0,
      tasksCancelled: 0,
      cycleTimeSumMs: 0,
      cycleTimeCount: 0,
      leadTimeSumMs: 0,
      leadTimeCount: 0,
      timeInStatusMs: zeroPerStatus(),
      timeInStatusExits: zeroPerStatus(),
      statusCountsEod: zeroPerStatus(),
      wipEod: 0,
      blockedEod: 0,
      overdueEod: 0,
      staleEod: 0,
      agentCompleted: 0,
      humanCompleted: 0,
      agentRunsStarted: 0,
      agentRunsCompleted: 0,
      agentRunsFailed: 0,
      totalCostCents: 0,
      reviewsPassed: 0,
      reviewsChangesRequested: 0,
      escalations: 0,
      capped: false,
      computedAt: 0,
      version: 1,
      ...overrides,
    });
  });
}

function getStats(t: T, projectId: Id<'projects'>, externalSystem?: string) {
  return t.withIdentity(IDENTITY).query(api.tasks.stats.getTaskStatsByProject, {
    organizationId: ORG,
    projectId,
    externalSystem,
  });
}

describe('getTaskStatsByProject', () => {
  it('counts live statuses (skipping archived), derives openTotal, and returns the full shape', async () => {
    const t = newT();
    await seedMember(t);
    const projectId = await seedProject(t, 'Desk');
    await seedTasks(t, projectId, [
      { status: 'backlog' },
      { status: 'todo' },
      { status: 'todo' },
      { status: 'in_progress' },
      { status: 'in_review' },
      { status: 'done' },
      { status: 'done' },
      { status: 'cancelled' },
      // Archived rows never count, whatever their status.
      { status: 'todo', archivedAt: 1 },
    ]);

    const stats = await getStats(t, projectId);

    // Whole-object equality pins the return shape: a field added to the query
    // without updating this test (or vice versa) fails here.
    expect(stats).toEqual({
      countsByStatus: {
        backlog: 1,
        todo: 2,
        in_progress: 1,
        in_review: 1,
        done: 2,
        cancelled: 1,
      },
      capped: false,
      openTotal: 5,
      completed7d: 0,
      completed30d: 0,
      created30d: 0,
      reworkRatePct: 0,
      totalCostCents30d: 0,
      agentCompleted30d: 0,
      humanCompleted30d: 0,
    });
  });

  it('scopes live counts to externalSystem while rollup windows stay project-wide', async () => {
    const t = newT();
    await seedMember(t);
    const projectId = await seedProject(t, 'Desk');
    await seedTasks(t, projectId, [
      { status: 'todo', externalSystem: 'github' },
      { status: 'in_progress', externalSystem: 'github' },
      { status: 'todo', externalSystem: 'jira' },
      { status: 'todo' }, // no external linkage
    ]);
    // Rollups carry no externalSystem dimension — the accepted caveat: the
    // windowed sums include ALL of the project's work even when the live
    // counts are scoped.
    await seedDailyRow(t, projectId, dayKeyAgo(2), { tasksCompleted: 5 });

    const stats = await getStats(t, projectId, 'github');

    expect(stats.countsByStatus).toEqual({
      backlog: 0,
      todo: 1,
      in_progress: 1,
      in_review: 0,
      done: 0,
      cancelled: 0,
    });
    expect(stats.openTotal).toBe(2);
    expect(stats.completed30d).toBe(5);
  });

  it('flags capped when the live walk hits TASK_BOARD_CAP', async () => {
    const t = newT();
    await seedMember(t);
    const projectId = await seedProject(t, 'Desk');
    // One over the cap, in a single transaction.
    await t.run(async (ctx) => {
      for (let i = 0; i < TASK_BOARD_CAP + 1; i++) {
        await ctx.db.insert('tasks', {
          organizationId: ORG,
          projectId,
          title: `Task ${i}`,
          status: 'todo',
          rank: `a${i}`,
          createdBy: USER_ID,
          createdByType: 'user',
          createdAt: 0,
          updatedAt: 0,
        });
      }
    });

    const stats = await getStats(t, projectId);

    expect(stats.capped).toBe(true);
    // Counting stops AT the cap — the counts are lower bounds.
    expect(stats.countsByStatus.todo).toBe(TASK_BOARD_CAP);
    expect(stats.openTotal).toBe(TASK_BOARD_CAP);
  });

  it('sums rollup windows: 7d ⊂ 30d, older rows and sibling projects excluded', async () => {
    const t = newT();
    await seedMember(t);
    const projectId = await seedProject(t, 'Desk');
    const otherProjectId = await seedProject(t, 'Other');

    // Inside the 7d window (and therefore the 30d one too).
    await seedDailyRow(t, projectId, dayKeyAgo(2), {
      tasksCompleted: 3,
      tasksCreated: 5,
      agentCompleted: 2,
      humanCompleted: 1,
      totalCostCents: 250,
      reviewsPassed: 3,
      reviewsChangesRequested: 1,
    });
    // Inside 30d, outside 7d.
    await seedDailyRow(t, projectId, dayKeyAgo(20), {
      tasksCompleted: 7,
      tasksCreated: 4,
      humanCompleted: 7,
      totalCostCents: 100,
      reviewsChangesRequested: 2,
    });
    // Outside 30d — must not contribute anywhere.
    await seedDailyRow(t, projectId, dayKeyAgo(40), {
      tasksCompleted: 100,
      tasksCreated: 100,
      totalCostCents: 9999,
      reviewsPassed: 50,
      reviewsChangesRequested: 50,
    });
    // Same org, different project — the by_org_project_date walk excludes it.
    await seedDailyRow(t, otherProjectId, dayKeyAgo(2), {
      tasksCompleted: 50,
      totalCostCents: 5000,
    });

    const stats = await getStats(t, projectId);

    expect(stats.completed7d).toBe(3);
    expect(stats.completed30d).toBe(10);
    expect(stats.created30d).toBe(9);
    expect(stats.totalCostCents30d).toBe(350);
    expect(stats.agentCompleted30d).toBe(2);
    expect(stats.humanCompleted30d).toBe(8);
    // 3 changes-requested of 6 total reviews in the window → 50%.
    expect(stats.reworkRatePct).toBe(50);
  });

  it('rounds reworkRatePct to an integer percent', async () => {
    const t = newT();
    await seedMember(t);
    const projectId = await seedProject(t, 'Desk');
    // 1 of 3 → 33.33…% → 33.
    await seedDailyRow(t, projectId, dayKeyAgo(3), {
      reviewsPassed: 2,
      reviewsChangesRequested: 1,
    });

    const stats = await getStats(t, projectId);
    expect(stats.reworkRatePct).toBe(33);
  });

  it('returns reworkRatePct 0 when the window has no reviews at all', async () => {
    const t = newT();
    await seedMember(t);
    const projectId = await seedProject(t, 'Desk');
    // Activity but zero reviews — the 0-denominator case must not divide.
    await seedDailyRow(t, projectId, dayKeyAgo(2), { tasksCompleted: 4 });

    const stats = await getStats(t, projectId);
    expect(stats.reworkRatePct).toBe(0);
    expect(stats.completed30d).toBe(4);
  });

  it('rejects an unauthenticated caller', async () => {
    const t = newT();
    await seedMember(t);
    const projectId = await seedProject(t, 'Desk');

    await expect(
      t.query(api.tasks.stats.getTaskStatsByProject, {
        organizationId: ORG,
        projectId,
      }),
    ).rejects.toThrow();
  });

  it('denies a caller whose active org does not match the project org', async () => {
    const t = newT();
    await seedMember(t);
    const projectId = await seedProject(t, 'Desk');

    await expect(
      t.withIdentity(IDENTITY).query(api.tasks.stats.getTaskStatsByProject, {
        organizationId: 'org_other',
        projectId,
      }),
    ).rejects.toThrow(/different organization/i);
  });

  it('denies an authenticated non-member of the org', async () => {
    const t = newT();
    // No memberMirror row — the caller is not a member of ORG. In production
    // the mirror miss falls through to the authoritative Better Auth lookup
    // and throws UnauthorizedError; convex-test has no betterAuth component,
    // so only the rejection itself (never data) can be asserted here.
    const projectId = await seedProject(t, 'Desk');

    await expect(
      t.withIdentity(IDENTITY).query(api.tasks.stats.getTaskStatsByProject, {
        organizationId: ORG,
        projectId,
      }),
    ).rejects.toThrow();
  });

  it('denies a disabled member of the org', async () => {
    const t = newT();
    // A disabled member IS in the mirror (stored unchanged), so this denial
    // path runs entirely on the local fast path.
    await t.run(async (ctx) => {
      await ctx.db.insert('memberMirror', {
        organizationId: ORG,
        userId: USER_ID,
        memberId: 'member_stats',
        role: 'disabled',
        createdAt: 0,
      });
    });
    const projectId = await seedProject(t, 'Desk');

    await expect(
      t.withIdentity(IDENTITY).query(api.tasks.stats.getTaskStatsByProject, {
        organizationId: ORG,
        projectId,
      }),
    ).rejects.toThrow(/disabled/i);
  });
});
