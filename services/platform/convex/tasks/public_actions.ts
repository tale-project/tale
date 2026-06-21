import { v } from 'convex/values';

import { api, internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { type ActionCtx, action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { parseIssueNumber } from './issue_ref';

/**
 * Start a workflow ON an existing task, subject-linked so any UI showing the
 * task's run picks it up. Derives the upstream issue number from the task's
 * externalId ("owner/repo#N"); null for non-issue tasks (the workflow only
 * string-interpolates it). Shared by the create→run path and the manual
 * (re-)trigger. Never rejects: the task is already committed, so a start failure
 * returns null ("run not started") rather than stranding the task — the caller
 * surfaces that to the user.
 */
async function startWorkflowForTask(
  ctx: ActionCtx,
  args: { organizationId: string; task: Doc<'tasks'>; workflowSlug: string },
): Promise<string | null> {
  const issueNumber = parseIssueNumber(args.task.externalId);
  try {
    return await ctx.runAction(
      api.workflow_executions.actions.startWorkflowFromFile,
      {
        organizationId: args.organizationId,
        workflowSlug: args.workflowSlug,
        triggeredBy: 'user',
        input: { task: args.task, issueNumber },
        subject: { type: 'task', id: args.task._id },
      },
    );
  } catch (err) {
    console.error(
      '[task-workflow] workflow start failed',
      args.workflowSlug,
      err,
    );
    return null;
  }
}

/**
 * Public, org-gated wrapper to create a task BOUND to an external issue
 * (`externalSystem`/`externalId`/`externalUrl`). The upsert that carries the
 * external ref is internal-only and needs an actor, so this thin action supplies
 * the authenticated user as the actor and defaults the destination project to
 * the org's project. Idempotent on (org, system, externalId) — picking the same
 * issue twice updates rather than duplicates. The created task is reactive, so
 * the rest of the view (the tasks Collection) reflects it live.
 *
 * When `runWorkflowSlug` is set, a NEWLY created task also kicks off that workflow
 * on itself (subject-linked) — the app-scoped create→run: only THIS app's create
 * runs THIS workflow, never an org-global task event (which would mis-fire on
 * tasks from other apps/channels). Skipped on idempotent re-pick (created=false).
 */
export const createTaskFromExternalIssue = action({
  args: {
    organizationId: v.string(),
    externalSystem: v.string(),
    externalId: v.string(),
    title: v.string(),
    externalUrl: v.optional(v.string()),
    description: v.optional(v.string()),
    labels: v.optional(v.array(v.string())),
    /** App workflow slug to run on the newly created task (app-scoped). */
    runWorkflowSlug: v.optional(v.string()),
  },
  returns: v.object({
    taskId: v.string(),
    created: v.boolean(),
    executionId: v.optional(v.union(v.string(), v.null())),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    taskId: string;
    created: boolean;
    executionId?: string | null;
  }> => {
    const { userId } = await requireOrgMembershipById(ctx, args.organizationId);

    const projects = await ctx.runQuery(api.projects.queries.listProjects, {
      organizationId: args.organizationId,
    });
    const project = projects.find((p) => p.isOrgWide) ?? projects[0];
    if (!project) {
      throw new Error('No project available — create a project first');
    }

    const result = await ctx.runMutation(
      internal.tasks.internal_mutations.agentUpsertTaskByExternalRef,
      {
        organizationId: args.organizationId,
        actorId: userId,
        projectId: project._id,
        externalSystem: args.externalSystem,
        externalId: args.externalId,
        title: args.title,
        externalUrl: args.externalUrl,
        description: args.description,
        labels: args.labels,
        externalState: 'open',
      },
    );

    let executionId: string | null | undefined;
    if (args.runWorkflowSlug && result.created) {
      // The workflow reads the full task doc (input.task.{_id,title,externalUrl,
      // description,...}); fetch it rather than re-deriving the shape here.
      const loaded = await ctx.runQuery(api.tasks.queries.getTask, {
        taskId: result.taskId,
      });
      if (!loaded?.task) {
        // Just-created task isn't readable back (e.g. raced delete): don't start
        // a run doomed to fail on a null input.task — surface no run instead.
        console.error(
          '[create-task] created task not readable; skipping workflow start',
          result.taskId,
        );
        executionId = null;
      } else {
        executionId = await startWorkflowForTask(ctx, {
          organizationId: args.organizationId,
          task: loaded.task,
          workflowSlug: args.runWorkflowSlug,
        });
      }
    }

    return { taskId: result.taskId, created: result.created, executionId };
  },
});

/**
 * Manually (re-)trigger a workflow on an existing task — the Tasks-board "Start"
 * affordance, and the recovery path when a create-launched run failed for any
 * reason (e.g. a bad agent credential). Starts a fresh, subject-linked run; the
 * workflow itself owns the task's status (its `ack` step → in_progress, its
 * failure/rollback path → todo), so this never writes status directly.
 *
 * Guarded against duplicate concurrent runs: while a run for this task is still
 * pending/running, refuses (returns the in-flight executionId) rather than
 * racing a second run over the same `tale/<taskId>` git branch + PR.
 */
export const startTaskWorkflow = action({
  args: {
    organizationId: v.string(),
    taskId: v.id('tasks'),
    workflowSlug: v.string(),
  },
  returns: v.object({
    started: v.boolean(),
    executionId: v.union(v.string(), v.null()),
    reason: v.optional(
      v.union(v.literal('already_running'), v.literal('not_started')),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    started: boolean;
    executionId: string | null;
    reason?: 'already_running' | 'not_started';
  }> => {
    await requireOrgMembershipById(ctx, args.organizationId);

    const loaded = await ctx.runQuery(api.tasks.queries.getTask, {
      taskId: args.taskId,
    });
    if (!loaded?.task) {
      throw new Error('Task not found');
    }

    const active = await ctx.runQuery(
      internal.workflow_executions.internal_queries
        .getActiveExecutionForSubject,
      {
        organizationId: args.organizationId,
        subjectType: 'task',
        subjectId: args.taskId,
      },
    );
    if (active) {
      return {
        started: false,
        reason: 'already_running',
        executionId: active.executionId,
      };
    }

    const executionId = await startWorkflowForTask(ctx, {
      organizationId: args.organizationId,
      task: loaded.task,
      workflowSlug: args.workflowSlug,
    });
    if (!executionId) {
      return { started: false, reason: 'not_started', executionId: null };
    }
    return { started: true, executionId };
  },
});
