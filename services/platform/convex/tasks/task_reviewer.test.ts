// The named-reviewer arc against a real convex-test backend: designation
// (`setTaskReviewer` permission matrix + pending-review re-target), the
// canEdit-gated default chain (`resolveReviewer`), the settle-time
// workflow-free mint (park-and-mint transaction: idempotency per runId,
// supersede of older pending reviews, reviewer notification), and the
// workflow-free respond semantics (approve completes the task as the
// responding user; request-changes posts the feedback comment and re-kicks
// the agent driver).

import agentComponent from '@convex-dev/agent/test';
import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { sessionIdForProjectAgent } from '../sandbox/session_naming';
import schema from '../schema';
import { resolveReviewer } from './review_shared';

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

const ORG = 'org_reviewer';
const CREATOR = 'u_creator'; // project creator, editor role
const EDITOR = 'u_editor';
const REVIEWER = 'u_reviewer'; // editor role — a valid designee
const MEMBER = 'u_member'; // read-only role — invalid designee, forbidden caller
const DISABLED = 'u_disabled';

type T = TestConvex<typeof schema>;

async function seedWorld(t: T): Promise<{
  projectId: Id<'projects'>;
  agentId: Id<'projectAgents'>;
  taskId: Id<'tasks'>;
}> {
  return t.run(async (ctx) => {
    const roles: Array<[string, string]> = [
      [CREATOR, 'editor'],
      [EDITOR, 'editor'],
      [REVIEWER, 'editor'],
      [MEMBER, 'member'],
      [DISABLED, 'disabled'],
    ];
    for (const [userId, role] of roles) {
      await ctx.db.insert('memberMirror', {
        memberId: `m_${userId}_${ORG}`,
        userId,
        organizationId: ORG,
        role,
        createdAt: 0,
      });
    }
    const projectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Apollo',
      createdBy: CREATOR,
      createdAt: 0,
      updatedAt: 0,
    });
    const agentId = await ctx.db.insert('projectAgents', {
      organizationId: ORG,
      projectId,
      name: 'Helper',
      harness: 'claude-code',
      model: 'z-ai/glm-5',
      skills: [],
      connectors: [],
      createdBy: CREATOR,
      createdAt: 0,
      updatedAt: 0,
    });
    const taskId = await ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: 'Quarterly numbers',
      status: 'in_progress',
      rank: 'a0',
      assigneeType: 'agent',
      assigneeId: String(agentId),
      createdBy: CREATOR,
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
    });
    return { projectId, agentId, taskId };
  });
}

/** A settled agent run whose settle the mint tests replay. */
async function seedSettledRun(
  t: T,
  projectId: Id<'projects'>,
  taskId: Id<'tasks'>,
  agentId: Id<'projectAgents'>,
  execId = 'exec-1',
): Promise<Id<'projectAgentRuns'>> {
  return t.run((ctx) =>
    ctx.db.insert('projectAgentRuns', {
      organizationId: ORG,
      projectId,
      taskId,
      agentId,
      execId,
      sessionId: 'pa-test',
      status: 'settled',
      harness: 'claude-code',
      model: 'z-ai/glm-5',
      startedBy: EDITOR,
      startedAt: 0,
      deadlineAt: 10_000,
      updatedAt: 0,
    }),
  );
}

async function parkForReview(
  t: T,
  taskId: Id<'tasks'>,
  agentId: Id<'projectAgents'>,
  runId: Id<'projectAgentRuns'>,
): Promise<{ ok: boolean; reason?: string }> {
  return t.mutation(internal.tasks.internal_mutations.agentUpdateTaskStatus, {
    organizationId: ORG,
    actorId: String(agentId),
    taskId,
    status: 'in_review',
    review: { runId },
  });
}

async function taskReviews(
  t: T,
  taskId: Id<'tasks'>,
): Promise<Doc<'approvals'>[]> {
  return t.run(async (ctx) => {
    const rows: Doc<'approvals'>[] = [];
    for await (const approval of ctx.db
      .query('approvals')
      .withIndex('by_resource', (q) =>
        q.eq('resourceType', 'task_review').eq('resourceId', String(taskId)),
      )) {
      rows.push(approval);
    }
    return rows;
  });
}

async function bellsFor(t: T, userId: string) {
  return bellsOf(t, userId, 'task_review_requested');
}

/** Bell rows of one type for one user, in write order. */
async function bellsOf(t: T, userId: string, type: string) {
  return t.run(async (ctx) =>
    (await ctx.db.query('userNotifications').collect()).filter(
      (row) => row.userId === userId && row.type === type,
    ),
  );
}

