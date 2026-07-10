/**
 * Internal actions for the tasks feature — scheduled follow-ups that must not
 * block the public create path (nested `startWorkflowFromFile` from
 * `createTaskFromExternalIssue` can hang the client on Created).
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalAction } from '../_generated/server';
import { orgSlugFromId } from '../lib/helpers/org_slug';
import { parseIssueNumber, parseRepoRef } from './issue_ref';

/**
 * Best-effort subject-linked workflow start for a just-created task. Soft-fails
 * (logs + returns null) so a missing install or read error never strands the
 * task — the Jobs "Start" affordance remains the recovery path.
 */
export const startWorkflowOnTask = internalAction({
  args: {
    organizationId: v.string(),
    taskId: v.id('tasks'),
    workflowSlug: v.string(),
    /** Authenticated user who clicked Create — attributed on the execution. */
    userId: v.string(),
  },
  returns: v.union(v.id('wfExecutions'), v.null()),
  handler: async (ctx, args): Promise<Id<'wfExecutions'> | null> => {
    const task = await ctx.runQuery(
      internal.tasks.internal_queries.getTaskByIdInternal,
      {
        taskId: args.taskId,
        organizationId: args.organizationId,
      },
    );
    if (!task) {
      console.error(
        '[task-workflow] scheduled start: task not found',
        args.taskId,
      );
      return null;
    }

    const issueNumber = parseIssueNumber(task.externalId);
    const repoRef = parseRepoRef(task.externalId);

    try {
      const orgSlug = await orgSlugFromId(ctx, args.organizationId);
      return await ctx.runAction(
        internal.workflow_engine.helpers.engine.start_workflow_from_file
          .startWorkflowFromFile,
        {
          organizationId: args.organizationId,
          orgSlug,
          workflowSlug: args.workflowSlug,
          triggeredBy: 'user',
          input: {
            task,
            issueNumber,
            owner: repoRef?.owner ?? null,
            repo: repoRef?.repo ?? null,
          },
          subject: { type: 'task', id: task._id },
          userId: args.userId,
        },
      );
    } catch (err) {
      console.error(
        '[task-workflow] scheduled workflow start failed',
        args.workflowSlug,
        err,
      );
      return null;
    }
  },
});
