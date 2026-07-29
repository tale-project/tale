/**
 * Org-wide automation run metrics. These tests pin the aggregation contract:
 * the window split (current vs. prior for deltas), the terminal-only success
 * rate and duration math, the live/mock mode filter, the per-day series, and
 * the membership gate. Rows are seeded oldest-first so `_creationTime` order
 * matches the `startedAt` monotonicity the newest-first walk relies on.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { DAY_MS, utcDateKey } from '../../lib/shared/metrics-window';
import { api } from '../_generated/api';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'automations';
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

const ORG = 'org_run_metrics';
const MEMBER = 'user_member';
const OUTSIDER = 'user_outsider';
type T = TestConvex<typeof schema>;

async function seedMembers(t: T): Promise<void> {
  await t.run(async (ctx) => {
    // Membership resolves through the local memberMirror (no cross-component
    // read), so seeding it is all the auth gate needs. The outsider is a
    // DISABLED member: a mirror hit that denies, keeping the deny path off the
    // Better Auth fallback convexTest cannot register.
    await ctx.db.insert('memberMirror', {
      memberId: 'ba_member_1',
      userId: MEMBER,
      organizationId: ORG,
      role: 'member',
      createdAt: 0,
    });
    await ctx.db.insert('memberMirror', {
      memberId: 'ba_member_2',
      userId: OUTSIDER,
      organizationId: ORG,
      role: 'disabled',
      createdAt: 0,
    });
  });
}

interface RunSeed {
  name: string;
  status: 'queued' | 'running' | 'waiting' | 'success' | 'failed' | 'cancelled';
  mode?: 'mock' | 'live';
  startedAt: number;
  finishedAt?: number;
  organizationId?: string;
}

/** Insert runs as given — callers list them OLDEST FIRST. */
async function seedRuns(t: T, runs: RunSeed[]): Promise<void> {
  await t.run(async (ctx) => {
    for (const run of runs) {
      await ctx.db.insert('automationRuns', {
        organizationId: run.organizationId ?? ORG,
        name: run.name,
        version: 1,
        status: run.status,
        mode: run.mode ?? 'live',
        startedBy: 'test',
        input: {},
        startedAt: run.startedAt,
        ...(run.finishedAt !== undefined && { finishedAt: run.finishedAt }),
      });
    }
  });
}

