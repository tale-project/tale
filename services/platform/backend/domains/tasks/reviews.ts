import type { Sql, TransactionSql } from 'postgres';

import {
  getUserTeamIds,
  findOrganizationMember,
} from '../../auth/membership.ts';
import { checkProjectAccess } from '../../core/projects/access.ts';
import { toJson } from '../../db/sql.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  autoSubscribe,
  dismissReviewRequestNotifications,
  notifyTaskReviewRequested,
  notifyTaskReviewResolved,
  taskSubscriberUserIds,
} from '../collab/service.ts';
import { emitEvent } from '../events/emit.ts';
import { holdsAllCompetences } from '../governance/competence.ts';
import { type ProjectAuthContext } from '../projects/service.ts';
import { kickAgentRun } from './agent-runs.ts';
import { addTaskComment } from './comments.ts';
import {
  applyTaskCountTransition,
  computeEndRank,
  hasOpenChildren,
  loadTaskOrThrow,
  recordActivity,
  taskCountBucket,
  TaskError,
  type TaskRow,
} from './service.ts';

/**
 * The task review gate over PG — the 0.4 Driver/Reviewer arc
 * (`tasks/review_shared.ts` + `tasks/review_mutations.ts`) on `app.approvals`:
 * an agent settle's park to `in_review` mints one workflow-free review row in
 * the SAME transaction as the status flip (find-or-insert by runId, so the
 * settle's burned-claim replay never double-mints); every leave from
 * `in_review` closes the gate (a human's leave to done IS the approve, any
 * other leave withdraws); a reviewer's respond completes the row and either
 * finishes the task AS THE RESPONDER or hands the feedback back to the
 * driver as a comment + re-kick. The org's `review_policy` governance file
 * tightens who may respond, shared by every door.
 *
 * Deliberately deferred with their own domains: the reviewer BELL fan-out
 * (0.4 `userNotifications` — the collab notifications port) and competence
 * records (`holdsAllCompetences` — a policy requiring competences refuses
 * fail-closed until that domain lands).
 */

export class TaskReviewError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;
  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'TaskReviewError';
    this.code = code;
    this.status = status;
  }
}