/** The task's watchers, as (subscriberId, reason) pairs. */
async function watchersOf(t: T, taskId: Id<'tasks'>) {
  return t.run(async (ctx) =>
    (await ctx.db.query('taskSubscriptions').collect())
      .filter((row) => row.taskId === taskId)
      .map((row) => ({ subscriberId: row.subscriberId, reason: row.reason })),
  );
}

/** Move the card by hand, the way a person drags it or picks a status. */
async function humanSetStatus(
  t: T,
  taskId: Id<'tasks'>,
  status: 'todo' | 'in_progress' | 'in_review' | 'done',
  as = EDITOR,
): Promise<void> {
  await t
    .withIdentity({ subject: as })
    .mutation(api.tasks.mutations.updateTaskStatus, { taskId, status });
}

describe('setTaskReviewer', () => {
  it('designates an editor and records activity + audit', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.review_mutations.setTaskReviewer, {
        taskId,
        reviewerUserId: REVIEWER,
      });

    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.reviewerUserId).toBe(REVIEWER);
    const activity = await t.run((ctx) =>
      ctx.db.query('taskActivity').collect(),
    );
    expect(activity).toContainEqual(
      expect.objectContaining({
        action: 'reviewer.changed',
        toValue: REVIEWER,
      }),
    );
  });

  it('clears when the id is absent (one mutation, set/unset)', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    const as = t.withIdentity({ subject: EDITOR });
    await as.mutation(api.tasks.review_mutations.setTaskReviewer, {
      taskId,
      reviewerUserId: REVIEWER,
    });

    await as.mutation(api.tasks.review_mutations.setTaskReviewer, { taskId });

    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.reviewerUserId).toBeUndefined();
  });

  it('refuses a read-only caller and a non-member caller', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);

    await expect(
      t
        .withIdentity({ subject: MEMBER })
        .mutation(api.tasks.review_mutations.setTaskReviewer, {
          taskId,
          reviewerUserId: REVIEWER,
        }),
    ).rejects.toThrow(/TASK_FORBIDDEN/);
    await expect(
      t
        .withIdentity({ subject: 'u_stranger' })
        .mutation(api.tasks.review_mutations.setTaskReviewer, {
          taskId,
          reviewerUserId: REVIEWER,
        }),
    ).rejects.toThrow();
  });

  it('rejects ineligible designees: view-only member, disabled, non-member', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    const as = t.withIdentity({ subject: EDITOR });

    for (const designee of [MEMBER, DISABLED, 'u_stranger']) {
      await expect(
        as.mutation(api.tasks.review_mutations.setTaskReviewer, {
          taskId,
          reviewerUserId: designee,
        }),
      ).rejects.toThrow(/REVIEWER_NOT_ELIGIBLE/);
    }
  });

  it('refuses on an archived task', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    await t.run((ctx) => ctx.db.patch(taskId, { archivedAt: 1 }));

    await expect(
      t
        .withIdentity({ subject: EDITOR })
        .mutation(api.tasks.review_mutations.setTaskReviewer, {
          taskId,
          reviewerUserId: REVIEWER,
        }),
    ).rejects.toThrow(/TASK_ARCHIVED/);
  });

  it('re-targets a pending review: requestedFor patched, old bells dismissed, new reviewer pinged', async () => {
    const t = convexTest(schema, modules);
    const { projectId, agentId, taskId } = await seedWorld(t);
    const runId = await seedSettledRun(t, projectId, taskId, agentId);
    // Mint lands on the default chain → the human creator.
    await parkForReview(t, taskId, agentId, runId);
    expect(await bellsFor(t, CREATOR)).toHaveLength(1);

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.review_mutations.setTaskReviewer, {
        taskId,
        reviewerUserId: REVIEWER,
      });

    const [review] = await taskReviews(t, taskId);
    expect(review?.status).toBe('pending');
    expect(review?.metadata).toMatchObject({ requestedFor: REVIEWER });
    const creatorBells = await bellsFor(t, CREATOR);
    expect(creatorBells.every((bell) => bell.read)).toBe(true);
    expect(await bellsFor(t, REVIEWER)).toHaveLength(1);
  });

  it('subscribes the designee and sends a heads-up while work is in flight', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.review_mutations.setTaskReviewer, {
        taskId,
        reviewerUserId: REVIEWER,
      });

    // They own the gate, so they follow the task from here on.
    expect(await watchersOf(t, taskId)).toContainEqual({
      subscriberId: REVIEWER,
      reason: 'reviewer',
    });
    // Nothing is waiting yet: a bell, no gate, and no email-worthy request.
    expect(await taskReviews(t, taskId)).toHaveLength(0);
    expect(await bellsFor(t, REVIEWER)).toHaveLength(0);
    const headsUp = await bellsOf(t, REVIEWER, 'task_reviewer_assigned');
    expect(headsUp).toHaveLength(1);
    expect(headsUp[0]).toMatchObject({
      resourceType: 'task',
      resourceId: String(taskId),
      actorId: EDITOR,
    });
  });

  it('opens the gate when the designation lands on work already in review', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    // In review with no gate behind it — a park that predates the
    // state-driven request, or a superseded round.
    await t.run((ctx) => ctx.db.patch(taskId, { status: 'in_review' }));

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.review_mutations.setTaskReviewer, {
        taskId,
        reviewerUserId: REVIEWER,
      });

    const reviews = await taskReviews(t, taskId);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.status).toBe('pending');
    expect(reviews[0]?.metadata).toMatchObject({ requestedFor: REVIEWER });
    // The real request, not the heads-up.
    expect(await bellsFor(t, REVIEWER)).toHaveLength(1);
    expect(await bellsOf(t, REVIEWER, 'task_reviewer_assigned')).toHaveLength(
      0,
    );
  });

  it('lets the designated reviewer follow later activity', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.review_mutations.setTaskReviewer, {
        taskId,
        reviewerUserId: REVIEWER,
      });

    await humanSetStatus(t, taskId, 'todo');

    expect(await bellsOf(t, REVIEWER, 'task_status_changed')).toHaveLength(1);
  });
});