describe('getOrgAutomationMetrics', () => {
  it('aggregates the window summary, prior-window deltas, series, and top automations', async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);

    const now = Date.now();
    const hour = 60 * 60 * 1000;
    await seedRuns(t, [
      // Older than the prior window — must not be scanned at all.
      { name: 'ancient', status: 'failed', startedAt: now - 20 * DAY_MS },
      // Prior window (7d): one success with duration, one failed.
      {
        name: 'billing/reminder',
        status: 'success',
        startedAt: now - 10 * DAY_MS,
        finishedAt: now - 10 * DAY_MS + 30_000,
      },
      {
        name: 'billing/reminder',
        status: 'failed',
        startedAt: now - 9 * DAY_MS,
      },
      // Current window: two success, one failed, one cancelled, and three
      // non-terminal runs. Mock run must be filtered out by default.
      {
        name: 'billing/reminder',
        status: 'success',
        startedAt: now - 5 * hour,
        finishedAt: now - 5 * hour + 60_000,
      },
      {
        name: 'billing/reminder',
        status: 'success',
        startedAt: now - 4 * hour,
        finishedAt: now - 4 * hour + 120_000,
      },
      {
        name: 'ops/sync',
        status: 'failed',
        startedAt: now - 3 * hour,
        finishedAt: now - 3 * hour + 30_000,
      },
      {
        name: 'ops/sync',
        status: 'cancelled',
        startedAt: now - 2.5 * hour,
        finishedAt: now - 2.5 * hour + 10_000,
      },
      { name: 'ops/sync', status: 'running', startedAt: now - 2 * hour },
      { name: 'ops/sync', status: 'waiting', startedAt: now - 90 * 60 * 1000 },
      { name: 'ops/sync', status: 'queued', startedAt: now - hour },
      {
        name: 'ops/sync',
        status: 'success',
        mode: 'mock',
        startedAt: now - 30 * 60 * 1000,
        finishedAt: now - 29 * 60 * 1000,
      },
    ]);

    const result = await t
      .withIdentity({ subject: MEMBER })
      .query(api.automations.queries.getOrgAutomationMetrics, {
        organizationId: ORG,
        periodDays: 7,
      });

    expect(result.summary).toEqual({
      total: 7,
      success: 2,
      failed: 1,
      running: 1,
      waiting: 1,
      queued: 1,
      cancelled: 1,
      // 2 successes over 4 terminal runs (success + failed + cancelled).
      successRate: 50,
      // (60s + 120s + 30s + 10s) / 4 terminal runs with finishedAt.
      avgDurationSeconds: 55,
      lastRun: now - hour,
      capped: false,
    });

    expect(result.previousSummary).toEqual({
      total: 2,
      success: 1,
      failed: 1,
      successRate: 50,
      avgDurationSeconds: 30,
    });

    // Seven pre-seeded day buckets; totals across them match the summary.
    expect(result.series).toHaveLength(7);
    const sum = result.series.reduce(
      (acc, point) => ({
        success: acc.success + point.success,
        failed: acc.failed + point.failed,
        running: acc.running + point.running,
      }),
      { success: 0, failed: 0, running: 0 },
    );
    expect(sum).toEqual({ success: 2, failed: 1, running: 1 });
    // All current-window rows started within the last hours → today's bucket.
    const today = result.series.find((p) => p.dateKey === utcDateKey(now));
    expect(today).toBeDefined();

    expect(result.topAutomations).toEqual([
      {
        name: 'ops/sync',
        total: 5,
        success: 0,
        failed: 1,
        // 0 successes over 2 terminal runs (failed + cancelled).
        successRate: 0,
        avgDurationSeconds: 20,
        lastRun: now - hour,
      },
      {
        name: 'billing/reminder',
        total: 2,
        success: 2,
        failed: 0,
        successRate: 100,
        avgDurationSeconds: 90,
        lastRun: now - 4 * hour,
      },
    ]);
  });

  it('counts only the requested mode', async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const now = Date.now();
    await seedRuns(t, [
      {
        name: 'demo',
        status: 'success',
        mode: 'mock',
        startedAt: now - 2000,
        finishedAt: now - 1000,
      },
      { name: 'demo', status: 'failed', mode: 'live', startedAt: now - 500 },
    ]);

    const mock = await t
      .withIdentity({ subject: MEMBER })
      .query(api.automations.queries.getOrgAutomationMetrics, {
        organizationId: ORG,
        periodDays: 7,
        mode: 'mock',
      });
    expect(mock.summary.total).toBe(1);
    expect(mock.summary.success).toBe(1);
    expect(mock.summary.failed).toBe(0);

    const live = await t
      .withIdentity({ subject: MEMBER })
      .query(api.automations.queries.getOrgAutomationMetrics, {
        organizationId: ORG,
        periodDays: 7,
      });
    expect(live.summary.total).toBe(1);
    expect(live.summary.failed).toBe(1);
  });

  it('never selects another organization’s runs', async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const now = Date.now();
    await seedRuns(t, [
      {
        name: 'other',
        status: 'success',
        startedAt: now - 1000,
        finishedAt: now - 500,
        organizationId: 'org_other',
      },
    ]);

    const result = await t
      .withIdentity({ subject: MEMBER })
      .query(api.automations.queries.getOrgAutomationMetrics, {
        organizationId: ORG,
        periodDays: 7,
      });
    expect(result.summary.total).toBe(0);
    expect(result.summary.lastRun).toBeNull();
    expect(result.topAutomations).toEqual([]);
  });

  it('refuses an unauthenticated or disabled caller', async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);

    await expect(
      t.query(api.automations.queries.getOrgAutomationMetrics, {
        organizationId: ORG,
        periodDays: 7,
      }),
    ).rejects.toThrow(/Authentication required/);

    await expect(
      t
        .withIdentity({ subject: OUTSIDER })
        .query(api.automations.queries.getOrgAutomationMetrics, {
          organizationId: ORG,
          periodDays: 7,
        }),
    ).rejects.toThrow(/disabled/);
  });
});
