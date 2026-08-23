/**
 * Task-review shared core: reviewer resolution, the review-gate mint, and the
 * gate's close-on-leave.
 *
 * `requestTaskReview` is the ONE door into the gate, for every way a task can
 * reach `in_review` — a person moving the card (`mutations.updateTaskStatus`,
 * `moveTask`, `bulkUpdateTasks`), an agent run's settle park
 * (`internal_mutations.agentUpdateTaskStatus`), or an automation.
 * `closePendingTaskReviewOnStatusLeave` is the matching exit: every way a task
 * can LEAVE `in_review` closes the gate again, so a decided/mooted review never
 * lingers as a bell or a Needs-my-review row. Both live apart from
 * `review_mutations.ts` so the agent status mutation can mint/close
 * transactionally with its transition without an import cycle
 * (mutations → internal_mutations → here; review_mutations → here).
 */

import { ConvexError } from 'convex/values';

import { isRecord } from '../../lib/utils/type-utils';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { dismissReviewRequestNotifications } from '../collab/dismiss_review_notifications';
import {
  notifyTaskReviewRequested,
  notifyTaskReviewResolved,
  type TaskReviewSubmitter,
} from '../collab/notify_task_reviews';
import { holdsAllCompetences } from '../governance/competence';
import { readReviewPolicy } from '../governance/review_policy';
import { resolveProjectAccessForUser } from '../projects/resolve_project_access';
import { recordActivity, TASK_METRIC_ACTIONS } from './helpers';

/** The review round an approval was minted for; rows predating the round key
 * (or with malformed metadata) read as round 0. Exported for unit tests. */
export function approvalRound(
  approval: Pick<Doc<'approvals'>, 'metadata'>,
): number {
  const metadata: unknown = approval.metadata;
  if (!isRecord(metadata)) return 0;
  return typeof metadata.round === 'number' ? metadata.round : 0;
}

/** The agent run a workflow-free review was minted for (settle mints key
 * their idempotency on this); absent on workflow-era rows. */
export function approvalRunId(
  approval: Pick<Doc<'approvals'>, 'metadata'>,
): string | undefined {
  const metadata: unknown = approval.metadata;
  if (!isRecord(metadata)) return undefined;
  return typeof metadata.runId === 'string' ? metadata.runId : undefined;
}

/**
 * Resolve who should review a task parked at `in_review`. Revalidated at
 * every call (mint/read time) so a designee who lost project access falls
 * through the chain instead of silently swallowing review requests:
 * explicit `reviewerUserId` → human task creator → project creator — the
 * first candidate who still holds project `canEdit` wins; else undefined.
 * The durable field stores EXPLICIT designation only; this chain IS the
 * default logic, evaluated at need and never persisted (a stale designation
 * is left in place — lazy cleanup, no membership hooks).
 */
export async function resolveReviewer(
  ctx: MutationCtx,
  task: Doc<'tasks'>,
): Promise<string | undefined> {
  const project = await ctx.db.get(task.projectId);
  const candidates = [
    task.reviewerUserId,
    task.createdByType === 'user' ? task.createdBy : undefined,
    project?.createdBy,
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (candidate === undefined || seen.has(candidate)) continue;
    seen.add(candidate);
    const access = await resolveProjectAccessForUser(ctx, task.projectId, {
      userId: candidate,
      organizationId: task.organizationId,
    });
    if (access.canEdit) return candidate;
  }
  return undefined;
}

/**
 * The driver's display name for review copy: the project agent's name, or the
 * owning automation's store name. Undefined for human/unassigned drivers.
 */
async function resolveDriverDisplayName(
  ctx: MutationCtx,
  task: Doc<'tasks'>,
): Promise<string | undefined> {
  if (task.assigneeId === undefined) return undefined;
  if (task.assigneeType === 'agent') {
    const agentId = ctx.db.normalizeId('projectAgents', task.assigneeId);
    if (agentId === null) return undefined;
    const agent = await ctx.db.get(agentId);
    return agent?.name;
  }
  if (task.assigneeType === 'app') return task.assigneeId;
  return undefined;
}

/**
 * What put the task in front of a reviewer. The gate belongs to the STATE, not
 * to the worker: an agent run's settle park, a person moving the card, and an
 * automation all open the same gate — the trigger only decides the idempotency
 * key and whose name the request copy carries.
 */
export type TaskReviewTrigger =
  | { kind: 'agent_run'; runId: Id<'projectAgentRuns'> }
  | { kind: 'human'; actorId: string }
  | { kind: 'automation'; slug?: string };