// The gate belongs to the STATE: a person moving the card opens the same review
// request an agent settle does, so the Reviewer field is not decorative on
// human-driven work.
describe('human park opens the review gate', () => {
  /** A human-owned task with a designated reviewer, sitting in progress. */
  async function humanOwnedWorld(t: T) {
    const world = await seedWorld(t);
    await t.run((ctx) =>
      ctx.db.patch(world.taskId, {
        assigneeType: 'user',
        assigneeId: EDITOR,
        reviewerUserId: REVIEWER,
      }),
    );
    return world;
  }

  it('mints one gate and asks the designated reviewer', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await humanOwnedWorld(t);

    await humanSetStatus(t, taskId, 'in_review');

    const reviews = await taskReviews(t, taskId);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.status).toBe('pending');
    expect(reviews[0]?.metadata).toMatchObject({ requestedFor: REVIEWER });
    // No run behind it — the idempotency key is "one open gate per task".
    expect(reviews[0]?.metadata).not.toHaveProperty('runId');
    const bells = await bellsFor(t, REVIEWER);
    expect(bells).toHaveLength(1);
    // A person submitted this, so the copy must not claim agent work.
    expect(bells[0]?.bodyKey).toBe('taskReviewRequestedBodyHuman');
    expect(bells[0]?.actorType).toBe('user');
    expect(bells[0]?.actorId).toBe(EDITOR);
  });

  it('does not open a second gate while one is still pending', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await humanOwnedWorld(t);

    await humanSetStatus(t, taskId, 'in_review');
    // Bounced out and back in before the reviewer answered.
    await humanSetStatus(t, taskId, 'in_progress');
    await humanSetStatus(t, taskId, 'in_review');

    expect(await taskReviews(t, taskId)).toHaveLength(1);
    expect(await bellsFor(t, REVIEWER)).toHaveLength(1);
  });

  it('opens a fresh round after the previous one was answered', async () => {
    const t = convexTest(schema, modules);
    // request-changes posts its feedback into the task discussion.
    agentComponent.register(t);
    const { taskId } = await humanOwnedWorld(t);
    await humanSetStatus(t, taskId, 'in_review');
    const [first] = await taskReviews(t, taskId);
    if (!first) throw new Error('first gate missing');
    await t
      .withIdentity({ subject: REVIEWER })
      .mutation(api.tasks.review_mutations.respondToTaskReview, {
        approvalId: first._id,
        decision: 'request_changes',
        feedback: 'Add the regional split.',
      });

    // Re-submitting asks again — the GitHub "re-request review" gesture.
    await humanSetStatus(t, taskId, 'in_review');

    const reviews = await taskReviews(t, taskId);
    expect(reviews).toHaveLength(2);
    expect(reviews.filter((row) => row.status === 'pending')).toHaveLength(1);
    expect(await bellsFor(t, REVIEWER)).toHaveLength(2);
  });

  it('mints without pinging when the reviewer submits their own work', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await humanOwnedWorld(t);

    await humanSetStatus(t, taskId, 'in_review', REVIEWER);

    expect(await taskReviews(t, taskId)).toHaveLength(1);
    expect(await bellsFor(t, REVIEWER)).toHaveLength(0);
  });

  it('still mints when nobody resolves, with no targeted ping', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    // No designation, no human creator with canEdit, no project creator.
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, {
        assigneeType: 'user',
        assigneeId: EDITOR,
        createdBy: 'agent-slug',
        createdByType: 'agent',
      });
      const task = await ctx.db.get(taskId);
      if (task) await ctx.db.patch(task.projectId, { createdBy: DISABLED });
    });

    await humanSetStatus(t, taskId, 'in_review');

    const reviews = await taskReviews(t, taskId);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.metadata).toMatchObject({ requestedFor: null });
  });
});

