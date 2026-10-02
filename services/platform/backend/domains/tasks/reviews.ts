import {
  taskReviewRecipientSchema,
  type AgentReviewBlockedReason,
  type PendingReviewIdentity,
  type TaskReviewRecipient,
} from '@tale/shared/schemas/task-review';
import type { Sql, TransactionSql } from 'postgres';

import {
  getUserTeamIds,
  findOrganizationMember,
} from '../../auth/membership.ts';
import { PROJECT_TEAM_IDS_SQL } from '../../core/lib/audience.ts';
import { ConfigurationError } from '../../core/lib/config_store/precondition.ts';
import { checkProjectAccess } from '../../core/projects/access.ts';
import { toJson } from '../../db/sql.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  autoSubscribe,
  dismissReviewRequestNotifications,
  notifyTaskReviewRequested,
} from '../collab/service.ts';
import { holdsAllCompetences } from '../governance/competence.ts';
import {
  readTaskReviewSource,
  type TaskReviewSource,
} from './review-evidence.ts';
import type { TaskRow } from './service.ts';

/**
 * The task review gate over PG — the 0.4 Driver/Reviewer arc
 * (`tasks/review_mutations.ts`) on `app.approvals`:
 * an agent settle's park to `in_review` mints one workflow-free review row in
 * the SAME transaction as the status flip (find-or-insert by runId, so the
 * settle's burned-claim replay never double-mints); every leave from
 * `in_review` closes the gate — the board's status doors ARE the decision:
 * a person's move to done IS the approve (policy-checked, recorded,
 * audited), a move back to In progress or an `@`-mention of the agent with
 * feedback requests changes, and any other leave withdraws. The org's
 * `review_policy` governance file tightens who may approve.
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

function approvalRunId(
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

/** Why a person can or cannot take a task's review. */
export type ReviewerEligibility = 'eligible' | 'not_member' | 'cannot_edit';

/**
 * Whether a person can be SENT a review in a project: a live member of the
 * organization who holds project canEdit. The ONE routing rule — the gate
 * resolves its reviewer by it, and a designation is held to it, so a
 * designee the gate would route past is refused up front instead of
 * silently skipped.
 *
 * Deciding a review is a different question: the decision IS the status
 * move, so whoever may work the task may take it — the project's editors,
 * and the member whose own task it is (`core/tasks/access.ts`) — under the
 * organization's `review_policy` ({@link checkReviewPolicyForResponder}):
 * where an independent reviewer is required, the person who started the run
 * cannot accept its work, which leaves a member's own run to an editor.
 */
export async function reviewerEligibility(
  tx: TransactionSql | Sql,
  args: {
    organizationId: string;
    /** The project's audience (`PROJECT_TEAM_IDS_SQL`); empty = org-wide. */
    projectTeamIds: readonly string[];
    userId: string;
  },
): Promise<ReviewerEligibility> {
  const member = await findOrganizationMember(
    tx,
    args.organizationId,
    args.userId,
  );
  if (member === null || member.role === 'disabled') return 'not_member';
  const teamIds = await getUserTeamIds(tx, args.organizationId, args.userId);
  const access = checkProjectAccess(
    { teamIds: args.projectTeamIds },
    teamIds,
    member.role,
  );
  return access.canEdit ? 'eligible' : 'cannot_edit';
}

/** Agent review is an explicit project-scoped grant, not an agent role. */
export async function agentReviewerEligibility(
  sql: Sql | TransactionSql,
  args: { organizationId: string; projectId: string; agentId: string },
): Promise<'eligible' | 'reviewer_unavailable' | 'permission_missing'> {
  const agents = await sql<{ tools: string[] }[]>`
    SELECT tools FROM app.project_agents
    WHERE id = ${args.agentId} AND org_id = ${args.organizationId}
      AND project_id = ${args.projectId}
  `;
  const agent = agents[0];
  if (agent === undefined) return 'reviewer_unavailable';
  return agent.tools.includes('task_review')
    ? 'eligible'
    : 'permission_missing';
}