/**
 * Open the review gate on a task that just reached `in_review`. MUST run in the
 * same transaction as the status flip: the agent settle action's burned-claim
 * fallback can replay the sequence, and the find-or-insert below is what keeps
 * two racers from minting twice.
 *
 * Idempotency depends on the trigger. An agent run keys on its `runId`, so a
 * replayed settle returns the existing row; a human/automation submission keys
 * on "is a review already pending for this task" — one open gate per task, so
 * a re-designation or re-submission on a task SITTING at `in_review` does not
 * mint a second request (nor a second bell). A leave from `in_review` closes
 * the gate (`closePendingTaskReviewOnStatusLeave` below), so a bounce out and
 * back in withdraws the old request and mints a fresh one.
 *
 * A fresh mint SUPERSEDES any older pending review on the task (rejected +
 * `supersededBy`, bells dismissed) — newest submission wins — then notifies the
 * resolved reviewer. When no reviewer resolves, the review is still minted
 * (`requestedFor: null` — the board chip renders) and only the targeted
 * request notification is skipped; watchers already get the generic
 * status-change bell from the transition itself.
 */
export async function requestTaskReview(
  ctx: MutationCtx,
  args: { task: Doc<'tasks'>; trigger: TaskReviewTrigger },
): Promise<{ approvalId: Id<'approvals'>; minted: boolean }> {
  const { task, trigger } = args;
  const runKey =
    trigger.kind === 'agent_run' ? String(trigger.runId) : undefined;

  const prior: Doc<'approvals'>[] = [];
  for await (const approval of ctx.db
    .query('approvals')
    .withIndex('by_resource', (q) =>
      q.eq('resourceType', 'task_review').eq('resourceId', String(task._id)),
    )) {
    prior.push(approval);
  }
  const existing =
    runKey === undefined
      ? prior.find((approval) => approval.status === 'pending')
      : prior.find((approval) => approvalRunId(approval) === runKey);
  if (existing) {
    return { approvalId: existing._id, minted: false };
  }

  const reviewer = await resolveReviewer(ctx, task);
  const driverName = await resolveDriverDisplayName(ctx, task);
  const approvalId = await ctx.db.insert('approvals', {
    organizationId: task.organizationId,
    resourceType: 'task_review',
    resourceId: String(task._id),
    priority: 'high',
    status: 'pending',
    metadata: {
      taskId: String(task._id),
      projectId: String(task.projectId),
      agentSlug: driverName ?? null,
      requestedFor: reviewer ?? null,
      round: prior.length,
      // No stored question: readers render their own localized copy —
      // persisting an English sentence here would ship untranslated.
      question: null,
      ...(runKey !== undefined ? { runId: runKey } : {}),
    },
  });

  const now = Date.now();
  for (const stale of prior) {
    if (stale.status !== 'pending') continue;
    await ctx.db.patch(stale._id, {
      status: 'rejected',
      reviewedAt: now,
      metadata: {
        ...(isRecord(stale.metadata) ? stale.metadata : {}),
        supersededBy: approvalId,
      },
    });
    await dismissReviewRequestNotifications(ctx, {
      organizationId: task.organizationId,
      approvalId: stale._id,
      taskId: task._id,
    });
  }

  if (reviewer !== undefined) {
    await notifyTaskReviewRequested(ctx, {
      task,
      reviewerUserId: reviewer,
      approvalId,
      submitter: reviewSubmitter(trigger, driverName),
    });
  }

  return { approvalId, minted: true };
}

/**
 * Whose name the request copy carries. An agent-driven task names its driver
 * even when a human moved the card (the work was the agent's); a human
 * submission on a human/unassigned task names the person who submitted it.
 */
function reviewSubmitter(
  trigger: TaskReviewTrigger,
  driverName: string | undefined,
): TaskReviewSubmitter {
  if (trigger.kind === 'human' && driverName === undefined) {
    return { kind: 'user', userId: trigger.actorId };
  }
  return {
    kind: 'agent',
    ...(driverName !== undefined ? { name: driverName } : {}),
  };
}

/** The recorded decision on a `task_review` approval (`metadata.response`),
 * written by `respondToTaskReview` and the leave-to-done close below. */
export interface TaskReviewResponse {
  decision: 'approve' | 'request_changes';
  feedback?: string;
  respondedBy: string;
  timestamp: number;
  /** Check outcomes of the org's `review_policy`, recorded only when the
   * policy demanded them (absent policy ⇒ absent fields — today's shape). */
  independentReviewer?: boolean;
  competences?: {
    required: string[];
    heldRecordIds: string[];
    checkedAt: number;
  };
}

export const REVIEW_POLICY_REFUSAL_CODES = [
  'REVIEW_INDEPENDENT_REVIEWER_REQUIRED',
  'REVIEW_COMPETENCE_REQUIRED',
] as const;

/** Whether a throw is one of the `review_policy` refusals — batch callers
 * (`bulkUpdateTasks`) skip the task instead of aborting the whole batch. */