describe('resolveReviewer default chain', () => {
  it('prefers the explicit designation while it still holds canEdit', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    await t.run((ctx) => ctx.db.patch(taskId, { reviewerUserId: REVIEWER }));

    const resolved = await t.run(async (ctx) => {
      const task = await ctx.db.get(taskId);
      if (!task) throw new Error('task missing');
      return resolveReviewer(ctx, task);
    });
    expect(resolved).toBe(REVIEWER);
  });

  it('falls through a designee who lost eligibility, to the human creator', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    await t.run((ctx) => ctx.db.patch(taskId, { reviewerUserId: MEMBER }));

    const resolved = await t.run(async (ctx) => {
      const task = await ctx.db.get(taskId);
      if (!task) throw new Error('task missing');
      return resolveReviewer(ctx, task);
    });
    expect(resolved).toBe(CREATOR);
  });

  it('skips a non-canEdit creator and lands on the project creator', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    await t.run((ctx) =>
      ctx.db.patch(taskId, { createdBy: MEMBER, createdByType: 'user' }),
    );

    const resolved = await t.run(async (ctx) => {
      const task = await ctx.db.get(taskId);
      if (!task) throw new Error('task missing');
      return resolveReviewer(ctx, task);
    });
    expect(resolved).toBe(CREATOR);
  });

  it('resolves to nobody when no candidate holds canEdit', async () => {
    const t = convexTest(schema, modules);
    const { projectId, taskId } = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, { createdBy: MEMBER, createdByType: 'user' });
      await ctx.db.patch(projectId, { createdBy: MEMBER });
    });

    const resolved = await t.run(async (ctx) => {
      const task = await ctx.db.get(taskId);
      if (!task) throw new Error('task missing');
      // Convex serializes undefined to null across the t.run boundary.
      return (await resolveReviewer(ctx, task)) ?? null;
    });
    expect(resolved).toBeNull();
  });
});

describe('settle park-and-mint', () => {
  it('parks the task and mints one pending review targeting the durable reviewer', async () => {
    const t = convexTest(schema, modules);
    const { projectId, agentId, taskId } = await seedWorld(t);
    await t.run((ctx) => ctx.db.patch(taskId, { reviewerUserId: REVIEWER }));
    const runId = await seedSettledRun(t, projectId, taskId, agentId);

    const result = await parkForReview(t, taskId, agentId, runId);
    expect(result).toEqual({ ok: true });

    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.status).toBe('in_review');
    const reviews = await taskReviews(t, taskId);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ status: 'pending' });
    expect(reviews[0]?.wfExecutionId).toBeUndefined();
    expect(reviews[0]?.metadata).toMatchObject({
      requestedFor: REVIEWER,
      runId: String(runId),
      agentSlug: 'Helper',
      round: 0,
    });
    expect(await bellsFor(t, REVIEWER)).toHaveLength(1);
  });

  it('is idempotent per (taskId, runId) — a replayed settle finds the row', async () => {
    const t = convexTest(schema, modules);
    const { projectId, agentId, taskId } = await seedWorld(t);
    const runId = await seedSettledRun(t, projectId, taskId, agentId);

    await parkForReview(t, taskId, agentId, runId);
    await parkForReview(t, taskId, agentId, runId);

    expect(await taskReviews(t, taskId)).toHaveLength(1);
    expect(await bellsFor(t, CREATOR)).toHaveLength(1);
  });

  it('a rerun mints fresh and supersedes the older pending review', async () => {
    const t = convexTest(schema, modules);
    const { projectId, agentId, taskId } = await seedWorld(t);
    const firstRun = await seedSettledRun(t, projectId, taskId, agentId);
    await parkForReview(t, taskId, agentId, firstRun);
    const secondRun = await seedSettledRun(
      t,
      projectId,
      taskId,
      agentId,
      'exec-2',
    );

    await parkForReview(t, taskId, agentId, secondRun);

    const reviews = await taskReviews(t, taskId);
    expect(reviews).toHaveLength(2);
    const pending = reviews.filter((row) => row.status === 'pending');
    const superseded = reviews.filter((row) => row.status === 'rejected');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.metadata).toMatchObject({
      runId: String(secondRun),
      round: 1,
    });
    expect(superseded).toHaveLength(1);
    expect(superseded[0]?.metadata).toMatchObject({
      runId: String(firstRun),
      supersededBy: pending[0]?._id,
    });
    // The first request's bell was dismissed with the supersede; only the
    // fresh request stays unread.
    const bells = await bellsFor(t, CREATOR);
    expect(bells.filter((bell) => !bell.read)).toHaveLength(1);
  });

  it('mints with requestedFor null and no targeted bell when nobody resolves', async () => {
    const t = convexTest(schema, modules);
    const { projectId, agentId, taskId } = await seedWorld(t);
    await t.run(async (ctx) => {
      const task = await ctx.db.get(taskId);
      if (!task) throw new Error('task missing');
      await ctx.db.patch(taskId, { createdBy: MEMBER, createdByType: 'user' });
      await ctx.db.patch(task.projectId, { createdBy: MEMBER });
    });
    const runId = await seedSettledRun(t, projectId, taskId, agentId);

    await parkForReview(t, taskId, agentId, runId);

    const [review] = await taskReviews(t, taskId);
    expect(review?.status).toBe('pending');
    expect(review?.metadata).toMatchObject({ requestedFor: null });
    const bells = await t.run(async (ctx) =>
      (await ctx.db.query('userNotifications').collect()).filter(
        (row) => row.type === 'task_review_requested',
      ),
    );
    expect(bells).toHaveLength(0);
  });

  it('never mints when the transition is not an in_review park', async () => {
    const t = convexTest(schema, modules);
    const { projectId, agentId, taskId } = await seedWorld(t);
    const runId = await seedSettledRun(t, projectId, taskId, agentId);

    const refused = await t.mutation(
      internal.tasks.internal_mutations.agentUpdateTaskStatus,
      {
        organizationId: ORG,
        actorId: String(agentId),
        taskId,
        status: 'done',
        review: { runId },
      },
    );
    expect(refused).toEqual({ ok: false, reason: 'AGENTS_CANNOT_COMPLETE' });
    expect(await taskReviews(t, taskId)).toHaveLength(0);
  });
});