/** Settlement must retain a recoverable review if policy cannot be read. */
async function agentReviewPolicyBlock(
  sql: Sql | TransactionSql,
  organizationId: string,
): Promise<'human_policy' | 'policy_unavailable' | null> {
  try {
    const policy = await readGovernancePolicyForOrg(
      sql,
      organizationId,
      'review_policy',
      { strict: true },
    );
    return policy?.requireIndependentReviewer === true ||
      (policy?.requiredCompetences?.length ?? 0) > 0
      ? 'human_policy'
      : null;
  } catch (error) {
    if (error instanceof ConfigurationError) return 'policy_unavailable';
    throw error;
  }
}

/** Derived from the same live authority and exact source that a verdict needs.
 * It never changes captured ownership or grants permission to another actor. */
async function agentReviewBlockedReason(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    taskId: string;
    reviewerAgentId: string;
    source: TaskReviewSource | null;
  },
): Promise<AgentReviewBlockedReason | null> {
  const policyBlock = await agentReviewPolicyBlock(sql, args.organizationId);
  if (policyBlock !== null) return policyBlock;
  const tasks = await sql<
    {
      projectId: string;
      assigneeType: string | null;
      assigneeId: string | null;
    }[]
  >`
    SELECT project_id AS "projectId", assignee_type AS "assigneeType", assignee_id AS "assigneeId"
    FROM app.tasks WHERE id = ${args.taskId} AND org_id = ${args.organizationId}
  `;
  const task = tasks[0];
  if (task === undefined) return 'source_required';
  const eligibility = await agentReviewerEligibility(sql, {
    organizationId: args.organizationId,
    projectId: task.projectId,
    agentId: args.reviewerAgentId,
  });
  if (eligibility !== 'eligible') return eligibility;
  const source = args.source;
  if (
    source === null ||
    source.status !== 'settled' ||
    source.settledAt === null
  )
    return 'source_required';
  if (source.implementationAgentId === args.reviewerAgentId)
    return 'self_review';
  const latest = await sql<{ id: string }[]>`
    SELECT id FROM app.project_agent_runs WHERE org_id = ${args.organizationId}
      AND project_id = ${task.projectId} AND task_id = ${args.taskId}
    ORDER BY seq DESC LIMIT 1
  `;
  if (
    latest[0]?.id !== source.runId ||
    task.assigneeType !== 'agent' ||
    task.assigneeId !== source.implementationAgentId
  )
    return 'source_changed';
  return null;
}

/**
 * Who should review a task parked at `in_review` — revalidated at every
 * call so a designee who lost project access falls through the chain:
 * explicit `reviewerUserId` → human task creator → project creator; the
 * first candidate who still holds project canEdit wins. `excluding` is
 * skipped wherever it appears in the chain (an erased subject stays a
 * member until someone removes them, and may be either creator).
 */
async function resolveHumanReviewer(
  tx: TransactionSql | Sql,
  task: TaskRow,
  excluding?: string,
): Promise<string | undefined> {
  const projects = await tx<{ createdBy: string; teamIds: string[] | null }[]>`
    SELECT created_by AS "createdBy", ${tx.unsafe(PROJECT_TEAM_IDS_SQL)} AS "teamIds"
    FROM app.projects WHERE id = ${task.projectId} LIMIT 1
  `;
  const project = projects[0];
  const candidates = [
    task.reviewerUserId ?? undefined,
    task.createdByType === 'user' ? task.createdBy : undefined,
    project?.createdBy,
  ];
  const seen = new Set<string>();
  if (excluding !== undefined) seen.add(excluding);
  for (const candidate of candidates) {
    if (candidate === undefined || seen.has(candidate)) continue;
    seen.add(candidate);
    const eligibility = await reviewerEligibility(tx, {
      organizationId: task.organizationId,
      projectTeamIds: project?.teamIds ?? [],
      userId: candidate,
    });
    if (eligibility === 'eligible') return candidate;
  }
  return undefined;
}

