import { v } from 'convex/values';

import { api, internal } from '../_generated/api';
import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';

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
      // The upstream issue number for human/commit references. `task.number` is
      // an internal per-project counter, NOT the issue id — derive the real one
      // from externalId ("owner/repo#N"); pass it as input.issueNumber.
      const parsedIssue = Number(args.externalId.split('#').pop());
      const issueNumber = Number.isFinite(parsedIssue) ? parsedIssue : null;
      if (!loaded?.task) {
        // Just-created task isn't readable back (e.g. raced delete): don't start
        // a run doomed to fail on a null input.task — surface no run instead.
        console.error(
          '[create-task] created task not readable; skipping workflow start',
          result.taskId,
        );
        executionId = null;
      } else {
        try {
          executionId = await ctx.runAction(
            api.workflow_executions.actions.startWorkflowFromFile,
            {
              organizationId: args.organizationId,
              workflowSlug: args.runWorkflowSlug,
              triggeredBy: 'user',
              input: { task: loaded.task, issueNumber },
              subject: { type: 'task', id: result.taskId },
            },
          );
        } catch (err) {
          // The task is already committed and idempotent re-picks return
          // created:false (so a retry can't re-run it). Never reject the whole
          // create over a start failure — that would strand the task with no run
          // and no recovery. Keep the task, return executionId:null, and let the
          // client surface "run not started".
          console.error(
            '[create-task] workflow start failed',
            args.runWorkflowSlug,
            err,
          );
          executionId = null;
        }
      }
    }

    return { taskId: result.taskId, created: result.created, executionId };
  },
});
