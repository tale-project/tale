/**
 * Task review gate — the human decision point for ANY work parked at
 * `in_review`, agent-driven or human-submitted (the gate is opened by the state
 * itself; see `review_shared.requestTaskReview`).
 *
 * `setTaskReviewer` (public) designates the named human the work waits on
 * (soft designation: notify + queue, not an exclusive ACL).
 *
 * `respondToTaskReview` (public) is the PROGRAMMATIC decision door — no UI
 * mounts it since the sheet's review card was retired (status IS the review:
 * a human leave to `done` approves via
 * `review_shared.closePendingTaskReviewOnStatusLeave`). For workflow-free
 * reviews (the mint in `review_shared.requestTaskReview`) it closes the loop
 * right here: approve completes the task as the responding user;
 * request-changes posts the feedback as a task comment, re-kicks an agent
 * driver with it, and returns the card to `in_progress` so the work is the
 * assignee's again.
 *
 * `createTaskReviewRequest` (internal) is the WORKFLOW-era mint — idempotent
 * by (wfExecutionId, stepSlug, round) because the engine re-executed a paused
 * step after resume. The engine is gone (no callers today); it is kept for
 * the rebuilt automation backend, and its rows keep the record-only respond
 * path (the resume no-op below).
 */

import { ConvexError, v } from 'convex/values';

import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation, mutation } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { dismissReviewRequestNotifications } from '../collab/dismiss_review_notifications';
import {
  autoSubscribe,
  notifyTaskComment,
  notifyTaskStatusChanged,
} from '../collab/notify';
import {
  notifyTaskReviewerAssigned,
  notifyTaskReviewRequested,
  notifyTaskReviewResolved,
} from '../collab/notify_task_reviews';
import { emitEvent } from '../events/emit';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { resolveProjectAccessForUser } from '../projects/resolve_project_access';
import { checkProjectAccess } from './access';
import {
  TASK_AUDIT_ACTIONS,
  TASK_COMMENT_RESOURCE_TYPE,
  TASK_RESOURCE_TYPE,
} from './audit_actions';
import {
  computeEndRank,
  countTaskStateChanged,
  hasOpenChildren,
  recordActivity,
  TASK_COMMENT_MAX,
  TASK_METRIC_ACTIONS,
} from './helpers';
import { postTaskDiscussionMessage } from './internal_mutations';
import {
  approvalRound,
  approvalRunId,
  checkReviewPolicyForResponder,
  collectTaskWatcherIds,
  requestTaskReview,
  resolveReviewer,
  type TaskReviewResponse,
} from './review_shared';

export const TASK_REVIEW_DECISIONS = ['approve', 'request_changes'] as const;
export type TaskReviewDecision = (typeof TASK_REVIEW_DECISIONS)[number];

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

/**
 * Set or clear the task's designated human reviewer. One mutation, one shape:
 * an absent `reviewerUserId` clears (mirrors `assignTask`'s set/unset).
 *
 * Soft designation, NOT an ownership transfer — so unlike an assignee change
 * it is ALLOWED while a run is live (contrast `applyAssigneeChange`'s
 * TASK_HAS_LIVE_RUN gate). The designee must be a human org member holding
 * project `canEdit` (view-only Members see the waiting chips but cannot
 * decide).
 *
 * The designee owns the GATE, so designation does three things: subscribes them
 * to the task (they follow its progress and their own review's outcome),
 * RE-TARGETS any pending request (its `requestedFor` follows the designation,
 * the old reviewer's bells are dismissed — the review row itself is never
 * cancelled by a designation change), and tells them. What they're told depends
 * on whether the work is already waiting: a task at `in_review` makes this a
 * real review request (actionable, emails); anything earlier is a bell-only
 * heads-up, with the request following when the task gets there.
 */
