/**
 * Task-review shared core: reviewer resolution + the review-gate mint.
 *
 * `requestTaskReview` is the ONE door into the gate, for every way a task can
 * reach `in_review` — a person moving the card (`mutations.updateTaskStatus`),
 * an agent run's settle park (`internal_mutations.agentUpdateTaskStatus`), or an
 * automation. It lives apart from `review_mutations.ts` so the agent status
 * mutation can mint transactionally with its park without an import cycle
 * (mutations → internal_mutations → here; review_mutations → here).
 */

import { isRecord } from '../../lib/utils/type-utils';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { dismissReviewRequestNotifications } from '../collab/dismiss_review_notifications';
import {
  notifyTaskReviewRequested,
  type TaskReviewSubmitter,
} from '../collab/notify_task_reviews';
import { resolveProjectAccessForUser } from '../projects/resolve_project_access';

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
 * a card bounced out of and back into `in_review` while the reviewer has not
 * answered yet does not mint a second request (nor a second bell).
 *
 * A fresh mint SUPERSEDES any older pending review on the task (rejected +
 * `supersededBy`, bells dismissed) — newest submission wins — then notifies the
 * resolved reviewer. When no reviewer resolves, the review is still minted
 * (`requestedFor: null` — board chip + card render) and only the targeted
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
      // No stored question: the card renders its own localized default —
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
