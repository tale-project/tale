import {
  taskAgentReviewInputSchema,
  taskAgentReviewReceiptSchema,
  type TaskAgentReviewInput,
  type TaskAgentReviewReceipt,
} from '@tale/shared/schemas/task-review';
import type { TransactionSql } from 'postgres';

import { SANDBOX_SESSION_LIVE_STATUSES } from '../../core/sandbox/session_constants.ts';
import { toJson } from '../../db/sql.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { dismissReviewRequestNotifications } from '../collab/service.ts';
import { loadProjectOrThrow } from '../projects/service.ts';
import { addTaskReviewFeedback, queuedOnTask } from './comments.ts';
import { TaskError } from './errors.ts';
import { readTaskReviewSource } from './review-evidence.ts';
import { taskReviewRecipientOf, type ApprovalRow } from './reviews.ts';
import { lockTaskRunStart } from './run-start.ts';
import {
  applyAgentTaskReviewStatusTrusted,
  assertTaskCreatable,
  assertTaskNotArchived,
  loadTaskOrThrow,
  recordActivity,
  type TaskRow,
} from './service.ts';

/** These identifiers come only from the authenticated session binding.
 * The shim rechecks the starter's project authority in this transaction. */
export interface AgentReviewAuthority {
  organizationId: string;
  projectId: string;
  agentId: string;
  sessionId: string;
  execId: string;
}

function stale(): never {
  throw new TaskError(
    'TASK_REVIEW_STALE',
    'The review or its evidence changed; read the task again before deciding',
    409,
  );
}

/** The session-token grant was checked at the HTTP door. A review also
 * requires the CURRENT project-agent grant: revoking it stops an already
 * minted token, including a retry of a previously successful decision. */
async function liveIssuer(
  tx: TransactionSql,
  auth: AgentReviewAuthority,
): Promise<string> {
  const rows = await tx<{ id: string; tools: string[] | null }[]>`
    SELECT r.id, a.tools
    FROM app.project_agent_runs r
    JOIN app.project_agents a ON a.id = r.agent_id AND a.org_id = r.org_id
      AND a.project_id = r.project_id
    WHERE r.org_id = ${auth.organizationId} AND r.project_id = ${auth.projectId}
      AND r.agent_id = ${auth.agentId} AND r.session_id = ${auth.sessionId}
      AND r.exec_id = ${auth.execId} AND r.status IN ('queued', 'running')
      AND EXISTS (
        SELECT 1 FROM app.sandbox_sessions s
        WHERE s.org_id = r.org_id AND s.session_id = r.session_id
          AND s.owner_type = 'project_agent' AND s.owner_id = r.agent_id
          AND s.status IN ${tx([...SANDBOX_SESSION_LIVE_STATUSES])}
          AND s.expires_at_ms > ${Date.now()}
      )
    ORDER BY r.seq DESC LIMIT 1
  `;
  const issuer = rows[0];
  if (issuer === undefined || !issuer.tools?.includes('task_review')) {
    throw new TaskError(
      'TASK_REVIEW_FORBIDDEN',
      'This live project agent run no longer has the task review permission',
      403,
    );
  }
  return issuer.id;
}

function replayOf(
  approval: ApprovalRow,
  input: TaskAgentReviewInput,
  agentId: string,
  issuerRunId: string,
): TaskAgentReviewReceipt | null {
  if (approval.status === 'pending') return null;
  const receipt = taskAgentReviewReceiptSchema.safeParse(
    approval.metadata?.response,
  );
  const prior = taskAgentReviewInputSchema.safeParse(
    approval.metadata?.agentReviewRequest,
  );
  if (
    !receipt.success ||
    !prior.success ||
    receipt.data.reviewer.agentId !== agentId ||
    receipt.data.issuerRunId !== issuerRunId ||
    receipt.data.approvalId !== approval.id ||
    receipt.data.taskId !== input.taskId ||
    receipt.data.runId !== input.expected.runId ||
    receipt.data.evidenceRevision !== input.expected.evidenceRevision ||
    approval.status !==
      (receipt.data.decision === 'approve' ? 'completed' : 'rejected') ||
    JSON.stringify(prior.data) !== JSON.stringify(input)
  ) {
    return stale();
  }
  return receipt.data;
}

/** Shared read-only review gate. Verdicts call it under their existing locks;
 * staging calls it in short transactions before and after network I/O. */