export const setTaskReviewer = mutation({
  args: {
    taskId: v.id('tasks'),
    reviewerUserId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new ConvexError({ code: 'TASK_NOT_FOUND' });
    if (task.archivedAt !== undefined) {
      throw new ConvexError({ code: 'TASK_ARCHIVED' });
    }

    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });
    const member = await getOrganizationMember(
      ctx,
      task.organizationId,
      authUser,
    );
    const project = await ctx.db.get(task.projectId);
    if (!project) throw new ConvexError({ code: 'PROJECT_NOT_FOUND' });
    const teamIds = await getUserTeamIds(ctx, member.userId);
    const access = checkProjectAccess(project, teamIds, member.role);
    if (!access.canEdit) {
      throw new ConvexError({ code: 'TASK_FORBIDDEN' });
    }

    const reviewer = args.reviewerUserId;
    if (reviewer !== undefined) {
      // Human-only + project canEdit: the picker filters to editor roles, but
      // the server is the authority (fails closed on membership-resolve
      // errors, rejects disabled members and view-only Members).
      const designeeAccess = await resolveProjectAccessForUser(
        ctx,
        task.projectId,
        { userId: reviewer, organizationId: task.organizationId },
      );
      if (!designeeAccess.canEdit) {
        throw new ConvexError({ code: 'REVIEWER_NOT_ELIGIBLE' });
      }
    }

    const previous = task.reviewerUserId;
    if ((previous ?? null) === (reviewer ?? null)) return null;

    await ctx.db.patch(task._id, {
      reviewerUserId: reviewer,
      updatedAt: Date.now(),
    });

    await recordActivity(ctx, {
      task,
      actorType: 'user',
      actorId: member.userId,
      action: 'reviewer.changed',
      fromValue: previous,
      toValue: reviewer,
    });

    await createAuditLog(ctx, {
      organizationId: task.organizationId,
      actorId: member.userId,
      actorEmail: authUser.email,
      actorType: 'user',
      action: TASK_AUDIT_ACTIONS.reviewerChanged,
      category: 'data',
      resourceType: TASK_RESOURCE_TYPE,
      resourceId: String(task._id),
      resourceName: task.title,
      previousState: { reviewerUserId: previous ?? null },
      newState: { reviewerUserId: reviewer ?? null },
      status: 'success',
    });

    const updated = await ctx.db.get(task._id);

    // The designee OWNS THE GATE from here on, so they FOLLOW the task —
    // comments, status changes, and the outcome of their own review — instead
    // of hearing from us exactly once. Idempotent, so re-designating is a
    // no-op; a replaced reviewer stays subscribed (they were involved, same as
    // a commenter) and can unwatch.
    if (updated && reviewer !== undefined) {
      await autoSubscribe(ctx, {
        task: updated,
        subscriberType: 'user',
        subscriberId: reviewer,
        reason: 'reviewer',
      });
    }

    // Re-target pending review requests so the queue/bells follow the
    // designation instead of pointing at the old reviewer forever.
    for await (const approval of ctx.db
      .query('approvals')
      .withIndex('by_resource', (q) =>
        q.eq('resourceType', 'task_review').eq('resourceId', String(task._id)),
      )) {
      if (approval.status !== 'pending') continue;
      const metadata = isRecord(approval.metadata) ? approval.metadata : {};
      if (metadata.requestedFor === (reviewer ?? null)) continue;
      await ctx.db.patch(approval._id, {
        metadata: { ...metadata, requestedFor: reviewer ?? null },
      });
      await dismissReviewRequestNotifications(ctx, {
        organizationId: task.organizationId,
        approvalId: approval._id,
        taskId: task._id,
      });
      if (updated && reviewer !== undefined) {
        const agentSlug = metadata.agentSlug;
        await notifyTaskReviewRequested(ctx, {
          task: updated,
          reviewerUserId: reviewer,
          approvalId: approval._id,
          submitter:
            typeof agentSlug === 'string' && agentSlug !== ''
              ? { kind: 'agent', name: agentSlug }
              : { kind: 'user', userId: member.userId },
        });
      }
    }

    if (updated !== null && reviewer !== undefined) {
      if (updated.status === 'in_review') {
        // Designating someone on work that ALREADY waits is itself a request.
        // Idempotent: when a gate is open the loop above has just re-targeted
        // and re-notified it, and this returns that row untouched; it mints
        // only when none is open (a park predating the state-driven gate, or a
        // superseded round).
        await requestTaskReview(ctx, {
          task: updated,
          trigger: { kind: 'human', actorId: member.userId },
        });
      } else {
        // Not due yet — a bell-only heads-up, no email. The actionable request
        // follows when the task reaches in_review.
        await notifyTaskReviewerAssigned(ctx, {
          task: updated,
          reviewerUserId: reviewer,
          actorUserId: member.userId,
        });
      }
    }

    return null;
  },
});

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
        submitter: {
          kind: 'agent',
          ...(args.agentSlug ? { name: args.agentSlug } : {}),
        },
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
      internal.sandbox.session_mutations.hibernateAutomationScopedSession,
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
  returns: v.object({
    taskCompleted: v.boolean(),
    agentKicked: v.boolean(),
    /** Changes requested moved the card back to In progress (the assignee owns
     *  it again). False when an agent kick already did the move. */
    taskReopened: v.boolean(),
  }),
  // Explicit return type: the request-changes branch reaches the kick door
  // through `internal` (this module → mutations → run host), and TS needs one
  // side annotated to break the inference cycle.
  handler: async (
    ctx,
    args,
  ): Promise<{
    taskCompleted: boolean;
    agentKicked: boolean;
    taskReopened: boolean;
  }> => {
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
    // The feedback doubles as a task comment on the workflow-free path.
    if (feedback !== undefined && feedback.length > TASK_COMMENT_MAX) {
      throw new ConvexError({ code: 'TASK_COMMENT_INVALID' });
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

    // The org's `review_policy` governance file tightens WHO may respond
    // (shared with the status-leave close, so no door bypasses it). Refusals
    // follow this mutation's existing convention — a coded ConvexError the
    // caller surfaces as an error toast.
    const policyOutcome = await checkReviewPolicyForResponder(ctx, {
      approval,
      task,
      responderUserId: member.userId,
      now,
    });

    // Nested undefined is not a valid Convex value — only include feedback
    // when present.
    const response: TaskReviewResponse = {
      decision: args.decision,
      respondedBy: member.userId,
      timestamp: now,
      ...(feedback ? { feedback } : {}),
      ...policyOutcome,
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

    const settledRunId = approvalRunId(approval);
    // Join key to the run's provenance-ledger entry (`agent.run_settled`,
    // resourceId = runId): the reviewed run's id, carried from the review's
    // settle-mint metadata (absent on workflow-era rows) — plus the
    // `review_policy` check outcomes, when the policy demanded them.
    const auditMetadata: Record<string, unknown> = {
      ...(settledRunId !== undefined ? { runId: settledRunId } : {}),
      ...policyOutcome,
    };
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
      ...(Object.keys(auditMetadata).length > 0
        ? { metadata: auditMetadata }
        : {}),
      status: 'success',
    });

    // Watchers learn the outcome (reviewer pref-gated, actor excluded).
    await notifyTaskReviewResolved(ctx, {
      task,
      decision: args.decision,
      decidedByUserId: member.userId,
      recipientUserIds: await collectTaskWatcherIds(ctx, taskId),
    });

    let taskCompleted = false;
    let agentKicked = false;
    let taskReopened = false;
    if (approval.wfExecutionId) {
      // Workflow-era rows keep the record-only path. Resuming the paused
      // workflow needed `workflowManagers` and `safeShardIndex`, both removed
      // with the automations/workflow-engine rewrite — the decision is fully
      // recorded above; only the "wake the paused workflow" step is a no-op.
      console.warn(
        '[TaskReview] Workflow resume is offline while the platform AI backend is rewritten; review recorded but the paused workflow was not resumed',
        {
          approvalId: String(args.approvalId),
          wfExecutionId: String(approval.wfExecutionId),
        },
      );
    } else if (args.decision === 'approve') {
      // Workflow-free approve completes the task AS THE RESPONDING USER —
      // the reviewer's gesture is the human "done", exactly like dragging the
      // card (agents can never reach 'done' on their own). Skipped when the
      // task already moved on from in_review.
      const fresh = await ctx.db.get(taskId);
      if (fresh && fresh.status === 'in_review') {
        // Parent-close guard, same as updateTaskStatus. Throwing rolls the
        // whole respond back — the review stays pending and actionable.
        if (await hasOpenChildren(ctx, taskId)) {
          throw new ConvexError({ code: 'TASK_HAS_OPEN_SUBTASKS' });
        }
        const rank = await computeEndRank(ctx, fresh.projectId, 'done');
        await ctx.db.patch(taskId, {
          status: 'done',
          rank,
          completedAt: fresh.completedAt ?? now,
          updatedAt: now,
          statusChangedAt: now,
          // A HUMAN status change resets the agent-run circuit breaker.
          agentRunsPausedAt: undefined,
          agentRunsPausedReason: undefined,
        });
        await countTaskStateChanged(ctx, fresh.projectId, fresh, {
          status: 'done',
          archivedAt: fresh.archivedAt,
        });
        await recordActivity(ctx, {
          task: fresh,
          actorType: 'user',
          actorId: member.userId,
          action: 'status.changed',
          fromValue: fresh.status,
          toValue: 'done',
        });
        await createAuditLog(ctx, {
          organizationId: approval.organizationId,
          actorId: member.userId,
          actorEmail: authUser.email,
          actorType: 'user',
          action: TASK_AUDIT_ACTIONS.statusChanged,
          category: 'data',
          resourceType: TASK_RESOURCE_TYPE,
          resourceId: String(taskId),
          resourceName: fresh.title,
          previousState: { status: fresh.status },
          newState: { status: 'done' },
          status: 'success',
        });
        const done = await ctx.db.get(taskId);
        if (done) {
          await notifyTaskStatusChanged(ctx, {
            task: done,
            fromStatus: fresh.status,
            toStatus: 'done',
            actorType: 'user',
            actorId: member.userId,
          });
          await emitEvent(ctx, {
            organizationId: approval.organizationId,
            eventType: 'task.status_changed',
            eventData: {
              task: done,
              fromStatus: fresh.status,
              toStatus: 'done',
              actorType: 'user',
              actorId: member.userId,
            },
          });
        }
        taskCompleted = true;
      }
    } else if (feedback !== undefined) {
      // Workflow-free request-changes: the feedback becomes a task comment —
      // the visible record teammates (and the agent's discussion tail) see —
      // and re-engages an agent driver with it verbatim (`run.feedback`),
      // mirroring the comment-@mention gesture. A kick refusal (human/app
      // driver, live engine, missing model) leaves the comment as the record.
      const fresh = await ctx.db.get(taskId);
      if (fresh) {
        const { messageId, mentions } = await postTaskDiscussionMessage(ctx, {
          organizationId: approval.organizationId,
          task: fresh,
          project,
          actorType: 'user',
          actorId: member.userId,
          body: feedback,
        });
        await ctx.db.patch(taskId, {
          commentCount: (fresh.commentCount ?? 0) + 1,
        });
        await recordActivity(ctx, {
          task: fresh,
          actorType: 'user',
          actorId: member.userId,
          action: 'comment.added',
        });
        await createAuditLog(ctx, {
          organizationId: approval.organizationId,
          actorId: member.userId,
          actorEmail: authUser.email,
          actorType: 'user',
          action: TASK_AUDIT_ACTIONS.commentCreated,
          category: 'data',
          resourceType: TASK_COMMENT_RESOURCE_TYPE,
          resourceId: messageId,
          resourceName: fresh.title,
          metadata: {
            taskId: String(taskId),
            mentionCount: mentions.length,
          },
          status: 'success',
        });
        await notifyTaskComment(ctx, {
          task: fresh,
          commentId: messageId,
          mentions,
          actorType: 'user',
          actorId: member.userId,
          // Watchers already got `task_review_resolved` for this decision —
          // the feedback comment is the same act, so only newly mentioned
          // humans are pinged here instead of everyone twice.
          notifySubscribers: false,
        });
        await emitEvent(ctx, {
          organizationId: approval.organizationId,
          eventType: 'comment.created',
          eventData: {
            comment: {
              body: feedback,
              projectId: String(fresh.projectId),
              taskId: String(taskId),
              mentions,
            },
            taskId: String(taskId),
            actorType: 'user',
            actorId: member.userId,
          },
        });
        const kick: { started: boolean; reason?: string } =
          await ctx.runMutation(
            internal.tasks.mutations.kickMentionRunAfterSteerMiss,
            { taskId, authorId: member.userId, feedback },
          );
        agentKicked = kick.started;

        // Changes requested hands the work BACK to the assignee, so the card
        // leaves In review — otherwise that column keeps tasks nobody is gated
        // on and the reviewer's decision reads as a no-op on the board. An
        // agent kick already moves it (`kickTaskAgentRun` — the board verb IS
        // the interface), so this covers the human-assignee and kick-refused
        // paths. Re-submitting opens a fresh review round.
        const afterKick = await ctx.db.get(taskId);
        if (afterKick !== null && afterKick.status === 'in_review') {
          const rank = await computeEndRank(
            ctx,
            afterKick.projectId,
            'in_progress',
          );
          await ctx.db.patch(taskId, {
            status: 'in_progress',
            rank,
            statusChangedAt: now,
            updatedAt: now,
            // A HUMAN status change resets the agent-run circuit breaker.
            agentRunsPausedAt: undefined,
            agentRunsPausedReason: undefined,
          });
          await countTaskStateChanged(ctx, afterKick.projectId, afterKick, {
            status: 'in_progress',
            archivedAt: afterKick.archivedAt,
          });
          await recordActivity(ctx, {
            task: afterKick,
            actorType: 'user',
            actorId: member.userId,
            action: 'status.changed',
            fromValue: afterKick.status,
            toValue: 'in_progress',
          });
          await createAuditLog(ctx, {
            organizationId: approval.organizationId,
            actorId: member.userId,
            actorEmail: authUser.email,
            actorType: 'user',
            action: TASK_AUDIT_ACTIONS.statusChanged,
            category: 'data',
            resourceType: TASK_RESOURCE_TYPE,
            resourceId: String(taskId),
            resourceName: afterKick.title,
            previousState: { status: afterKick.status },
            newState: { status: 'in_progress' },
            status: 'success',
          });
          const reopened = await ctx.db.get(taskId);
          if (reopened) {
            // Deliberately NO status bell: `task_review_resolved` above already
            // told the watchers what happened, and this move is its
            // consequence, not a second event. Automations still see it.
            await emitEvent(ctx, {
              organizationId: approval.organizationId,
              eventType: 'task.status_changed',
              eventData: {
                task: reopened,
                fromStatus: afterKick.status,
                toStatus: 'in_progress',
                actorType: 'user',
                actorId: member.userId,
              },
            });
          }
          taskReopened = true;
        }
      }
    }

    return { taskCompleted, agentKicked, taskReopened };
  },
});
