/**
 * Internal actions for the tasks feature — scheduled follow-ups that must not
 * block the public create path (nested `startWorkflowFromFile` from
 * `createTaskFromExternalIssue` can hang the client on Created).
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalAction } from '../_generated/server';
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

    // Task-triggered workflow starts ran on the retired automation engine.
    // This dispatcher already treated a failed start as a logged no-op (the
    // task itself is unaffected), so an offline engine degrades the same way.
    console.warn(
      '[task-workflow] workflow start skipped — automation engine offline while it is rebuilt',
      {
        workflowSlug: args.workflowSlug,
        taskId: task._id,
        issueNumber,
        repo: repoRef ? `${repoRef.owner}/${repoRef.repo}` : null,
      },
    );
    return null;
  },
});