/** Preserve captured agent ownership even if the referenced agent disappears.
 * Only old metadata without the typed field uses the human-only legacy mirror. */
export function taskReviewRecipientOf(
  metadata: Record<string, unknown> | null,
): TaskReviewRecipient | null {
  if (metadata !== null && 'reviewer' in metadata) {
    const parsed = taskReviewRecipientSchema.safeParse(metadata.reviewer);
    return parsed.success ? parsed.data : null;
  }
  return typeof metadata?.requestedFor === 'string'
    ? { kind: 'user', userId: metadata.requestedFor }
    : null;
}

async function resolveReviewer(
  tx: TransactionSql | Sql,
  task: TaskRow,
): Promise<TaskReviewRecipient | null> {
  if (task.reviewerAgentId != null) {
    return { kind: 'agent', agentId: task.reviewerAgentId };
  }
  if (task.reviewerUserId === null) {
    const projects = await tx<{ agentId: string | null }[]>`
      SELECT default_task_reviewer_agent_id AS "agentId" FROM app.projects
      WHERE id = ${task.projectId} AND org_id = ${task.organizationId}
    `;
    const agentId = projects[0]?.agentId;
    if (agentId != null) return { kind: 'agent', agentId };
  }
  const userId = await resolveHumanReviewer(tx, task);
  return userId === undefined ? null : { kind: 'user', userId };
}

function sameRecipient(
  left: TaskReviewRecipient | null,
  right: TaskReviewRecipient | null,
): boolean {
  return left?.kind === 'user'
    ? right?.kind === 'user' && left.userId === right.userId
    : left?.kind === 'agent'
      ? right?.kind === 'agent' && left.agentId === right.agentId
      : right === null;
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

  return mintTaskReview(tx, { task, trigger, prior });
}

