/**
 * Task review gate — the human decision point of the task-ops pack.
 *
 * `createTaskReviewRequest` (internal) is called by the workflow
 * `approval.request_review` action. IDEMPOTENT by (wfExecutionId, stepSlug):
 * the engine RE-EXECUTES a paused step after `awaitEvent` resumes it, so the
 * second execution must find the responded approval and return its decision
 * instead of minting a duplicate request.
 *
 * `respondToTaskReview` (public) is the human side — Approve / Request
 * changes from the task sheet or the inbox. It mirrors the human-input
 * respond fork exactly: patch the approval, then `sendEvent` the paused
 * workflow awake.
 */

import { ConvexError, v } from 'convex/values';

import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { dismissReviewRequestNotifications } from '../collab/dismiss_review_notifications';
import {
  notifyTaskReviewRequested,
  notifyTaskReviewResolved,
} from '../collab/notify_task_reviews';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { checkProjectAccess } from './access';
import { recordActivity, TASK_METRIC_ACTIONS } from './helpers';

export const TASK_REVIEW_DECISIONS = ['approve', 'request_changes'] as const;
export type TaskReviewDecision = (typeof TASK_REVIEW_DECISIONS)[number];

interface TaskReviewResponse {
  decision: TaskReviewDecision;
  feedback?: string;
  respondedBy: string;
  timestamp: number;
}

function readResponse(
  approval: Doc<'approvals'>,
): TaskReviewResponse | undefined {
  const metadata: unknown = approval.metadata;
  if (!isRecord(metadata)) return undefined;
  const response = metadata.response;
  if (!isRecord(response)) return undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape written exclusively by respondToTaskReview below
  return response as unknown as TaskReviewResponse;
}

/** The review round an approval was minted for; rows predating the round key
 * (or with malformed metadata) read as round 0. Exported for unit tests. */
export function approvalRound(
  approval: Pick<Doc<'approvals'>, 'metadata'>,
): number {
  const metadata: unknown = approval.metadata;
  if (!isRecord(metadata)) return 0;
  return typeof metadata.round === 'number' ? metadata.round : 0;
}

/**
 * Resolve who should review: the task creator when human, else the project
 * creator (agent- and app-created tasks must still land on a human desk).
 */
async function resolveReviewer(
  ctx: MutationCtx,
  task: Doc<'tasks'>,
): Promise<string | undefined> {
  if (task.createdByType === 'user') return task.createdBy;
  const project = await ctx.db.get(task.projectId);
  return project?.createdBy;
}

export const createTaskReviewRequest = internalMutation({
  args: {
    organizationId: v.string(),
    taskId: v.id('tasks'),
    wfExecutionId: v.id('wfExecutions'),
    stepSlug: v.string(),
    /** Review ROUND, folded into the idempotency key. A workflow that loops
     *  back to the SAME gate step (replan → still ambiguous) passes a bumped
     *  round to mint a FRESH request — without it the recorded round-0
     *  decision would replay forever, so v1 duplicated the whole step per
     *  round. Absent ⇒ 0 (backward compatible with pre-round approvals). */
    round: v.optional(v.number()),
    question: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
  },
  returns: v.object({
    approvalId: v.optional(v.id('approvals')),
    pending: v.boolean(),
    responded: v.boolean(),
    decision: v.optional(v.string()),
    feedback: v.optional(v.string()),
    respondedBy: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.organizationId !== args.organizationId) {
      throw new ConvexError({ code: 'TASK_NOT_FOUND' });
    }

    // Idempotency: one approval per (execution, step, round). Resume
    // re-executes the step; finding the responded row IS the resume payload.
    // A loop that re-enters the gate bumps `round` for a fresh request.
    const round = args.round ?? 0;
    for await (const approval of ctx.db
      .query('approvals')
      .withIndex('by_resource', (q) =>
        q
          .eq('resourceType', 'task_review')
          .eq('resourceId', String(args.taskId)),
      )) {
      if (
        approval.wfExecutionId !== args.wfExecutionId ||
        approval.stepSlug !== args.stepSlug ||
        approvalRound(approval) !== round
      ) {
        continue;
      }
      if (approval.status === 'pending') {
        return { approvalId: approval._id, pending: true, responded: false };
      }
      const response = readResponse(approval);
      return {
        approvalId: approval._id,
        pending: false,
        responded: true,
        decision: response?.decision,
        feedback: response?.feedback,
        respondedBy: response?.respondedBy,
      };
    }

    const reviewer = await resolveReviewer(ctx, task);
    const approvalId = await ctx.db.insert('approvals', {
      organizationId: args.organizationId,
      resourceType: 'task_review',
      resourceId: String(args.taskId),
      priority: 'high',
      status: 'pending',
      wfExecutionId: args.wfExecutionId,
      stepSlug: args.stepSlug,
      metadata: {
        taskId: String(args.taskId),
        projectId: String(task.projectId),
        agentSlug: args.agentSlug ?? null,
        requestedFor: reviewer ?? null,
        round,
        question:
          args.question ?? `Agent work on "${task.title}" is ready for review.`,
      },
    });

    if (reviewer) {
      await notifyTaskReviewRequested(ctx, {
        task,
        reviewerUserId: reviewer,
        approvalId,
        agentSlug: args.agentSlug,
      });
    }

    // A FRESH review request means the execution is about to pause on a human
    // — hibernate its workflow-scoped sandbox (if any) so the paused run frees
    // its per-org workflow session slot instead of pinning capacity for the
    // whole wait; the resume path re-admits and re-creates in place. Scheduled
    // (not inline) so it fires only when this request commits; runs only on
    // the insert path — the responded-replay path above never pauses.
    await ctx.scheduler.runAfter(
      0,
      internal.sandbox.session_mutations.hibernateWorkflowScopedSession,
      { executionId: String(args.wfExecutionId) },
    );

    return { approvalId, pending: true, responded: false };
  },
});

