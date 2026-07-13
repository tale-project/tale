// The agent-run concurrency-counter leak fix. A workflow sandbox step that
// parks on capacity and re-enters (or a durable run handing off across the
// action ceiling) calls startTaskAgentRun again for the SAME
// (wfExecutionId, stepSlug); without dedup it minted a NEW `running`
// taskAgentRun + re-incremented `agentRunCounters` each wake, leaking the
// semaphore until the org cap wedged every run ("Queued for capacity" for
// everyone). And a CANCELLED workflow orphaned its `running` rows so the
// decrement never fired. convexTest (real DB + real by_wfExecution index)
// because the hazard is index iteration + cross-row counter math.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/task_metrics/, mirror admission.test.ts).
const TEST_DIR_FROM_CONVEX_ROOT = 'task_metrics';
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
const ORG = 'org_task_dedup';

async function seedTask(
  t: T,
): Promise<{ taskId: Id<'tasks'>; projectId: Id<'projects'> }> {
  return t.run(async (ctx) => {
    const projectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'p',
      createdBy: 'system',
      createdAt: 0,
      updatedAt: 0,
    });
    const taskId = await ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: 't',
      rank: 'a0',
      status: 'in_progress',
      createdBy: 'system',
      createdByType: 'agent',
      createdAt: 0,
      updatedAt: 0,
    });
    return { taskId, projectId };
  });
}

async function seedExec(t: T): Promise<Id<'wfExecutions'>> {
  return t.run((ctx) =>
    ctx.db.insert('wfExecutions', {
      organizationId: ORG,
      wfDefinitionId: 'vat-return-desk/desk-process',
      status: 'running',
      currentStepSlug: 'extract_invoices',
      startedAt: 0,
      updatedAt: 0,
    }),
  );
}

async function seedRunningRun(
  t: T,
  args: {
    taskId: Id<'tasks'>;
    projectId: Id<'projects'>;
    wfExecutionId: Id<'wfExecutions'>;
    stepSlug: string;
    agentSlug: string;
  },
): Promise<Id<'taskAgentRuns'>> {
  return t.run((ctx) =>
    ctx.db.insert('taskAgentRuns', {
      organizationId: ORG,
      projectId: args.projectId,
      taskId: args.taskId,
      agentSlug: args.agentSlug,
      trigger: 'manual',
      wfExecutionId: args.wfExecutionId,
      stepSlug: args.stepSlug,
      status: 'running',
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      startedAt: 0,
    }),
  );
}

async function seedCounter(
  t: T,
  scope: string,
  running: number,
): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert('agentRunCounters', {
      organizationId: ORG,
      scope,
      running,
      updatedAt: 0,
    }),
  );
}

async function counter(t: T, scope: string): Promise<number> {
  return t.run(async (ctx) => {
    const row = await ctx.db
      .query('agentRunCounters')
      .withIndex('by_org_scope', (q) =>
        q.eq('organizationId', ORG).eq('scope', scope),
      )
      .first();
    return row?.running ?? 0;
  });
}

async function runsFor(t: T, wfExecutionId: Id<'wfExecutions'>) {
  return t.run((ctx) =>
    ctx.db
      .query('taskAgentRuns')
      .withIndex('by_wfExecution', (q) => q.eq('wfExecutionId', wfExecutionId))
      .collect(),
  );
}

