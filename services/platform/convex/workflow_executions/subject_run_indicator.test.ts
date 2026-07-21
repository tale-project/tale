import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

/**
 * getSubjectRunIndicator surfaces a subject's latest-run state (Failed / Queued)
 * in place of its status badge. But a RESOLVED subject has nothing to surface: a
 * task already done/cancelled must keep its real terminal status, never a stale
 * "Failed" chip or a Re-run for a past crashed automation. This pins that.
 *
 * Mirrors mutations_error_codes.test.ts: identity via withIdentity, org
 * membership via a seeded `memberMirror` row (the RLS local-table fast path).
 */

const TEST_DIR_FROM_CONVEX_ROOT = 'workflow_executions';
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

const ORG = 'org_run_indicator';
const USER_ID = 'user_ri';
const IDENTITY = {
  subject: USER_ID,
  email: 'ri@example.com',
  name: 'RI Tester',
};

type T = ReturnType<typeof convexTest>;

function newT(): T {
  return convexTest(schema, modules);
}

async function seedMember(t: T): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      organizationId: ORG,
      userId: USER_ID,
      memberId: 'member_ri',
      role: 'member',
      createdAt: 0,
    });
  });
}

async function seedProject(t: T): Promise<Id<'projects'>> {
  return await t.run((ctx) =>
    ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Desk',
      createdBy: USER_ID,
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

/** `externalState:'open'` creates a backlog (non-terminal) task; `'closed'`
 *  creates a done (terminal) one — the two cases this test contrasts. */
async function seedTask(
  t: T,
  projectId: Id<'projects'>,
  externalId: string,
  externalState: 'open' | 'closed',
): Promise<Id<'tasks'>> {
  const res = await t.mutation(
    internal.tasks.internal_mutations.agentUpsertTaskByExternalRef,
    {
      organizationId: ORG,
      actorId: 'workflow',
      projectId,
      externalSystem: 'github',
      externalId,
      title: `Task ${externalId}`,
      externalState,
    },
  );
  if (!res.taskId) throw new Error('seedTask: expected a created task');
  return res.taskId;
}

async function seedFailedRun(
  t: T,
  taskId: Id<'tasks'>,
): Promise<Id<'wfExecutions'>> {
  return await t.run((ctx) =>
    ctx.db.insert('wfExecutions', {
      organizationId: ORG,
      wfDefinitionId: 'issue-desk/desk-process',
      status: 'failed',
      currentStepSlug: 'implement',
      startedAt: 0,
      updatedAt: 0,
      subjectType: 'task',
      subjectId: taskId,
    }),
  );
}

/** A just-kicked-off run: active (`pending`), not parked on capacity. */
async function seedPendingRun(
  t: T,
  taskId: Id<'tasks'>,
  opts?: { awaitingCapacityStepSlug?: string },
): Promise<Id<'wfExecutions'>> {
  return await t.run((ctx) =>
    ctx.db.insert('wfExecutions', {
      organizationId: ORG,
      wfDefinitionId: 'issue-desk/desk-process',
      status: 'pending',
      currentStepSlug: '',
      startedAt: 0,
      updatedAt: 0,
      subjectType: 'task',
      subjectId: taskId,
      ...(opts?.awaitingCapacityStepSlug !== undefined && {
        awaitingCapacityStepSlug: opts.awaitingCapacityStepSlug,
      }),
    }),
  );
}

describe('getSubjectRunIndicator terminal-subject suppression', () => {
  it('surfaces Failed (+ the run id) for a NON-terminal task whose latest run failed', async () => {
    const t = newT();
    await seedMember(t);
    const project = await seedProject(t);
    const taskId = await seedTask(t, project, 'o/r#1', 'open');
    const execId = await seedFailedRun(t, taskId);

    const res = await t
      .withIdentity(IDENTITY)
      .query(api.workflow_executions.queries.getSubjectRunIndicator, {
        organizationId: ORG,
        subjectType: 'task',
        subjectId: taskId,
      });

    expect(res).toEqual({ state: 'failed', failedExecutionId: execId });
  });

  it('surfaces Starting for an active run whose task status has not flipped yet', async () => {
    // The window between the desk's Start and the workflow's ack step: the run
    // exists (pending) but the task still reads backlog — the row must react.
    const t = newT();
    await seedMember(t);
    const project = await seedProject(t);
    const taskId = await seedTask(t, project, 'o/r#3', 'open');
    await seedPendingRun(t, taskId);

    const res = await t
      .withIdentity(IDENTITY)
      .query(api.workflow_executions.queries.getSubjectRunIndicator, {
        organizationId: ORG,
        subjectType: 'task',
        subjectId: taskId,
      });

    expect(res).toEqual({ state: 'starting', failedExecutionId: null });
  });

  it('suppresses Starting once the task itself reads in_progress', async () => {
    const t = newT();
    await seedMember(t);
    const project = await seedProject(t);
    const taskId = await seedTask(t, project, 'o/r#4', 'open');
    await seedPendingRun(t, taskId);
    await t.run((ctx) => ctx.db.patch(taskId, { status: 'in_progress' }));

    const res = await t
      .withIdentity(IDENTITY)
      .query(api.workflow_executions.queries.getSubjectRunIndicator, {
        organizationId: ORG,
        subjectType: 'task',
        subjectId: taskId,
      });

    // The task's own badge already shows the activity — nothing to surface.
    expect(res).toEqual({ state: null, failedExecutionId: null });
  });

  it('keeps parked-on-capacity ahead of Starting for an active queued run', async () => {
    const t = newT();
    await seedMember(t);
    const project = await seedProject(t);
    const taskId = await seedTask(t, project, 'o/r#5', 'open');
    await seedPendingRun(t, taskId, { awaitingCapacityStepSlug: 'run' });

    const res = await t
      .withIdentity(IDENTITY)
      .query(api.workflow_executions.queries.getSubjectRunIndicator, {
        organizationId: ORG,
        subjectType: 'task',
        subjectId: taskId,
      });

    expect(res).toEqual({ state: 'parked', failedExecutionId: null });
  });

  it('suppresses the failed-run indicator once the task is done', async () => {
    const t = newT();
    await seedMember(t);
    const project = await seedProject(t);
    const taskId = await seedTask(t, project, 'o/r#2', 'closed');
    await seedFailedRun(t, taskId);

    const res = await t
      .withIdentity(IDENTITY)
      .query(api.workflow_executions.queries.getSubjectRunIndicator, {
        organizationId: ORG,
        subjectType: 'task',
        subjectId: taskId,
      });

    expect(res).toEqual({ state: null, failedExecutionId: null });
  });
});