/** One mint and fan-out for normal submission and explicit routing handoff. */
async function mintTaskReview(
  tx: TransactionSql,
  args: {
    task: TaskRow;
    trigger: TaskReviewTrigger;
    prior: ApprovalRow[];
    requestedByUserId?: string;
    /** Explicit handoffs validate the captured source and do not reroute. */
    reviewer?: TaskReviewRecipient | null;
  },
): Promise<{ approvalId: string; minted: boolean }> {
  const { task, trigger, prior } = args;
  const runKey = trigger.kind === 'agent_run' ? trigger.runId : undefined;
  let reviewer =
    args.reviewer === undefined
      ? await resolveReviewer(tx, task)
      : args.reviewer;
  if (
    args.reviewer === undefined &&
    reviewer?.kind === 'agent' &&
    (trigger.kind !== 'agent_run' ||
      (await agentReviewPolicyBlock(tx, task.organizationId)) ===
        'human_policy')
  ) {
    const userId = await resolveHumanReviewer(tx, task);
    reviewer = userId === undefined ? null : { kind: 'user', userId };
  }
  const driverName = await resolveDriverDisplayName(tx, task);
  const metadata = {
    taskId: task.id,
    projectId: task.projectId,
    agentSlug: driverName ?? null,
    requestedFor: reviewer?.kind === 'user' ? reviewer.userId : null,
    reviewer,
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
  if (reviewer?.kind === 'user') {
    // The designated reviewer follows the task from here on — they own the
    // gate, so they need its progress, not just the request moment.
    await autoSubscribe(tx, {
      organizationId: task.organizationId,
      taskId: task.id,
      subscriberType: 'user',
      subscriberId: reviewer.userId,
      reason: 'reviewer',
    });
    await notifyTaskReviewRequested(tx, {
      organizationId: task.organizationId,
      task: { id: task.id, projectId: task.projectId, title: task.title },
      reviewerUserId: reviewer.userId,
      approvalId,
      submitter:
        args.requestedByUserId !== undefined
          ? { kind: 'user', userId: args.requestedByUserId }
          : trigger.kind === 'human'
            ? { kind: 'user', userId: trigger.actorId }
            : {
                kind: 'agent',
                ...(driverName !== undefined ? { name: driverName } : {}),
              },
    });
  }
  return { approvalId, minted: true };
}

/**
 * Follow a changed designation while the gate is open. MUST run in the
 * same transaction as the `reviewer_user_id` write, with `task` already
 * carrying the new designation: the open review is resolved through the
 * mint's own chain, so a new designee takes it and a clear hands it back to
 * the default (human task creator → project creator). When that moves the
 * request, it moves whole — the previous reviewer's request bell stops
 * ringing, and the new one follows the task and is asked by the person who
 * made the change (never belled for taking a review on themselves).
 * Workflow-era rows are left alone, as on the status leave. Returns whom
 * the open review now waits on; undefined when none is open or nobody
 * resolves.
 *
 * An erasure moves a review off its subject the same way: no person made
 * that change, so `actorUserId` is absent and the request reads
 * impersonally, and `excludeUserId` keeps the chain from landing on the
 * subject again through a creator slot. `silent` moves the routing (and
 * the follow) without asking anyone — for a task hidden from the board,
 * where an actionable request would point at a card nobody can act on
 * until it is restored.
 */
export async function retargetPendingTaskReview(
  tx: TransactionSql,
  args: {
    task: TaskRow;
    actorUserId?: string;
    excludeUserId?: string;
    silent?: boolean;
  },
): Promise<string | undefined> {
  const { task, actorUserId, excludeUserId, silent = false } = args;
  const pending = (await listTaskReviewApprovals(tx, task.id)).filter(
    (approval) =>
      approval.status === 'pending' && approval.wfExecutionId === null,
  );
  if (pending.length === 0) return undefined;

  const reviewer = await resolveHumanReviewer(tx, task, excludeUserId);
  for (const approval of pending) {
    if (taskReviewRecipientOf(approval.metadata)?.kind === 'agent') continue;
    if ((approval.metadata?.requestedFor ?? null) === (reviewer ?? null)) {
      continue;
    }
    await tx`
      UPDATE app.approvals SET
        metadata = coalesce(metadata, '{}'::jsonb)
          || ${tx.json(
            toJson({
              requestedFor: reviewer ?? null,
              reviewer:
                reviewer === undefined
                  ? null
                  : { kind: 'user', userId: reviewer },
            }),
          )}
      WHERE id = ${approval.id} AND status = 'pending'
    `;
    await dismissReviewRequestNotifications(tx, {
      organizationId: task.organizationId,
      approvalId: approval.id,
    });
    if (reviewer === undefined) continue;
    await autoSubscribe(tx, {
      organizationId: task.organizationId,
      taskId: task.id,
      subscriberType: 'user',
      subscriberId: reviewer,
      reason: 'reviewer',
    });
    if (silent) continue;
    await notifyTaskReviewRequested(tx, {
      organizationId: task.organizationId,
      task: { id: task.id, projectId: task.projectId, title: task.title },
      reviewerUserId: reviewer,
      approvalId: approval.id,
      submitter:
        actorUserId === undefined
          ? { kind: 'system' }
          : { kind: 'user', userId: actorUserId },
    });
  }
  return reviewer;
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
async function checkReviewPolicyForResponder(
  tx: TransactionSql | Sql,
  args: { approval: ApprovalRow; task: TaskRow; responderUserId: string },
): Promise<TaskReviewPolicyOutcome> {
  const policy = await readGovernancePolicyForOrg(
    tx,
    args.task.organizationId,
    'review_policy',
    { strict: true },
  ).catch((error: unknown) => {
    if (!(error instanceof ConfigurationError)) throw error;
    throw new TaskReviewError(
      'TASK_REVIEW_POLICY_UNAVAILABLE',
      'The review policy is unavailable; restore valid configuration before deciding',
      409,
    );
  });
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

  if (
    toStatus === 'done' &&
    pending.some(
      (approval) => taskReviewRecipientOf(approval.metadata)?.kind === 'agent',
    )
  ) {
    throw new TaskReviewError(
      'TASK_AGENT_REVIEW_REQUIRED',
      'This review belongs to an agent; explicitly transfer it before a human approval',
      409,
    );
  }
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

/** Explicit editor handoff. The caller locks the task and validates the
 * configured choice before changing it. Old approvals remain history and a
 * delayed human response cannot act on the successor's captured agent owner. */
export async function replacePendingTaskReviewer(
  tx: TransactionSql,
  args: {
    task: TaskRow;
    expected: PendingReviewIdentity | null;
    actorUserId: string;
  },
): Promise<void> {
  const prior = await listTaskReviewApprovals(tx, args.task.id);
  const pending = prior.filter((approval) => approval.status === 'pending');
  const expected = args.expected;
  const current = pending[0];
  if (
    pending.length !== (expected === null ? 0 : 1) ||
    (expected !== null &&
      (current === undefined ||
        current.wfExecutionId !== null ||
        current.id !== expected.approvalId ||
        (approvalRunId(current) ?? null) !== expected.runId ||
        !sameRecipient(
          taskReviewRecipientOf(current.metadata),
          expected.reviewer,
        )))
  ) {
    throw new TaskReviewError(
      'TASK_REVIEWER_STALE',
      'Review changed; read it again before handing it over',
      409,
    );
  }
  if (current === undefined) return;
  if (args.task.status !== 'in_review') {
    throw new TaskReviewError(
      'TASK_REVIEWER_STALE',
      'The task is no longer in review',
      409,
    );
  }
  const reviewer = await resolveReviewer(tx, args.task);
  const runId = approvalRunId(current);
  if (reviewer?.kind === 'agent') {
    const runs = await tx<{ id: string; agentId: string; status: string }[]>`
      SELECT id, agent_id AS "agentId", status FROM app.project_agent_runs
      WHERE task_id = ${args.task.id} AND org_id = ${args.task.organizationId}
        AND project_id = ${args.task.projectId}
      ORDER BY seq DESC LIMIT 1
    `;
    const source = runs[0];
    if (
      source === undefined ||
      source.id !== runId ||
      source.status !== 'settled'
    ) {
      throw new TaskReviewError(
        'TASK_REVIEW_SOURCE_REQUIRED',
        'Agent review needs the latest completed implementation run',
        409,
      );
    }
    if (source.agentId === reviewer.agentId) {
      throw new TaskReviewError(
        'TASK_REVIEWER_NOT_INDEPENDENT',
        'Choose an agent other than the implementation agent',
        409,
      );
    }
    const block = await agentReviewBlockedReason(tx, {
      organizationId: args.task.organizationId,
      taskId: args.task.id,
      reviewerAgentId: reviewer.agentId,
      source: await readTaskReviewSource(tx, {
        organizationId: args.task.organizationId,
        taskId: args.task.id,
        runId: source.id,
      }),
    });
    if (block !== null) {
      throw new TaskReviewError(
        block === 'policy_unavailable'
          ? 'GOVERNANCE_POLICY_UNAVAILABLE'
          : block === 'human_policy'
            ? 'TASK_REVIEWER_HUMAN_REQUIRED'
            : block === 'source_changed'
              ? 'TASK_REVIEW_SOURCE_CHANGED'
              : block === 'source_required'
                ? 'TASK_REVIEW_SOURCE_REQUIRED'
                : 'TASK_REVIEWER_INVALID',
        'Agent review is blocked; restore its source and permission or hand the review to an eligible person',
        409,
      );
    }
  }
  if (sameRecipient(taskReviewRecipientOf(current.metadata), reviewer)) return;
  const minted = await mintTaskReview(tx, {
    task: args.task,
    reviewer,
    prior,
    requestedByUserId: args.actorUserId,
    trigger:
      runId === undefined
        ? { kind: 'human', actorId: args.actorUserId }
        : { kind: 'agent_run', runId },
  });
  await createAuditLog(tx, {
    organizationId: args.task.organizationId,
    actorId: args.actorUserId,
    actorType: 'user',
    action: 'task.review_retargeted',
    category: 'data',
    resourceType: 'task',
    resourceId: args.task.id,
    resourceName: args.task.title,
    previousState: {
      approvalId: current.id,
      reviewer: taskReviewRecipientOf(current.metadata),
    },
    newState: { approvalId: minted.approvalId, reviewer },
    metadata: { runId: runId ?? null },
    status: 'success',
  });
}

export interface PendingTaskReview {
  approvalId: string;
  taskId: string;
  round: number;
  /** Human-only legacy mirror; null for an agent recipient. */
  requestedFor: string | null;
  reviewer: TaskReviewRecipient | null;
  agentSlug: string | null;
  /** Exact source-run actor, never the driver's label or current assignee. */
  implementationAgentId: string | null;
  /** Local task/source/discussion snapshot; external heads are not verified here. */
  evidenceRevision: string | null;
  /** Live recovery guidance; null for a human review or an eligible agent. */
  agentReviewBlockedReason: AgentReviewBlockedReason | null;
  runId: string | null;
  createdAt: number;
}

/** The task's open workflow-free review, newest first — the sheet's gate
 * card and the board chip read this. */
export async function getPendingReviewForTask(
  sql: Sql | TransactionSql,
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
  const reviewer = taskReviewRecipientOf(metadata);
  const runId = typeof metadata.runId === 'string' ? metadata.runId : null;
  const source =
    runId === null
      ? null
      : await readTaskReviewSource(sql, { organizationId, taskId, runId });
  return {
    approvalId: row.id,
    taskId,
    round: typeof metadata.round === 'number' ? metadata.round : 0,
    reviewer,
    requestedFor: reviewer?.kind === 'user' ? reviewer.userId : null,
    agentSlug:
      typeof metadata.agentSlug === 'string' ? metadata.agentSlug : null,
    implementationAgentId: source?.implementationAgentId ?? null,
    evidenceRevision:
      source?.status === 'settled' && source.settledAt !== null
        ? source.evidenceRevision
        : null,
    agentReviewBlockedReason:
      reviewer?.kind === 'agent'
        ? await agentReviewBlockedReason(sql, {
            organizationId,
            taskId,
            reviewerAgentId: reviewer.agentId,
            source,
          })
        : null,
    runId,
    createdAt: row.createdAt,
  };
}

/** Bounded scan cap — mirrors the 0.4 board indicator cap. */
const PENDING_REVIEW_SCAN_CAP = 50;

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
  Array<{
    taskId: string;
    approvalId: string;
    requestedFor: string | null;
    reviewer: TaskReviewRecipient | null;
  }>
> {
  if (projectIds.length === 0) return [];
  const rows = await sql<
    {
      taskId: string;
      approvalId: string;
      metadata: Record<string, unknown> | null;
    }[]
  >`
    SELECT resource_id AS "taskId", id AS "approvalId",
           metadata
    FROM app.approvals
    WHERE org_id = ${organizationId} AND status = 'pending'
      AND resource_type = 'task_review'
      AND metadata ->> 'projectId' IN ${sql([...projectIds])}
    ORDER BY seq DESC
    LIMIT ${PENDING_REVIEW_SCAN_CAP}
  `;
  return rows.map((row) => {
    const reviewer = taskReviewRecipientOf(row.metadata);
    return {
      taskId: row.taskId,
      approvalId: row.approvalId,
      requestedFor: reviewer?.kind === 'user' ? reviewer.userId : null,
      reviewer,
    };
  });
}
