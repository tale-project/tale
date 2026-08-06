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
  return t.run(async (ctx) =>
    (await ctx.db.query('userNotifications').collect()).filter(
      (row) => row.userId === userId && row.type === 'task_review_requested',
    ),
  );
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
    expect(result).toEqual({ taskCompleted: true, agentKicked: false });

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
    expect(result).toEqual({ taskCompleted: false, agentKicked: false });
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
    expect(result).toEqual({ taskCompleted: false, agentKicked: true });

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

  it('request-changes on a non-agent driver records the comment without a kick', async () => {
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
    expect(result).toEqual({ taskCompleted: false, agentKicked: false });
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.commentCount).toBe(1);
    expect(task?.status).toBe('in_review');
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
    expect(result).toEqual({ taskCompleted: false, agentKicked: false });
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.status).toBe('in_review');
    const [review] = await taskReviews(t, taskId);
    expect(review?.status).toBe('completed');
  });
});
