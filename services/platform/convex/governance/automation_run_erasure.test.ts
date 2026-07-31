/**
 * Right-to-erasure coverage over `automationRuns`.
 *
 * Attribution is a prefix match on `startedBy` (`user:<id>`, `api-key:<id>`)
 * because the table has no `userId` — so these pin both what it DOES reach and
 * what it deliberately does not.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
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

const ORG = 'org_run_erasure';
const DAY = 24 * 60 * 60 * 1000;
type T = TestConvex<typeof schema>;

interface RunSeed {
  status: 'success' | 'failed' | 'cancelled' | 'running' | 'waiting';
  startedAgoDays: number;
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
      });
    }
  });
}

describe('eraseSubjectAutomationRuns', () => {
  it('erases runs the subject started, by either caller marker', async () => {
    const t = convexTest(schema, modules);
    await seedRuns(t, [
      { status: 'success', startedAgoDays: 1, startedBy: 'user:subj' },
      { status: 'failed', startedAgoDays: 1, startedBy: 'api-key:subj' },
    ]);

    const result = await t.mutation(
      internal.governance.erasure.eraseSubjectAutomationRuns,
      { organizationId: ORG, userId: 'subj' },
    );

    expect(result).toEqual({ rows: 2, skippedByHold: 0 });
  });

  it('leaves other subjects, schedule-started runs, and other orgs alone', async () => {
    const t = convexTest(schema, modules);
    await seedRuns(t, [
      { status: 'success', startedAgoDays: 1, startedBy: 'user:someone_else' },
      { status: 'success', startedAgoDays: 1, startedBy: 'trigger:t1' },
      {
        status: 'success',
        startedAgoDays: 1,
        startedBy: 'user:subj',
        organizationId: 'other_org',
      },
    ]);

    const result = await t.mutation(
      internal.governance.erasure.eraseSubjectAutomationRuns,
      { organizationId: ORG, userId: 'subj' },
    );

    expect(result).toEqual({ rows: 0, skippedByHold: 0 });
    const left = await t.run(
      async (ctx) => (await ctx.db.query('automationRuns').collect()).length,
    );
    expect(left).toBe(3);
  });

  /** A prefix match must not erase `user:subj_2` when erasing `user:subj`. */
  it('does not match a userId that merely shares a prefix', async () => {
    const t = convexTest(schema, modules);
    await seedRuns(t, [
      { status: 'success', startedAgoDays: 1, startedBy: 'user:subj_2' },
    ]);

    const result = await t.mutation(
      internal.governance.erasure.eraseSubjectAutomationRuns,
      { organizationId: ORG, userId: 'subj' },
    );

    expect(result.rows).toBe(0);
  });

  it('erases a run whatever its status — erasure is not retention', async () => {
    const t = convexTest(schema, modules);
    await seedRuns(t, [
      { status: 'waiting', startedAgoDays: 1, startedBy: 'user:subj' },
    ]);

    const result = await t.mutation(
      internal.governance.erasure.eraseSubjectAutomationRuns,
      { organizationId: ORG, userId: 'subj' },
    );

    expect(result.rows).toBe(1);
  });
});