export function isReviewPolicyRefusal(error: unknown): boolean {
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  if (!isRecord(data) || typeof data.code !== 'string') return false;
  return (REVIEW_POLICY_REFUSAL_CODES as readonly string[]).includes(data.code);
}

/**
 * The org `review_policy` gate on WHO may decide a review — shared between
 * `respondToTaskReview` and the leave-to-done close, so the status picker and
 * the board drag cannot decide what the respond door would refuse. Pure check:
 * throws a coded ConvexError on refusal, writes nothing, and returns the
 * outcomes to stamp on the recorded response. Absent (or malformed — logged
 * and treated as absent) policy means exactly the open behaviour: any project
 * editor.
 */
export async function checkReviewPolicyForResponder(
  ctx: MutationCtx,
  args: {
    approval: Doc<'approvals'>;
    task: Doc<'tasks'>;
    responderUserId: string;
    now: number;
  },
): Promise<Pick<TaskReviewResponse, 'independentReviewer' | 'competences'>> {
  const { approval, task, responderUserId, now } = args;
  const reviewPolicy = await readReviewPolicy(ctx.db, task.organizationId);
  let independentReviewer: boolean | undefined;
  let competences: TaskReviewResponse['competences'];
  if (reviewPolicy?.requireIndependentReviewer === true) {
    const settledRunKey = approvalRunId(approval);
    const runId =
      settledRunKey === undefined
        ? null
        : ctx.db.normalizeId('projectAgentRuns', settledRunKey);
    const run = runId === null ? null : await ctx.db.get(runId);
    if (run !== null && run.taskId === task._id) {
      // The reviewed run's driver is the human who kicked it
      // (`projectAgentRuns.startedBy` — every task-lane trigger is a
      // person's act). Independence = the responder is someone else.
      if (run.startedBy === responderUserId) {
        throw new ConvexError({
          code: 'REVIEW_INDEPENDENT_REVIEWER_REQUIRED',
          message:
            'This organization requires an independent reviewer: the person who started the run cannot approve its work.',
        });
      }
    } else if (task.createdBy === responderUserId) {
      // Review rows without run linkage (human/automation mints, workflow-era
      // rows, or a key that no longer resolves to a projectAgentRuns row)
      // cannot recover the driver. Conservatively require the responder to
      // differ from the task's creator — the closest proxy for the person
      // whose work is under review.
      throw new ConvexError({
        code: 'REVIEW_INDEPENDENT_REVIEWER_REQUIRED',
        message:
          "This organization requires an independent reviewer: the reviewed run's driver could not be resolved, so the task creator cannot respond.",
      });
    }
    independentReviewer = true;
  }
  const requiredCompetences = reviewPolicy?.requiredCompetences ?? [];
  if (requiredCompetences.length > 0) {
    const held = await holdsAllCompetences(
      ctx,
      task.organizationId,
      responderUserId,
      requiredCompetences,
    );
    if (!held.holdsAll) {
      throw new ConvexError({
        code: 'REVIEW_COMPETENCE_REQUIRED',
        message: `Responding to this review requires the competence(s): ${held.missing.join(', ')}. Ask an org admin to grant them.`,
        missing: held.missing,
      });
    }
    competences = {
      required: [...requiredCompetences],
      heldRecordIds: held.heldRecordIds,
      checkedAt: now,
    };
  }
  return {
    ...(independentReviewer !== undefined ? { independentReviewer } : {}),
    ...(competences !== undefined ? { competences } : {}),
  };
}

/** Unmuted human watchers of a task — the audience for a review outcome. */
export async function collectTaskWatcherIds(
  ctx: MutationCtx,
  taskId: Id<'tasks'>,
): Promise<string[]> {
  const watcherIds = new Set<string>();
  for await (const sub of ctx.db
    .query('taskSubscriptions')
    .withIndex('by_task', (q) => q.eq('taskId', taskId))) {
    if (sub.subscriberType === 'user' && !sub.muted) {
      watcherIds.add(sub.subscriberId);
    }
  }
  return [...watcherIds];
}

/** Who moved the task out of `in_review`. A person's leave to `done` IS the
 * approve; every other leave — any target for a system actor (an agent's
 * `task_update_status`, an automation's transition, an external-sync close) —
 * withdraws the request: no human decided, so no decision is recorded and the
 * `review_policy` gate does not apply (it would wedge the non-human lane). */
export type TaskReviewLeaveActor =
  | { kind: 'user'; userId: string; email?: string }
  | { kind: 'system'; actorId: string };