describe('respondToTaskReview — workflow-free semantics', () => {
  async function mintedWorld(t: T) {
    const world = await seedWorld(t);
    const runId = await seedSettledRun(
      t,
      world.projectId,
      world.taskId,
      world.agentId,
    );
    await parkForReview(t, world.taskId, world.agentId, runId);
    const [review] = await taskReviews(t, world.taskId);
    if (!review) throw new Error('mint failed');
    return { ...world, runId, approvalId: review._id };
  }

  it('approve completes the task as the responding user', async () => {
    const t = convexTest(schema, modules);
    const { taskId, approvalId } = await mintedWorld(t);

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.review_mutations.respondToTaskReview, {
        approvalId,
        decision: 'approve',
      });
    expect(result).toEqual({
      taskCompleted: true,
      agentKicked: false,
      taskReopened: false,
    });

    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.status).toBe('done');
    expect(task?.completedAt).toBeDefined();
    const [review] = await taskReviews(t, taskId);
    expect(review?.status).toBe('completed');
    expect(review?.approvedBy).toBe(EDITOR);
    const activity = await t.run((ctx) =>
      ctx.db.query('taskActivity').collect(),
    );
    expect(activity).toContainEqual(
      expect.objectContaining({
        actorType: 'user',
        actorId: EDITOR,
        action: 'status.changed',
        toValue: 'done',
      }),
    );
  });

  it('approve on a task that already moved on records the decision only', async () => {
    const t = convexTest(schema, modules);
    const { taskId, approvalId } = await mintedWorld(t);
    await t.run((ctx) =>
      ctx.db.patch(taskId, { status: 'in_progress', statusChangedAt: 5 }),
    );

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.review_mutations.respondToTaskReview, {
        approvalId,
        decision: 'approve',
      });
    expect(result).toEqual({
      taskCompleted: false,
      agentKicked: false,
      taskReopened: false,
    });
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.status).toBe('in_progress');
    const [review] = await taskReviews(t, taskId);
    expect(review?.status).toBe('completed');
  });

  it('approve refuses while the task has open subtasks — nothing is recorded', async () => {
    const t = convexTest(schema, modules);
    const { projectId, taskId, approvalId } = await mintedWorld(t);
    await t.run((ctx) =>
      ctx.db.insert('tasks', {
        organizationId: ORG,
        projectId,
        title: 'Open subtask',
        status: 'todo',
        rank: 'a1',
        parentTaskId: taskId,
        createdBy: CREATOR,
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 0,
      }),
    );

    await expect(
      t
        .withIdentity({ subject: EDITOR })
        .mutation(api.tasks.review_mutations.respondToTaskReview, {
          approvalId,
          decision: 'approve',
        }),
    ).rejects.toThrow(/TASK_HAS_OPEN_SUBTASKS/);
    // The throw rolled the whole respond back — still pending, still in review.
    const [review] = await taskReviews(t, taskId);
    expect(review?.status).toBe('pending');
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.status).toBe('in_review');
  });

  it('request-changes posts the feedback comment and re-kicks the agent driver', async () => {
    const t = convexTest(schema, modules);
    agentComponent.register(t);
    const { taskId, approvalId, runId } = await mintedWorld(t);

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.review_mutations.respondToTaskReview, {
        approvalId,
        decision: 'request_changes',
        feedback: 'The summary still cites last period.',
      });
    // `taskReopened` stays false: the agent kick already moved the card out of
    // In review, so the reviewer path has nothing left to move.
    expect(result).toEqual({
      taskCompleted: false,
      agentKicked: true,
      taskReopened: false,
    });

    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.status).toBe('in_progress');
    expect(task?.commentCount).toBe(1);
    const meta = await t.run((ctx) =>
      ctx.db.query('taskDiscussionMessageMeta').collect(),
    );
    expect(meta).toHaveLength(1);
    expect(meta[0]).toMatchObject({ authorType: 'user', authorId: EDITOR });
    const runs = await t.run((ctx) =>
      ctx.db.query('projectAgentRuns').collect(),
    );
    const kicked = runs.filter((run) => run._id !== runId);
    expect(kicked).toHaveLength(1);
    expect(kicked[0]).toMatchObject({
      status: 'queued',
      trigger: 'mention',
      feedback: 'The summary still cites last period.',
    });
  });

  it('request-changes RESUMES the reviewed conversation when the run stored a handle', async () => {
    const t = convexTest(schema, modules);
    agentComponent.register(t);
    const { agentId, approvalId, runId } = await mintedWorld(t);
    // The reviewed run captured its harness conversation + incarnation; the
    // agent's standing session is still that incarnation.
    const sessionId = sessionIdForProjectAgent(agentId);
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, {
        sessionId,
        agentSessionId: 'c2a38047-3e04-4874-b87a-6a38f56d5041',
        sessionCreatedAt: 111,
        settledAt: 5_000,
      });
      await ctx.db.insert('sandboxSessions', {
        organizationId: ORG,
        sessionId,
        profile: 'agent',
        status: 'stopped',
        ownerType: 'project_agent',
        ownerId: String(agentId),
        createdBy: 'system:task-agent',
        createdAt: 111,
        expiresAt: Date.now() + 60_000,
      });
    });

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.review_mutations.respondToTaskReview, {
        approvalId,
        decision: 'request_changes',
        feedback: 'The summary still cites last period.',
      });

    const scheduled = await t.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    const starts = scheduled.filter((job) =>
      job.name.includes('startTaskAgentTurn'),
    );
    expect(starts).toHaveLength(1);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- system table args are untyped
    const args = starts[0]?.args[0] as {
      resume?: string;
      sweep?: boolean;
      feedback?: string;
    };
    expect(args.resume).toBe('c2a38047-3e04-4874-b87a-6a38f56d5041');
    expect(args.sweep).toBe(true); // settled predecessor: leftovers harvested
    expect(args.feedback).toBe('The summary still cites last period.');
  });

  it('request-changes on a non-agent driver comments and sends the task back', async () => {
    const t = convexTest(schema, modules);
    agentComponent.register(t);
    const { taskId, approvalId } = await mintedWorld(t);
    await t.run((ctx) =>
      ctx.db.patch(taskId, { assigneeType: 'user', assigneeId: EDITOR }),
    );

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.review_mutations.respondToTaskReview, {
        approvalId,
        decision: 'request_changes',
        feedback: 'Please double-check the totals.',
      });
    // No agent to kick, so the reviewer's decision itself hands the work back:
    // In review must not keep a card whose gate has been answered.
    expect(result).toEqual({
      taskCompleted: false,
      agentKicked: false,
      taskReopened: true,
    });
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.commentCount).toBe(1);
    expect(task?.status).toBe('in_progress');
    const activity = await t.run((ctx) =>
      ctx.db.query('taskActivity').collect(),
    );
    expect(activity).toContainEqual(
      expect.objectContaining({
        actorType: 'user',
        actorId: EDITOR,
        action: 'status.changed',
        toValue: 'in_progress',
      }),
    );
  });

  it('holds the permission and validation matrix', async () => {
    const t = convexTest(schema, modules);
    const { approvalId } = await mintedWorld(t);

    await expect(
      t
        .withIdentity({ subject: MEMBER })
        .mutation(api.tasks.review_mutations.respondToTaskReview, {
          approvalId,
          decision: 'approve',
        }),
    ).rejects.toThrow(/TASK_FORBIDDEN/);
    await expect(
      t
        .withIdentity({ subject: EDITOR })
        .mutation(api.tasks.review_mutations.respondToTaskReview, {
          approvalId,
          decision: 'request_changes',
        }),
    ).rejects.toThrow(/REVIEW_FEEDBACK_REQUIRED/);

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.review_mutations.respondToTaskReview, {
        approvalId,
        decision: 'approve',
      });
    await expect(
      t
        .withIdentity({ subject: EDITOR })
        .mutation(api.tasks.review_mutations.respondToTaskReview, {
          approvalId,
          decision: 'approve',
        }),
    ).rejects.toThrow(/REVIEW_ALREADY_RESOLVED/);
  });

  it('records no policy-check fields when no review_policy is on file', async () => {
    const t = convexTest(schema, modules);
    const { taskId, approvalId } = await mintedWorld(t);

    // The run's driver (EDITOR started it) responds — allowed, exactly as
    // before the review_policy shipped.
    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.review_mutations.respondToTaskReview, {
        approvalId,
        decision: 'approve',
      });

    const [review] = await taskReviews(t, taskId);
    const response = (
      review?.metadata as { response?: Record<string, unknown> }
    )?.response;
    expect(response).toMatchObject({ decision: 'approve' });
    expect(response).not.toHaveProperty('independentReviewer');
    expect(response).not.toHaveProperty('competences');
    const audit = await t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect()).find(
        (row) => row.action === 'task.review_responded',
      ),
    );
    expect(audit?.metadata).toEqual({ runId: expect.any(String) });
  });

  it('a workflow-era review keeps the record-only path', async () => {
    const t = convexTest(schema, modules);
    const { projectId, agentId, taskId } = await seedWorld(t);
    const runId = await seedSettledRun(t, projectId, taskId, agentId);
    await parkForReview(t, taskId, agentId, runId);
    // Rebuild the review as a workflow-minted row.
    const approvalId = await t.run(async (ctx) => {
      const wfExecutionId = await ctx.db.insert('wfExecutions', {
        organizationId: ORG,
        wfDefinitionId: null,
        status: 'running',
        currentStepSlug: 'review',
        startedAt: 0,
        updatedAt: 0,
      });
      const [review] = await ctx.db
        .query('approvals')
        .withIndex('by_resource', (q) =>
          q.eq('resourceType', 'task_review').eq('resourceId', String(taskId)),
        )
        .collect();
      if (!review) throw new Error('mint missing');
      await ctx.db.patch(review._id, { wfExecutionId, stepSlug: 'review' });
      return review._id;
    });

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.review_mutations.respondToTaskReview, {
        approvalId,
        decision: 'approve',
      });
    expect(result).toEqual({
      taskCompleted: false,
      agentKicked: false,
      taskReopened: false,
    });
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.status).toBe('in_review');
    const [review] = await taskReviews(t, taskId);
    expect(review?.status).toBe('completed');
  });
});