describe('startTaskAgentRun dedup (park-reentry counter-leak fix)', () => {
  it('reuses the running run for the same (wfExecutionId, stepSlug); no duplicate row, no counter bump', async () => {
    const t = convexTest(schema, modules);
    const { taskId, projectId } = await seedTask(t);
    const wfExecutionId = await seedExec(t);
    const existing = await seedRunningRun(t, {
      taskId,
      projectId,
      wfExecutionId,
      stepSlug: 'extract_invoices',
      agentSlug: 'vat-return-desk/invoice-reader',
    });
    // A counter the first entry already bumped — the re-acquire must NOT bump it.
    await seedCounter(t, 'org', 1);
    await seedCounter(t, 'agent:vat-return-desk/invoice-reader', 1);

    const res = await t.mutation(
      internal.task_metrics.internal_mutations.startTaskAgentRun,
      {
        organizationId: ORG,
        taskId,
        agentSlug: 'vat-return-desk/invoice-reader',
        trigger: 'manual',
        wfExecutionId,
        stepSlug: 'extract_invoices',
        guardContext: 'task_run',
      },
    );

    expect(res.started).toBe(true);
    expect(res.runId).toBe(existing); // same row, not a duplicate
    expect(await runsFor(t, wfExecutionId)).toHaveLength(1);
    expect(await counter(t, 'org')).toBe(1); // unchanged
    expect(await counter(t, 'agent:vat-return-desk/invoice-reader')).toBe(1);
  });

  it('does NOT dedup a different step of the same execution (distinct logical run)', async () => {
    const t = convexTest(schema, modules);
    const { taskId, projectId } = await seedTask(t);
    const wfExecutionId = await seedExec(t);
    await seedRunningRun(t, {
      taskId,
      projectId,
      wfExecutionId,
      stepSlug: 'step_a',
      agentSlug: 'agent-a',
    });
    // A running run for step_a must not be reused for step_b — the dedup key is
    // (wfExecutionId, stepSlug), so this is a miss and startTaskAgentRun falls
    // through to the admission verdict (no early reuse-return).
    const dedupHit = await t.run(async (ctx) => {
      for await (const run of ctx.db
        .query('taskAgentRuns')
        .withIndex('by_wfExecution', (q) =>
          q.eq('wfExecutionId', wfExecutionId),
        )) {
        if (run.status === 'running' && run.stepSlug === 'step_b') return true;
      }
      return false;
    });
    expect(dedupHit).toBe(false);
  });
});

describe('finalizeRunsForExecution (terminal-edge drain)', () => {
  it('finalizes every running run for the execution and decrements both counters', async () => {
    const t = convexTest(schema, modules);
    const { taskId, projectId } = await seedTask(t);
    const wfExecutionId = await seedExec(t);
    await seedRunningRun(t, {
      taskId,
      projectId,
      wfExecutionId,
      stepSlug: 's1',
      agentSlug: 'a1',
    });
    await seedRunningRun(t, {
      taskId,
      projectId,
      wfExecutionId,
      stepSlug: 's2',
      agentSlug: 'a2',
    });
    await seedCounter(t, 'org', 2);
    await seedCounter(t, 'agent:a1', 1);
    await seedCounter(t, 'agent:a2', 1);

    const res = await t.mutation(
      internal.task_metrics.internal_mutations.finalizeRunsForExecution,
      {
        wfExecutionId,
        status: 'timed_out',
        outcome: 'error',
        error: 'canceled',
      },
    );

    expect(res.finalized).toBe(2);
    expect(await counter(t, 'org')).toBe(0);
    expect(await counter(t, 'agent:a1')).toBe(0);
    expect(await counter(t, 'agent:a2')).toBe(0);
    const runs = await runsFor(t, wfExecutionId);
    expect(runs.every((r) => r.status === 'timed_out')).toBe(true);
  });

  it('is idempotent — a second drain finalizes nothing and never double-decrements', async () => {
    const t = convexTest(schema, modules);
    const { taskId, projectId } = await seedTask(t);
    const wfExecutionId = await seedExec(t);
    await seedRunningRun(t, {
      taskId,
      projectId,
      wfExecutionId,
      stepSlug: 's1',
      agentSlug: 'a1',
    });
    await seedCounter(t, 'org', 1);
    await seedCounter(t, 'agent:a1', 1);

    const first = await t.mutation(
      internal.task_metrics.internal_mutations.finalizeRunsForExecution,
      { wfExecutionId, status: 'timed_out', outcome: 'error' },
    );
    const second = await t.mutation(
      internal.task_metrics.internal_mutations.finalizeRunsForExecution,
      { wfExecutionId, status: 'timed_out', outcome: 'error' },
    );

    expect(first.finalized).toBe(1);
    expect(second.finalized).toBe(0); // already terminal → skipped
    expect(await counter(t, 'org')).toBe(0); // floored, not negative
    expect(await counter(t, 'agent:a1')).toBe(0);
  });
});