/**
 * Close the review gate when a task leaves `in_review`. MUST run in the same
 * transaction as the status write, from EVERY path that can move a task out of
 * `in_review` — otherwise the pending approval keeps ringing bells and holding
 * the Needs-my-review facet for work nobody is gated on any more.
 *
 * Self-guarding no-op unless the transition actually leaves `in_review` or the
 * task holds a pending workflow-free review. Workflow-era rows (with a
 * `wfExecutionId`) are left untouched: they belong to a paused execution's own
 * request/respond protocol, not to the board state.
 *
 * A human leave to `done` records the SAME approve as `respondToTaskReview`
 * (policy check, response metadata, `task.review_responded` audit, resolved
 * notification, bell dismissal) — minus the status write, which is the
 * caller's. Every other leave marks the row rejected with a `withdrawn`
 * marker and dismisses the bells; the status change itself is the record.
 *
 * Ordering contract: ALL validation (the `review_policy` check) happens before
 * ANY write, so a batch caller may catch `isReviewPolicyRefusal` errors and
 * skip the task knowing nothing was half-written.
 */
export async function closePendingTaskReviewOnStatusLeave(
  ctx: MutationCtx,
  args: {
    /** The task as loaded BEFORE the status write (status still `in_review`). */
    task: Doc<'tasks'>;
    toStatus: Doc<'tasks'>['status'];
    actor: TaskReviewLeaveActor;
  },
): Promise<void> {
  const { task, toStatus, actor } = args;
  if (task.status !== 'in_review' || toStatus === 'in_review') return;

  const pending: Doc<'approvals'>[] = [];
  for await (const approval of ctx.db
    .query('approvals')
    .withIndex('by_resource', (q) =>
      q.eq('resourceType', 'task_review').eq('resourceId', String(task._id)),
    )) {
    if (approval.status !== 'pending') continue;
    if (approval.wfExecutionId !== undefined) continue;
    pending.push(approval);
  }
  if (pending.length === 0) return;

  const now = Date.now();
  const approves = actor.kind === 'user' && toStatus === 'done';

  if (approves) {
    // Validate every row before writing anything (see the ordering contract).
    const outcomes = new Map<
      Id<'approvals'>,
      Pick<TaskReviewResponse, 'independentReviewer' | 'competences'>
    >();
    for (const approval of pending) {
      outcomes.set(
        approval._id,
        await checkReviewPolicyForResponder(ctx, {
          approval,
          task,
          responderUserId: actor.userId,
          now,
        }),
      );
    }

    for (const approval of pending) {
      const outcome = outcomes.get(approval._id) ?? {};
      const response: TaskReviewResponse = {
        decision: 'approve',
        respondedBy: actor.userId,
        timestamp: now,
        ...outcome,
      };
      const metadata = isRecord(approval.metadata) ? approval.metadata : {};
      await ctx.db.patch(approval._id, {
        status: 'completed',
        approvedBy: actor.userId,
        reviewedAt: now,
        metadata: { ...metadata, response },
      });
      await dismissReviewRequestNotifications(ctx, {
        organizationId: task.organizationId,
        approvalId: approval._id,
        taskId: task._id,
      });
      const settledRunId = approvalRunId(approval);
      const auditMetadata: Record<string, unknown> = {
        ...(settledRunId !== undefined ? { runId: settledRunId } : {}),
        ...outcome,
      };
      await createAuditLog(ctx, {
        organizationId: task.organizationId,
        actorId: actor.userId,
        actorEmail: actor.email,
        actorType: 'user',
        action: 'task.review_responded',
        category: 'data',
        resourceType: 'task',
        resourceId: String(task._id),
        resourceName: task.title,
        newState: { decision: 'approve' },
        ...(Object.keys(auditMetadata).length > 0
          ? { metadata: auditMetadata }
          : {}),
        status: 'success',
      });
    }

    // One metric and one watcher notification per gesture, however many rows
    // the degenerate multi-pending case held.
    await recordActivity(ctx, {
      task,
      actorType: 'user',
      actorId: actor.userId,
      action: TASK_METRIC_ACTIONS.reviewPassed,
    });
    await notifyTaskReviewResolved(ctx, {
      task,
      decision: 'approve',
      decidedByUserId: actor.userId,
      recipientUserIds: await collectTaskWatcherIds(ctx, task._id),
    });
    return;
  }

  for (const approval of pending) {
    const metadata = isRecord(approval.metadata) ? approval.metadata : {};
    await ctx.db.patch(approval._id, {
      status: 'rejected',
      reviewedAt: now,
      metadata: {
        ...metadata,
        withdrawn: {
          toStatus,
          by: actor.kind === 'user' ? actor.userId : actor.actorId,
          at: now,
        },
      },
    });
    await dismissReviewRequestNotifications(ctx, {
      organizationId: task.organizationId,
      approvalId: approval._id,
      taskId: task._id,
    });
  }
}