async function validatePendingAgentReview(
  tx: TransactionSql,
  auth: AgentReviewAuthority,
  input: Pick<TaskAgentReviewInput, 'taskId' | 'expected'>,
  task: TaskRow,
  approval: ApprovalRow,
) {
  const recipient = taskReviewRecipientOf(approval.metadata);
  if (recipient?.kind !== 'agent' || recipient.agentId !== auth.agentId) {
    throw new TaskError(
      'TASK_REVIEW_FORBIDDEN',
      'This pending review belongs to a different reviewer',
      403,
    );
  }
  if (typeof approval.metadata?.runId !== 'string') {
    throw new TaskError(
      'TASK_REVIEW_SOURCE_REQUIRED',
      'This review names no native implementation run; explicitly transfer it to an eligible person',
      409,
    );
  }
  if (
    approval.metadata?.runId !== input.expected.runId ||
    approval.metadata?.projectId !== auth.projectId ||
    task.status !== 'in_review'
  )
    return stale();
  const pending = await tx<{ id: string }[]>`
    SELECT id FROM app.approvals
    WHERE org_id = ${auth.organizationId} AND resource_type = 'task_review'
      AND resource_id = ${task.id} AND status = 'pending'
  `;
  if (pending.length !== 1 || pending[0]?.id !== approval.id) return stale();
  const source = await readTaskReviewSource(tx, {
    organizationId: auth.organizationId,
    taskId: task.id,
    runId: input.expected.runId,
  });
  const latest = await tx<{ id: string }[]>`
    SELECT id FROM app.project_agent_runs
    WHERE org_id = ${auth.organizationId} AND project_id = ${auth.projectId}
      AND task_id = ${task.id}
    ORDER BY seq DESC LIMIT 1
  `;
  if (
    source === null ||
    source.status !== 'settled' ||
    source.settledAt === null
  ) {
    throw new TaskError(
      'TASK_REVIEW_SOURCE_REQUIRED',
      'Agent review needs a completed native implementation run',
      409,
    );
  }
  if (source.implementationAgentId === auth.agentId) {
    throw new TaskError(
      'TASK_REVIEWER_NOT_INDEPENDENT',
      'The implementation agent cannot review its own work',
      403,
    );
  }
  if (
    latest[0]?.id !== source.runId ||
    task.assigneeType !== 'agent' ||
    task.assigneeId !== source.implementationAgentId ||
    source.evidenceRevision !== input.expected.evidenceRevision
  )
    return stale();
  const policy = await readGovernancePolicyForOrg(
    tx,
    auth.organizationId,
    'review_policy',
    { strict: true },
  ).catch(() => {
    throw new TaskError(
      'TASK_REVIEW_POLICY_UNAVAILABLE',
      'The review policy is unavailable; restore valid configuration before deciding',
      409,
    );
  });
  if (policy?.requireIndependentReviewer === true) {
    throw new TaskError(
      'REVIEW_INDEPENDENT_REVIEWER_REQUIRED',
      'This organization requires an independent human reviewer; explicitly transfer this review to an eligible person',
      403,
    );
  }
  if ((policy?.requiredCompetences ?? []).length > 0) {
    throw new TaskError(
      'TASK_REVIEW_HUMAN_COMPETENCE_REQUIRED',
      'This review requires human competence records; explicitly transfer it to an eligible person',
      403,
    );
  }
  return source;
}

/** Current review authority only: no lock UPDATE, comment, verdict or run. */
export async function readAgentTaskReviewAccess(
  tx: TransactionSql,
  auth: AgentReviewAuthority,
  input: Pick<TaskAgentReviewInput, 'taskId' | 'expected'>,
) {
  const issuerRunId = await liveIssuer(tx, auth);
  const task = await loadTaskOrThrow(tx, input.taskId, auth.organizationId);
  if (task.projectId !== auth.projectId) {
    throw new TaskError('TASK_NOT_FOUND', 'No task in this project', 404);
  }
  assertTaskNotArchived(task);
  const project = await loadProjectOrThrow(tx, auth.projectId);
  assertTaskCreatable(project, {
    organizationId: auth.organizationId,
    userId: auth.agentId,
    role: 'admin',
    teamIds: [],
  });
  const rows = await tx<ApprovalRow[]>`
    SELECT id, org_id AS "organizationId", status,
      wf_execution_id AS "wfExecutionId", approved_by AS "approvedBy",
      reviewed_at_ms::float8 AS "reviewedAt", metadata,
      created_at_ms::float8 AS "createdAt"
    FROM app.approvals
    WHERE id = ${input.expected.approvalId} AND org_id = ${auth.organizationId}
      AND resource_type = 'task_review' AND resource_id = ${task.id}
  `;
  const approval = rows[0];
  if (
    approval === undefined ||
    approval.status !== 'pending' ||
    approval.wfExecutionId !== null
  )
    return stale();
  const source = await validatePendingAgentReview(
    tx,
    auth,
    input,
    task,
    approval,
  );
  return { task, approval, source, issuerRunId };
}