export interface ApprovalRow {
  id: string;
  organizationId: string;
  status: 'pending' | 'completed' | 'rejected';
  wfExecutionId: string | null;
  approvedBy: string | null;
  reviewedAt: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

const APPROVAL_COLUMNS = `
  id, org_id AS "organizationId", status,
  wf_execution_id AS "wfExecutionId", approved_by AS "approvedBy",
  reviewed_at_ms::float8 AS "reviewedAt", metadata,
  created_at_ms::float8 AS "createdAt"
`;

export function approvalRunId(
  approval: Pick<ApprovalRow, 'metadata'>,
): string | undefined {
  const runId = approval.metadata?.runId;
  return typeof runId === 'string' ? runId : undefined;
}

async function listTaskReviewApprovals(
  tx: TransactionSql | Sql,
  taskId: string,
): Promise<ApprovalRow[]> {
  return tx<ApprovalRow[]>`
    SELECT ${tx.unsafe(APPROVAL_COLUMNS)} FROM app.approvals
    WHERE resource_type = 'task_review' AND resource_id = ${taskId}
    ORDER BY seq DESC
  `;
}

/**
 * Who should review a task parked at `in_review` — revalidated at every
 * call so a designee who lost project access falls through the chain:
 * explicit `reviewerUserId` → human task creator → project creator; the
 * first candidate who still holds project canEdit wins.
 */
export async function resolveReviewer(
  tx: TransactionSql | Sql,
  task: TaskRow,
): Promise<string | undefined> {
  const projects = await tx<
    {
      createdBy: string;
      teamId: string | null;
      sharedWithTeamIds: string[];
    }[]
  >`
    SELECT created_by AS "createdBy", team_id AS "teamId",
           shared_with_team_ids AS "sharedWithTeamIds"
    FROM app.projects WHERE id = ${task.projectId} LIMIT 1
  `;
  const project = projects[0];
  const candidates = [
    task.reviewerUserId ?? undefined,
    task.createdByType === 'user' ? task.createdBy : undefined,
    project?.createdBy,
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (candidate === undefined || seen.has(candidate)) continue;
    seen.add(candidate);
    const member = await findOrganizationMember(
      tx,
      task.organizationId,
      candidate,
    );
    if (member === null || member.role === 'disabled') continue;
    const teamIds = await getUserTeamIds(tx, candidate);
    const access = checkProjectAccess(
      {
        teamId: project?.teamId ?? null,
        sharedWithTeamIds: project?.sharedWithTeamIds ?? [],
      },
      teamIds,
      member.role,
    );
    if (access.canEdit) return candidate;
  }
  return undefined;
}

/** The driver's display name for review copy (project agent name). */
async function resolveDriverDisplayName(
  tx: TransactionSql | Sql,
  task: TaskRow,
): Promise<string | undefined> {
  if (task.assigneeId === null || task.assigneeType !== 'agent') {
    return task.assigneeType === 'app'
      ? (task.assigneeId ?? undefined)
      : undefined;
  }
  const agents = await tx<{ name: string }[]>`
    SELECT name FROM app.project_agents WHERE id = ${task.assigneeId} LIMIT 1
  `;
  return agents[0]?.name;
}

export type TaskReviewTrigger =
  | { kind: 'agent_run'; runId: string }
  | { kind: 'human'; actorId: string }
  | { kind: 'automation'; slug?: string };

/**
 * Open the review gate on a task that just reached `in_review`. MUST run in
 * the same transaction as the status flip. Idempotency by trigger: an agent
 * run keys on its runId (a replayed settle finds its row); a human or
 * automation keys on "a review is already pending for this task". A fresh
 * mint supersedes stale pending rows (rejected + `supersededBy`).
 */
export async function requestTaskReview(
  tx: TransactionSql,
  args: { task: TaskRow; trigger: TaskReviewTrigger },
): Promise<{ approvalId: string; minted: boolean }> {
  const { task, trigger } = args;
  const runKey = trigger.kind === 'agent_run' ? trigger.runId : undefined;
  const prior = await listTaskReviewApprovals(tx, task.id);
  const existing =
    runKey === undefined
      ? prior.find((approval) => approval.status === 'pending')
      : prior.find((approval) => approvalRunId(approval) === runKey);
  if (existing) {
    return { approvalId: existing.id, minted: false };
  }

  const reviewer = await resolveReviewer(tx, task);
  const driverName = await resolveDriverDisplayName(tx, task);
  const metadata = {
    taskId: task.id,
    projectId: task.projectId,
    agentSlug: driverName ?? null,
    requestedFor: reviewer ?? null,
    round: prior.length,
    // No stored question: readers render their own localized copy.
    question: null,
    ...(runKey !== undefined ? { runId: runKey } : {}),
  };
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.approvals (
      org_id, resource_type, resource_id, priority, status, metadata,
      created_at_ms
    ) VALUES (
      ${task.organizationId}, 'task_review', ${task.id}, 'high', 'pending',
      ${tx.json(toJson(metadata))}, ${Date.now()}
    ) RETURNING id
  `;
  const approvalId = inserted[0]?.id ?? '';
  const now = Date.now();
  for (const stale of prior) {
    if (stale.status !== 'pending') continue;
    await tx`
      UPDATE app.approvals SET
        status = 'rejected', reviewed_at_ms = ${now},
        metadata = coalesce(metadata, '{}'::jsonb)
          || ${tx.json(toJson({ supersededBy: approvalId }))}
      WHERE id = ${stale.id}
    `;
    await dismissReviewRequestNotifications(tx, {
      organizationId: task.organizationId,
      approvalId: stale.id,
    });
  }
  if (reviewer !== undefined) {
    // The designated reviewer follows the task from here on — they own the
    // gate, so they need its progress, not just the request moment.
    await autoSubscribe(tx, {
      organizationId: task.organizationId,
      taskId: task.id,
      subscriberType: 'user',
      subscriberId: reviewer,
      reason: 'reviewer',
    });
    await notifyTaskReviewRequested(tx, {
      organizationId: task.organizationId,
      task: { id: task.id, projectId: task.projectId, title: task.title },
      reviewerUserId: reviewer,
      approvalId,
      submitter:
        trigger.kind === 'human'
          ? { kind: 'user', userId: trigger.actorId }
          : {
              kind: 'agent',
              ...(driverName !== undefined ? { name: driverName } : {}),
            },
    });
  }
  return { approvalId, minted: true };
}

export interface TaskReviewPolicyOutcome {
  independentReviewer?: boolean;
  /** The competence grants that justified this response — stamped on the
   * decision so a governed sign-off stays explainable afterwards. */
  competenceRecordIds?: string[];
}

/**
 * The org's `review_policy` file tightens WHO may respond — shared by the
 * respond door and the status-leave approve so no path bypasses it. A
 * policy requiring competences is checked against the responder's records
 * (`governance/competence.ts`): a refusal NAMES the missing slugs, and an
 * approval carries back the grants that justified it.
 */
export async function checkReviewPolicyForResponder(
  tx: TransactionSql | Sql,
  args: { approval: ApprovalRow; task: TaskRow; responderUserId: string },
): Promise<TaskReviewPolicyOutcome> {
  const policy = await readGovernancePolicyForOrg(
    tx,
    args.task.organizationId,
    'review_policy',
  );
  let independentReviewer: boolean | undefined;
  if (policy?.requireIndependentReviewer === true) {
    const runKey = approvalRunId(args.approval);
    const runs =
      runKey === undefined
        ? []
        : await tx<{ taskId: string; startedBy: string }[]>`
            SELECT task_id AS "taskId", started_by AS "startedBy"
            FROM app.project_agent_runs WHERE id = ${runKey} LIMIT 1
          `;
    const run = runs[0];
    if (run !== undefined && run.taskId === args.task.id) {
      if (run.startedBy === args.responderUserId) {
        throw new TaskReviewError(
          'REVIEW_INDEPENDENT_REVIEWER_REQUIRED',
          'This organization requires an independent reviewer: the person who started the run cannot approve its work.',
          403,
        );
      }
    } else if (args.task.createdBy === args.responderUserId) {
      throw new TaskReviewError(
        'REVIEW_INDEPENDENT_REVIEWER_REQUIRED',
        "This organization requires an independent reviewer: the reviewed run's driver could not be resolved, so the task creator cannot respond.",
        403,
      );
    }
    independentReviewer = true;
  }
  const requiredCompetences = policy?.requiredCompetences ?? [];
  if (requiredCompetences.length > 0) {
    const held = await holdsAllCompetences(
      tx,
      args.task.organizationId,
      args.responderUserId,
      requiredCompetences,
    );
    if (!held.holdsAll) {
      // Name what is MISSING: a governed refusal the responder cannot act on
      // is worse than no policy at all.
      throw new TaskReviewError(
        'REVIEW_COMPETENCE_REQUIRED',
        `Responding to this review requires the competence(s): ${held.missing.join(', ')}.`,
        403,
      );
    }
    // Record WHICH grants justified the response — a governed decision has
    // to be explainable after the fact.
    return {
      ...(independentReviewer !== undefined ? { independentReviewer } : {}),
      competenceRecordIds: held.heldRecordIds,
    };
  }
  return independentReviewer !== undefined ? { independentReviewer } : {};
}

export type TaskReviewLeaveActor =
  | { kind: 'user'; userId: string; email?: string }
  | { kind: 'system'; actorId: string };

/**
 * Close the review gate when a task leaves `in_review` — from EVERY status
 * path, in the status write's transaction. A person's leave to `done` IS
 * the approve (policy-checked, response recorded, audited); every other
 * leave withdraws the pending request. Workflow-era rows are left alone.
 * All validation happens before any write.
 */
export async function closePendingTaskReviewOnStatusLeave(
  tx: TransactionSql,
  args: { task: TaskRow; toStatus: string; actor: TaskReviewLeaveActor },
): Promise<void> {
  const { task, toStatus, actor } = args;
  if (task.status !== 'in_review' || toStatus === 'in_review') return;
  const pending = (await listTaskReviewApprovals(tx, task.id)).filter(
    (approval) =>
      approval.status === 'pending' && approval.wfExecutionId === null,
  );
  if (pending.length === 0) return;

  const now = Date.now();
  const approves = actor.kind === 'user' && toStatus === 'done';
  if (approves) {
    const outcomes = new Map<string, TaskReviewPolicyOutcome>();
    for (const approval of pending) {
      outcomes.set(
        approval.id,
        await checkReviewPolicyForResponder(tx, {
          approval,
          task,
          responderUserId: actor.userId,
        }),
      );
    }
    for (const approval of pending) {
      const outcome = outcomes.get(approval.id) ?? {};
      const response = {
        decision: 'approve',
        respondedBy: actor.userId,
        timestamp: now,
        ...outcome,
      };
      await tx`
        UPDATE app.approvals SET
          status = 'completed', approved_by = ${actor.userId},
          reviewed_at_ms = ${now},
          metadata = coalesce(metadata, '{}'::jsonb)
            || ${tx.json(toJson({ response }))}
        WHERE id = ${approval.id}
      `;
      await dismissReviewRequestNotifications(tx, {
        organizationId: task.organizationId,
        approvalId: approval.id,
      });
      const runKey = approvalRunId(approval);
      await createAuditLog(tx, {
        organizationId: task.organizationId,
        actorId: actor.userId,
        ...(actor.email !== undefined ? { actorEmail: actor.email } : {}),
        actorType: 'user',
        action: 'task.review_responded',
        category: 'data',
        resourceType: 'task',
        resourceId: task.id,
        resourceName: task.title,
        newState: { decision: 'approve' },
        ...(runKey !== undefined || Object.keys(outcome).length > 0
          ? {
              metadata: {
                ...(runKey !== undefined ? { runId: runKey } : {}),
                ...outcome,
              },
            }
          : {}),
        status: 'success',
      });
    }
    return;
  }
  for (const approval of pending) {
    await tx`
      UPDATE app.approvals SET
        status = 'rejected', reviewed_at_ms = ${now},
        metadata = coalesce(metadata, '{}'::jsonb)
          || ${tx.json(toJson({ withdrawn: true }))}
      WHERE id = ${approval.id}
    `;
    await dismissReviewRequestNotifications(tx, {
      organizationId: task.organizationId,
      approvalId: approval.id,
    });
  }
}

export interface PendingTaskReview {
  approvalId: string;
  taskId: string;
  round: number;
  requestedFor: string | null;
  agentSlug: string | null;
  runId: string | null;
  createdAt: number;
}

/** The task's open workflow-free review, newest first — the sheet's gate
 * card and the board chip read this. */
export async function getPendingReviewForTask(
  sql: Sql,
  organizationId: string,
  taskId: string,
): Promise<PendingTaskReview | null> {
  const rows = await sql<
    {
      id: string;
      metadata: Record<string, unknown> | null;
      createdAt: number;
    }[]
  >`
    SELECT id, metadata, created_at_ms::float8 AS "createdAt"
    FROM app.approvals
    WHERE resource_type = 'task_review' AND resource_id = ${taskId}
      AND org_id = ${organizationId} AND status = 'pending'
      AND wf_execution_id IS NULL
    ORDER BY seq DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const metadata = row.metadata ?? {};
  return {
    approvalId: row.id,
    taskId,
    round: typeof metadata.round === 'number' ? metadata.round : 0,
    requestedFor:
      typeof metadata.requestedFor === 'string' ? metadata.requestedFor : null,
    agentSlug:
      typeof metadata.agentSlug === 'string' ? metadata.agentSlug : null,
    runId: typeof metadata.runId === 'string' ? metadata.runId : null,
    createdAt: row.createdAt,
  };
}

/**
 * A reviewer decides. Approve completes the task AS THE RESPONDING USER
 * (the reviewer's gesture is the human "done" — agents can never reach it);
 * request-changes records the feedback as a task comment, re-engages an
 * agent driver with it verbatim, and hands the card back to `in_progress`
 * when no kick moved it.
 */
export async function respondToTaskReview(
  sql: Sql,
  args: {
    auth: ProjectAuthContext;
    approvalId: string;
    decision: 'approve' | 'request_changes';
    feedback?: string;
  },
): Promise<{
  taskCompleted: boolean;
  agentKicked: boolean;
  taskReopened: boolean;
}> {
  const feedback = args.feedback?.trim() || undefined;
  if (args.decision === 'request_changes' && feedback === undefined) {
    throw new TaskReviewError(
      'REVIEW_FEEDBACK_REQUIRED',
      'Requesting changes requires feedback',
    );
  }
  return sql.begin(async (tx) => {
    const approvals = await tx<ApprovalRow[]>`
      SELECT ${tx.unsafe(APPROVAL_COLUMNS)} FROM app.approvals
      WHERE id = ${args.approvalId} AND resource_type = 'task_review'
        AND org_id = ${args.auth.organizationId}
      FOR UPDATE
    `;
    const approval = approvals[0];
    if (!approval) {
      throw new TaskReviewError('REVIEW_NOT_FOUND', 'Review not found', 404);
    }
    if (approval.status !== 'pending') {
      throw new TaskReviewError(
        'REVIEW_ALREADY_RESOLVED',
        'This review was already decided',
        409,
      );
    }
    const taskId =
      typeof approval.metadata?.taskId === 'string'
        ? approval.metadata.taskId
        : '';
    const task = await loadTaskOrThrow(tx, taskId);
    if (task.organizationId !== args.auth.organizationId) {
      throw new TaskReviewError('REVIEW_NOT_FOUND', 'Review not found', 404);
    }

    const policyOutcome = await checkReviewPolicyForResponder(tx, {
      approval,
      task,
      responderUserId: args.auth.userId,
    });
    const now = Date.now();
    const response = {
      decision: args.decision,
      respondedBy: args.auth.userId,
      timestamp: now,
      ...(feedback !== undefined ? { feedback } : {}),
      ...policyOutcome,
    };
    await tx`
      UPDATE app.approvals SET
        status = 'completed', approved_by = ${args.auth.userId},
        reviewed_at_ms = ${now},
        metadata = coalesce(metadata, '{}'::jsonb)
          || ${tx.json(toJson({ response }))}
      WHERE id = ${approval.id}
    `;
    await dismissReviewRequestNotifications(tx, {
      organizationId: approval.organizationId,
      approvalId: approval.id,
    });
    await notifyTaskReviewResolved(tx, {
      organizationId: approval.organizationId,
      task: { id: task.id, projectId: task.projectId, title: task.title },
      decision: args.decision,
      decidedByUserId: args.auth.userId,
      recipientUserIds: await taskSubscriberUserIds(tx, task.id),
    });
    await recordActivity(tx, {
      task,
      actorType: 'user',
      actorId: args.auth.userId,
      action:
        args.decision === 'approve'
          ? 'review.passed'
          : 'review.changes_requested',
      ...(feedback !== undefined ? { toValue: feedback } : {}),
    });
    const runKey = approvalRunId(approval);
    await createAuditLog(tx, {
      organizationId: approval.organizationId,
      actorId: args.auth.userId,
      ...(args.auth.email !== undefined ? { actorEmail: args.auth.email } : {}),
      actorType: 'user',
      action: 'task.review_responded',
      category: 'data',
      resourceType: 'task',
      resourceId: task.id,
      resourceName: task.title,
      newState: { decision: args.decision },
      ...(runKey !== undefined || Object.keys(policyOutcome).length > 0
        ? {
            metadata: {
              ...(runKey !== undefined ? { runId: runKey } : {}),
              ...policyOutcome,
            },
          }
        : {}),
      status: 'success',
    });

    let taskCompleted = false;
    let agentKicked = false;
    let taskReopened = false;
    if (args.decision === 'approve') {
      if (task.status === 'in_review') {
        if (await hasOpenChildren(tx, task.id)) {
          throw new TaskError('TASK_HAS_OPEN_SUBTASKS', 'Open subtasks remain');
        }
        const rank = await computeEndRank(tx, task.projectId, 'done');
        await tx`
          UPDATE app.tasks SET
            status = 'done', rank = ${rank},
            completed_at_ms = ${task.completedAt ?? now},
            updated_at_ms = ${now}, status_changed_at_ms = ${now}
          WHERE id = ${task.id}
        `;
        await applyTaskCountTransition(
          tx,
          task.projectId,
          taskCountBucket(task),
          taskCountBucket({ status: 'done', archivedAt: task.archivedAt }),
        );
        await recordActivity(tx, {
          task,
          actorType: 'user',
          actorId: args.auth.userId,
          action: 'status.changed',
          fromValue: task.status,
          toValue: 'done',
        });
        await createAuditLog(tx, {
          organizationId: approval.organizationId,
          actorId: args.auth.userId,
          ...(args.auth.email !== undefined
            ? { actorEmail: args.auth.email }
            : {}),
          actorType: 'user',
          action: 'task.status_changed',
          category: 'data',
          resourceType: 'task',
          resourceId: task.id,
          resourceName: task.title,
          previousState: { status: task.status },
          newState: { status: 'done' },
          status: 'success',
        });
        await emitEvent(tx, {
          organizationId: approval.organizationId,
          eventType: 'task.status_changed',
          eventData: {
            taskId: task.id,
            projectId: task.projectId,
            fromStatus: task.status,
            toStatus: 'done',
            actorType: 'user',
            actorId: args.auth.userId,
          },
        });
        taskCompleted = true;
      }
    } else if (feedback !== undefined) {
      // The feedback is the visible record — a task comment — and re-engages
      // an agent driver with it verbatim (mirroring the comment-@mention
      // gesture). A kick refusal leaves the comment as the record.
      await addTaskComment(tx, args.auth, { taskId: task.id, body: feedback });
      if (task.assigneeType === 'agent' && task.assigneeId !== null) {
        const agents = await tx<
          {
            id: string;
            harness: string;
            model: string;
            modelProvider: string | null;
          }[]
        >`
          SELECT id, harness, model, model_provider AS "modelProvider"
          FROM app.project_agents
          WHERE id = ${task.assigneeId}
            AND org_id = ${args.auth.organizationId}
          LIMIT 1
        `;
        const agent = agents[0];
        if (agent && task.archivedAt === null) {
          const kicked = await kickAgentRun(tx, {
            organizationId: args.auth.organizationId,
            projectId: task.projectId,
            taskId: task.id,
            agentId: agent.id,
            harness: agent.harness,
            model: agent.model,
            ...(agent.modelProvider !== null
              ? { modelProvider: agent.modelProvider }
              : {}),
            startedBy: args.auth.userId,
            trigger: 'mention',
            feedback,
          });
          agentKicked = !kicked.reused;
        }
      }
      // Changes requested hands the work back to the assignee — the card
      // leaves In review even when no agent kick moved it.
      const fresh = await loadTaskOrThrow(tx, task.id);
      if (fresh.status === 'in_review') {
        const rank = await computeEndRank(tx, fresh.projectId, 'in_progress');
        await tx`
          UPDATE app.tasks SET
            status = 'in_progress', rank = ${rank},
            status_changed_at_ms = ${now}, updated_at_ms = ${now}
          WHERE id = ${fresh.id}
        `;
        await applyTaskCountTransition(
          tx,
          fresh.projectId,
          taskCountBucket(fresh),
          taskCountBucket({
            status: 'in_progress',
            archivedAt: fresh.archivedAt,
          }),
        );
        await recordActivity(tx, {
          task: fresh,
          actorType: 'user',
          actorId: args.auth.userId,
          action: 'status.changed',
          fromValue: fresh.status,
          toValue: 'in_progress',
        });
        taskReopened = true;
      }
    }
    return { taskCompleted, agentKicked, taskReopened };
  });
}

/** Bounded scan cap — mirrors the 0.4 board indicator cap. */
export const PENDING_REVIEW_SCAN_CAP = 50;

/**
 * Pending review-gate approvals whose `metadata.projectId` is in the set —
 * one bounded org-level read (pending reviews are rare org-wide) feeding
 * the board's review chips and the "Needs my review" facet.
 */
export async function collectPendingReviewsForProjects(
  sql: Sql,
  organizationId: string,
  projectIds: readonly string[],
): Promise<
  Array<{ taskId: string; approvalId: string; requestedFor: string | null }>
> {
  if (projectIds.length === 0) return [];
  return sql<
    { taskId: string; approvalId: string; requestedFor: string | null }[]
  >`
    SELECT resource_id AS "taskId", id AS "approvalId",
           nullif(metadata ->> 'requestedFor', '') AS "requestedFor"
    FROM app.approvals
    WHERE org_id = ${organizationId} AND status = 'pending'
      AND resource_type = 'task_review'
      AND metadata ->> 'projectId' IN ${sql([...projectIds])}
    ORDER BY seq DESC
    LIMIT ${PENDING_REVIEW_SCAN_CAP}
  `;
}