describe('respondToTaskReview — review_policy enforcement', () => {
  async function mintedWorld(t: T) {
    const world = await seedWorld(t);
    const runId = await seedSettledRun(
      t,
      world.projectId,
      world.taskId,
      world.agentId,
    );
    await parkForReview(t, world.taskId, world.agentId, runId);
    const [review] = await taskReviews(t, world.taskId);
    if (!review) throw new Error('mint failed');
    return { ...world, runId, approvalId: review._id };
  }

  async function seedPolicy(t: T, config: unknown): Promise<void> {
    await t.run(async (ctx) => {
      await ctx.db.insert('configCache', {
        organizationId: ORG,
        domain: 'governance',
        key: 'review_policy',
        config,
        syncedAt: 0,
      });
    });
  }

  it("independence: the run's driver cannot respond; anyone else can, and the outcome is stamped", async () => {
    const t = convexTest(schema, modules);
    const { taskId, approvalId, runId } = await mintedWorld(t);
    await seedPolicy(t, { requireIndependentReviewer: true });

    // EDITOR started the run (`projectAgentRuns.startedBy`) — refused.
    await expect(
      t
        .withIdentity({ subject: EDITOR })
        .mutation(api.tasks.review_mutations.respondToTaskReview, {
          approvalId,
          decision: 'approve',
        }),
    ).rejects.toThrow(/REVIEW_INDEPENDENT_REVIEWER_REQUIRED/);
    // The refusal rolled everything back — still pending.
    const [pending] = await taskReviews(t, taskId);
    expect(pending?.status).toBe('pending');

    // A different editor passes; the check outcome rides the response AND
    // the audit row, beside the runId join key.
    await t
      .withIdentity({ subject: REVIEWER })
      .mutation(api.tasks.review_mutations.respondToTaskReview, {
        approvalId,
        decision: 'approve',
      });
    const [review] = await taskReviews(t, taskId);
    expect(review?.status).toBe('completed');
    expect(
      (review?.metadata as { response?: Record<string, unknown> })?.response,
    ).toMatchObject({ respondedBy: REVIEWER, independentReviewer: true });
    const audit = await t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect()).find(
        (row) => row.action === 'task.review_responded',
      ),
    );
    expect(audit?.metadata).toMatchObject({
      runId: String(runId),
      independentReviewer: true,
    });
  });

  it('independence without a resolvable run falls back to task.createdBy', async () => {
    const t = convexTest(schema, modules);
    const { taskId, approvalId } = await mintedWorld(t);
    await seedPolicy(t, { requireIndependentReviewer: true });
    // Simulate a workflow-era row: no runId linkage in the review metadata.
    await t.run(async (ctx) => {
      const review = await ctx.db.get(approvalId);
      const metadata = { ...(review?.metadata as Record<string, unknown>) };
      delete metadata.runId;
      await ctx.db.patch(approvalId, { metadata });
    });

    // CREATOR created the task — conservatively refused.
    await expect(
      t
        .withIdentity({ subject: CREATOR })
        .mutation(api.tasks.review_mutations.respondToTaskReview, {
          approvalId,
          decision: 'approve',
        }),
    ).rejects.toThrow(/REVIEW_INDEPENDENT_REVIEWER_REQUIRED/);

    // Any other editor may respond.
    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.review_mutations.respondToTaskReview, {
        approvalId,
        decision: 'approve',
      });
    const [review] = await taskReviews(t, taskId);
    expect(review?.status).toBe('completed');
  });

  it('competences: pass stamps the vouching records; missing, expired, and revoked refuse', async () => {
    const t = convexTest(schema, modules);
    const { taskId, approvalId, runId } = await mintedWorld(t);
    await seedPolicy(t, { requiredCompetences: ['vat-review', 'iso-audit'] });

    const refuse = () =>
      expect(
        t
          .withIdentity({ subject: EDITOR })
          .mutation(api.tasks.review_mutations.respondToTaskReview, {
            approvalId,
            decision: 'approve',
          }),
      ).rejects.toThrow(/REVIEW_COMPETENCE_REQUIRED/);

    // Nothing granted yet.
    await refuse();

    // One of two held — still refused (ALL are required).
    const vatId = await t.run((ctx) =>
      ctx.db.insert('competenceRecords', {
        organizationId: ORG,
        userId: EDITOR,
        competence: 'vat-review',
        grantedBy: CREATOR,
        grantedAt: 0,
      }),
    );
    await refuse();

    // The second held but EXPIRED — refused.
    const isoId = await t.run((ctx) =>
      ctx.db.insert('competenceRecords', {
        organizationId: ORG,
        userId: EDITOR,
        competence: 'iso-audit',
        grantedBy: CREATOR,
        grantedAt: 0,
        expiresAt: Date.now() - 1,
      }),
    );
    await refuse();

    // Unexpired but REVOKED — refused.
    await t.run((ctx) =>
      ctx.db.patch(isoId, {
        expiresAt: undefined,
        revokedAt: 1,
        revokedBy: CREATOR,
      }),
    );
    await refuse();

    // Reinstated — passes, and the outcome names the vouching records.
    await t.run((ctx) =>
      ctx.db.patch(isoId, { revokedAt: undefined, revokedBy: undefined }),
    );
    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.review_mutations.respondToTaskReview, {
        approvalId,
        decision: 'approve',
      });
    const [review] = await taskReviews(t, taskId);
    const response = (
      review?.metadata as {
        response?: { competences?: Record<string, unknown> };
      }
    )?.response;
    expect(response?.competences).toMatchObject({
      required: ['vat-review', 'iso-audit'],
      checkedAt: expect.any(Number),
    });
    expect(
      [...((response?.competences?.heldRecordIds as string[]) ?? [])].sort(),
    ).toEqual([String(vatId), String(isoId)].sort());
    const audit = await t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect()).find(
        (row) => row.action === 'task.review_responded',
      ),
    );
    expect(audit?.metadata).toMatchObject({
      runId: String(runId),
      competences: expect.objectContaining({
        required: ['vat-review', 'iso-audit'],
      }),
    });
  });

  it('a malformed review_policy is treated as absent — old behaviour exactly', async () => {
    const t = convexTest(schema, modules);
    const { taskId, approvalId } = await mintedWorld(t);
    await seedPolicy(t, { requiredCompetences: 'not-a-list' });

    // The driver responds with no competences on file — allowed.
    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.review_mutations.respondToTaskReview, {
        approvalId,
        decision: 'approve',
      });
    expect(result.taskCompleted).toBe(true);
    const [review] = await taskReviews(t, taskId);
    const response = (
      review?.metadata as { response?: Record<string, unknown> }
    )?.response;
    expect(response).not.toHaveProperty('independentReviewer');
    expect(response).not.toHaveProperty('competences');
  });
});