/** Source-bound native review. A run reviews work from its own standing
 * task; it never starts an implementation run on the task being judged.
 * All authorization, CAS checks and effects share one serializable write.
 * The comment queue precedes the task row lock, as for every comment writer. */
export async function reviewAgentTask(
  tx: TransactionSql,
  auth: AgentReviewAuthority,
  raw: unknown,
): Promise<TaskAgentReviewReceipt> {
  const parsed = taskAgentReviewInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TaskError(
      'TASK_REVIEW_INVALID',
      'Name the exact pending approval, source run and evidence revision, a verdict, feedback and concrete check results',
    );
  }
  const input = parsed.data;
  // This precedes replay and every target write, including the lock UPDATE.
  const issuerRunId = await liveIssuer(tx, auth);
  const initial = await loadTaskOrThrow(tx, input.taskId, auth.organizationId);
  if (initial.projectId !== auth.projectId) {
    throw new TaskError('TASK_NOT_FOUND', 'No task in this project', 404);
  }
  const project = await loadProjectOrThrow(tx, auth.projectId);
  assertTaskCreatable(project, {
    organizationId: auth.organizationId,
    userId: auth.agentId,
    role: 'admin',
    teamIds: [],
  });
  return queuedOnTask(tx, input.taskId, async () => {
    await lockTaskRunStart(tx, auth.organizationId, input.taskId);
    const task = await loadTaskOrThrow(tx, input.taskId, auth.organizationId);
    if (task.projectId !== auth.projectId) return stale();
    const rows = await tx<ApprovalRow[]>`
      SELECT id, org_id AS "organizationId", status,
        wf_execution_id AS "wfExecutionId", approved_by AS "approvedBy",
        reviewed_at_ms::float8 AS "reviewedAt", metadata,
        created_at_ms::float8 AS "createdAt"
      FROM app.approvals
      WHERE id = ${input.expected.approvalId} AND org_id = ${auth.organizationId}
        AND resource_type = 'task_review' AND resource_id = ${task.id}
      FOR UPDATE
    `;
    const approval = rows[0];
    if (approval === undefined) return stale();
    if (approval.wfExecutionId !== null) {
      throw new TaskError(
        'TASK_REVIEW_SOURCE_REQUIRED',
        'Agent review requires a completed native agent run; workflow approvals keep their own decision gate',
        409,
      );
    }
    const replay = replayOf(approval, input, auth.agentId, issuerRunId);
    if (replay !== null) return replay;
    const source = await validatePendingAgentReview(
      tx,
      auth,
      input,
      task,
      approval,
    );
    // The trusted status half checks archive, live engines/asks, subtasks
    // and dependencies before any comment can dispatch or approval can close.
    const status = input.decision === 'approve' ? 'done' : 'todo';
    await applyAgentTaskReviewStatusTrusted(tx, {
      task,
      agentId: auth.agentId,
      status,
    });
    const feedback = await addTaskReviewFeedback(tx, {
      organizationId: auth.organizationId,
      taskId: task.id,
      agentId: auth.agentId,
      body: input.feedback,
    });
    const receipt: TaskAgentReviewReceipt = {
      taskId: task.id,
      approvalId: approval.id,
      runId: source.runId,
      reviewer: { kind: 'agent', agentId: auth.agentId },
      issuerRunId,
      evidenceRevision: source.evidenceRevision,
      decision: input.decision,
      status,
      feedbackCommentId: feedback.messageId,
      evidence: input.evidence,
      decidedAt: Date.now(),
    };
    await tx`
      UPDATE app.approvals SET
        status = ${input.decision === 'approve' ? 'completed' : 'rejected'},
        approved_by = NULL, reviewed_at_ms = ${receipt.decidedAt},
        metadata = coalesce(metadata, '{}'::jsonb) || ${tx.json(
          toJson({
            response: receipt,
            agentReviewRequest: input,
          }),
        )}
      WHERE id = ${approval.id} AND org_id = ${auth.organizationId}
        AND status = 'pending' AND wf_execution_id IS NULL
    `;
    await dismissReviewRequestNotifications(tx, {
      organizationId: auth.organizationId,
      approvalId: approval.id,
    });
    await recordActivity(tx, {
      task,
      actorType: 'agent',
      actorId: auth.agentId,
      action: 'review.responded',
      toValue: JSON.stringify(receipt),
    });
    await createAuditLog(tx, {
      organizationId: auth.organizationId,
      actorId: auth.agentId,
      actorType: 'api',
      action: 'task.review_responded',
      category: 'data',
      resourceType: 'task',
      resourceId: task.id,
      resourceName: task.title,
      newState: { decision: input.decision, status },
      metadata: { viaAgent: true, ...receipt },
      status: 'success',
    });
    return receipt;
  });
}