export const respondToTaskReview = mutation({
  args: {
    approvalId: v.id('approvals'),
    decision: v.union(v.literal('approve'), v.literal('request_changes')),
    feedback: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval || approval.resourceType !== 'task_review') {
      throw new ConvexError({ code: 'REVIEW_NOT_FOUND' });
    }
    if (approval.status !== 'pending') {
      throw new ConvexError({ code: 'REVIEW_ALREADY_RESOLVED' });
    }
    const feedback = args.feedback?.trim() || undefined;
    if (args.decision === 'request_changes' && !feedback) {
      throw new ConvexError({ code: 'REVIEW_FEEDBACK_REQUIRED' });
    }

    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });
    const member = await getOrganizationMember(
      ctx,
      approval.organizationId,
      authUser,
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- task_review approvals store String(taskId) as resourceId
    const taskId = approval.resourceId as Id<'tasks'>;
    const task = await ctx.db.get(taskId);
    if (!task || task.organizationId !== approval.organizationId) {
      throw new ConvexError({ code: 'TASK_NOT_FOUND' });
    }
    const project = await ctx.db.get(task.projectId);
    if (!project) throw new ConvexError({ code: 'PROJECT_NOT_FOUND' });
    const teamIds = await getUserTeamIds(ctx, member.userId);
    const access = checkProjectAccess(project, teamIds, member.role);
    if (!access.canEdit) {
      throw new ConvexError({ code: 'TASK_FORBIDDEN' });
    }

    const now = Date.now();
    // Nested undefined is not a valid Convex value — only include feedback
    // when present.
    const response: TaskReviewResponse = {
      decision: args.decision,
      respondedBy: member.userId,
      timestamp: now,
      ...(feedback ? { feedback } : {}),
    };
    const existingMetadata: unknown = approval.metadata;
    const metadata = isRecord(existingMetadata) ? existingMetadata : {};
    await ctx.db.patch(args.approvalId, {
      status: 'completed',
      approvedBy: member.userId,
      reviewedAt: now,
      metadata: { ...metadata, response },
    });

    await dismissReviewRequestNotifications(ctx, {
      organizationId: approval.organizationId,
      approvalId: args.approvalId,
      taskId,
    });

    await recordActivity(ctx, {
      task,
      actorType: 'user',
      actorId: member.userId,
      action:
        args.decision === 'approve'
          ? TASK_METRIC_ACTIONS.reviewPassed
          : TASK_METRIC_ACTIONS.reviewChangesRequested,
      toValue: feedback,
    });

    await createAuditLog(ctx, {
      organizationId: approval.organizationId,
      actorId: member.userId,
      actorEmail: authUser.email,
      actorType: 'user',
      action: 'task.review_responded',
      category: 'data',
      resourceType: 'task',
      resourceId: String(taskId),
      resourceName: task.title,
      newState: { decision: args.decision },
      status: 'success',
    });

    // Watchers learn the outcome (reviewer pref-gated, actor excluded).
    const watcherIds: string[] = [];
    for await (const sub of ctx.db
      .query('taskSubscriptions')
      .withIndex('by_task', (q) => q.eq('taskId', taskId))) {
      if (sub.subscriberType === 'user' && !sub.muted) {
        watcherIds.push(sub.subscriberId);
      }
    }
    await notifyTaskReviewResolved(ctx, {
      task,
      decision: args.decision,
      decidedByUserId: member.userId,
      recipientUserIds: [...new Set(watcherIds)],
    });

    // Resuming the paused workflow needed `workflowManagers`
    // (`convex/workflow_engine/engine.ts`) and `safeShardIndex`
    // (`convex/workflow_engine/helpers/engine/shard.ts`), both moved with the
    // automations/workflow-engine rewrite. The review decision itself is
    // fully recorded above (approval patched, activity logged, audit logged,
    // watchers notified) — only the "wake the paused workflow back up" step
    // is a no-op now, since there is no workflow engine left to send the
    // event to.
    if (approval.wfExecutionId) {
      console.warn(
        '[TaskReview] Workflow resume is offline while the platform AI backend is rewritten; review recorded but the paused workflow was not resumed',
        {
          approvalId: String(args.approvalId),
          wfExecutionId: String(approval.wfExecutionId),
        },
      );
    }

    return null;
  },
});
