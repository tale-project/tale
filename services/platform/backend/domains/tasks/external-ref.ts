import type { Sql, TransactionSql } from 'postgres';

import {
  TASK_AUDIT_ACTIONS,
  TASK_RESOURCE_TYPE,
} from '../../../convex/tasks/audit_actions.ts';
import {
  taskWorkflowSubjectInput,
  truncateImportedTitle,
} from '../../../convex/tasks/helpers.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { beginRun } from '../automations/store.ts';
import { emitEvent } from '../events/emit.ts';
import { closePendingTaskReviewOnStatusLeave } from './reviews.ts';
import {
  applyTaskCountTransition,
  computeEndRank,
  nextTaskNumber,
  recordActivity,
  resolveProjectLabels,
  TASK_COLUMNS,
  taskCountBucket,
  TERMINAL_STATUSES,
  TaskError,
  type TaskRow,
  type TaskStatus,
} from './service.ts';

/**
 * External-ref task intake — the 0.5 twin of 0.4's
 * `agentUpsertTaskByExternalRef` + `startWorkflowForTask`:
 *
 *  - {@link upsertTaskByExternalRef} materializes an external item (a GitHub
 *    issue, a desk ticket) as a task, idempotently within the caller-chosen
 *    dedupe scope, keeping local triage authoritative while the external
 *    system owns the open/closed lifecycle. It drives the REST
 *    `POST /api/v1/tasks` door and, later, the sandbox `task_upsert` tool.
 *  - {@link startWorkflowForTask} starts a DEPLOYED automation with the task
 *    as its subject input — one live run per (automation, task), attributed
 *    to the task's project.
 */

/** Neutral inbox column a newly-synced (or reopened) external item lands in. */
const SYNC_OPEN_STATUS: TaskStatus = 'backlog';

async function findTaskByExternalRef(
  tx: TransactionSql,
  args: {
    organizationId: string;
    projectId?: string;
    externalSystem: string;
    externalId: string;
    dedupeScope: 'org' | 'project';
  },
): Promise<TaskRow | null> {
  if (args.dedupeScope === 'project') {
    if (args.projectId === undefined) {
      throw new TaskError(
        'TASK_EXTERNAL_REF_INVALID',
        "dedupeScope 'project' requires a projectId",
      );
    }
    const rows = await tx<TaskRow[]>`
      SELECT ${tx.unsafe(TASK_COLUMNS)} FROM app.tasks
      WHERE project_id = ${args.projectId}
        AND external_system = ${args.externalSystem}
        AND external_id = ${args.externalId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }
  const rows = await tx<TaskRow[]>`
    SELECT ${tx.unsafe(TASK_COLUMNS)} FROM app.tasks
    WHERE org_id = ${args.organizationId}
      AND external_system = ${args.externalSystem}
      AND external_id = ${args.externalId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function externalRefAudit(
  tx: TransactionSql,
  args: {
    organizationId: string;
    actorId: string;
    action: string;
    taskId: string;
    title: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await createAuditLog(tx, {
    organizationId: args.organizationId,
    actorId: args.actorId,
    actorType: 'api',
    action: args.action,
    category: 'data',
    resourceType: TASK_RESOURCE_TYPE,
    resourceId: args.taskId,
    resourceName: args.title,
    metadata: { viaAgent: true, ...args.metadata },
    status: 'success',
  });
}

export interface UpsertTaskByExternalRefArgs {
  organizationId: string;
  actorId: string;
  /** Destination project for a CREATE; required for `dedupeScope:'project'`.
   * Omittable for an org-scope, `createIfMissing:false` reconcile. */
  projectId?: string;
  externalSystem: string;
  externalId: string;
  title: string;
  externalUrl?: string;
  description?: string;
  /** `'set'` (default) overwrites an existing task's description; `'preserve'`
   * keeps a non-empty one (background re-syncs must not clobber). */
  descriptionMode?: 'set' | 'preserve';
  labels?: string[];
  priority?: TaskRow['priority'];
  externalState?: 'open' | 'closed';
  /** The workflow a create launches; when deployed, it derives app ownership. */
  runWorkflowSlug?: string;
  /** App ownership without the run-on-create coupling — wins over the
   * `runWorkflowSlug` derivation when both are present. */
  automationSlug?: string;
  /** `'user'`: a human created the task (the owning automation becomes the
   * ASSIGNEE, not the author). Absent = derived app/agent attribution. */
  creatorType?: 'user';
  /** `'project'`: one task per issue per project; `'org'` (default): per org. */
  dedupeScope?: 'org' | 'project';
  /** `false` = update-only reconcile — never materializes a missing task. */
  createIfMissing?: boolean;
}

/**
 * On the rebuilt engine the workflow slug IS the automation's store name: a
 * DEPLOYED automation of that name owns the tasks it operates.
 */
async function automationOwnerOfWorkflowSlug(
  tx: TransactionSql,
  organizationId: string,
  workflowSlug: string,
): Promise<string | null> {
  const rows = await tx<{ name: string }[]>`
    SELECT name FROM app.automation_deployments
    WHERE org_id = ${organizationId} AND name = ${workflowSlug} LIMIT 1
  `;
  return rows.length > 0 ? workflowSlug : null;
}

/**
 * Upsert a task from an external system, keyed by the caller-owned natural
 * key within `dedupeScope`. Status policy (task-ops invariant): only the
 * workflow engine (`actorId === 'workflow'`) may COMPLETE — any other actor
 * parks an external close at `in_review`; an external reopen lifts only a
 * `done` task back to the neutral inbox (a human `cancelled` stays rejected).
 */
export async function upsertTaskByExternalRef(
  tx: TransactionSql,
  args: UpsertTaskByExternalRefArgs,
): Promise<{ taskId: string | null; created: boolean }> {
  const title =
    truncateImportedTitle(args.title) ||
    `${args.externalSystem} ${args.externalId}`;
  const description = args.description?.trim() || undefined;
  const now = Date.now();
  const createIfMissing = args.createIfMissing ?? true;

  const existing = await findTaskByExternalRef(tx, {
    organizationId: args.organizationId,
    ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
    externalSystem: args.externalSystem,
    externalId: args.externalId,
    dedupeScope: args.dedupeScope ?? 'org',
  });

  if (existing) {
    const preserveDescription =
      args.descriptionMode === 'preserve' &&
      existing.description !== null &&
      existing.description.trim() !== '';
    const labelIds =
      args.labels !== undefined
        ? ((await resolveProjectLabels(tx, {
            organizationId: args.organizationId,
            projectId: existing.projectId,
            names: args.labels,
            createdBy: args.actorId,
            createIfMissing: true,
          })) ?? [])
        : existing.labelIds;

    // Attribution backfill for a task that predates its owner — an existing
    // assignee (human triage, another app) is never clobbered.
    let assigneePatch: { assigneeType: 'app'; assigneeId: string } | null =
      null;
    if (existing.assigneeId === null) {
      const ownerAutomation =
        args.automationSlug ??
        (args.runWorkflowSlug !== undefined
          ? await automationOwnerOfWorkflowSlug(
              tx,
              args.organizationId,
              args.runWorkflowSlug,
            )
          : null);
      if (ownerAutomation !== null) {
        assigneePatch = { assigneeType: 'app', assigneeId: ownerAutomation };
      }
    }

    // The external lifecycle drives done/reopen; local triage owns the rest.
    const completingActor = args.actorId === 'workflow';
    let statusFrom: TaskStatus | undefined;
    let newStatus: TaskStatus | undefined;
    let completedAt: number | null = existing.completedAt;
    let rank = existing.rank;
    if (
      args.externalState === 'closed' &&
      !TERMINAL_STATUSES.has(existing.status)
    ) {
      newStatus = completingActor ? 'done' : 'in_review';
      statusFrom = existing.status;
      completedAt = completingActor ? now : null;
      rank = await computeEndRank(tx, existing.projectId, newStatus);
    } else if (args.externalState === 'open' && existing.status === 'done') {
      newStatus = SYNC_OPEN_STATUS;
      statusFrom = existing.status;
      completedAt = null;
      rank = await computeEndRank(tx, existing.projectId, SYNC_OPEN_STATUS);
    }

    // An external close pulling the task out of `in_review` moots any pending
    // review: no human decided it, so the request is withdrawn.
    if (newStatus !== undefined && newStatus !== existing.status) {
      await closePendingTaskReviewOnStatusLeave(tx, {
        task: existing,
        toStatus: newStatus,
        actor: { kind: 'system', actorId: args.actorId },
      });
    }

    await tx`
      UPDATE app.tasks SET
        title = ${title},
        description = ${preserveDescription ? existing.description : (description ?? null)},
        label_ids = ${labelIds},
        external_url = ${args.externalUrl ?? existing.externalUrl},
        assignee_type = ${assigneePatch?.assigneeType ?? existing.assigneeType},
        assignee_id = ${assigneePatch?.assigneeId ?? existing.assigneeId},
        status = ${newStatus ?? existing.status},
        completed_at_ms = ${completedAt},
        rank = ${rank},
        status_changed_at_ms = ${statusFrom !== undefined ? now : existing.statusChangedAt},
        updated_at_ms = ${now}
      WHERE id = ${existing.id}
    `;
    // Unconditional — a label-only reconcile no-ops the transition.
    await applyTaskCountTransition(
      tx,
      existing.projectId,
      taskCountBucket({
        status: existing.status,
        archivedAt: existing.archivedAt,
      }),
      taskCountBucket({
        status: newStatus ?? existing.status,
        archivedAt: existing.archivedAt,
      }),
    );
    if (statusFrom !== undefined && newStatus !== undefined) {
      await recordActivity(tx, {
        task: existing,
        actorType: 'agent',
        actorId: args.actorId,
        action: 'status.changed',
        fromValue: statusFrom,
        toValue: newStatus,
      });
    }
    await externalRefAudit(tx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      action: TASK_AUDIT_ACTIONS.updated,
      taskId: existing.id,
      title,
      metadata: {
        externalSystem: args.externalSystem,
        externalId: args.externalId,
      },
    });
    return { taskId: existing.id, created: false };
  }

  // No existing task. An update-only reconcile stops here; intake creates.
  if (!createIfMissing) {
    return { taskId: null, created: false };
  }
  const projectId = args.projectId;
  if (projectId === undefined) {
    throw new TaskError(
      'TASK_EXTERNAL_REF_INVALID',
      'Creating a task requires a projectId',
    );
  }
  const projects = await tx<{ id: string }[]>`
    SELECT id FROM app.projects
    WHERE id = ${projectId} AND org_id = ${args.organizationId} LIMIT 1
  `;
  if (projects.length === 0) {
    throw new TaskError('PROJECT_NOT_FOUND', 'Project not found', 404);
  }

  // Same completion invariant on CREATE: only the workflow engine lands an
  // already-closed item at `done`; anyone else inboxes it for triage.
  const status: TaskStatus =
    args.externalState === 'closed' && args.actorId === 'workflow'
      ? 'done'
      : SYNC_OPEN_STATUS;
  const rank = await computeEndRank(tx, projectId, status);
  const number = await nextTaskNumber(tx, projectId);
  const ownerAutomation =
    args.automationSlug ??
    (args.runWorkflowSlug !== undefined
      ? await automationOwnerOfWorkflowSlug(
          tx,
          args.organizationId,
          args.runWorkflowSlug,
        )
      : null);
  const createdByUser = args.creatorType === 'user';
  const labelIds =
    (await resolveProjectLabels(tx, {
      organizationId: args.organizationId,
      projectId,
      names: args.labels,
      createdBy: args.actorId,
      createIfMissing: true,
    })) ?? [];
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.tasks (
      org_id, project_id, title, description, status, priority, label_ids,
      assignee_type, assignee_id, rank, number, external_system, external_id,
      external_url, completed_at_ms, created_by, created_by_type,
      created_at_ms, updated_at_ms, status_changed_at_ms
    ) VALUES (
      ${args.organizationId}, ${projectId}, ${title}, ${description ?? null},
      ${status}, ${args.priority ?? null}, ${labelIds},
      ${ownerAutomation !== null ? 'app' : null}, ${ownerAutomation},
      ${rank}, ${number}, ${args.externalSystem}, ${args.externalId},
      ${args.externalUrl ?? null}, ${status === 'done' ? now : null},
      ${createdByUser ? args.actorId : (ownerAutomation ?? args.actorId)},
      ${createdByUser ? 'user' : ownerAutomation !== null ? 'app' : 'agent'},
      ${now}, ${now}, ${now}
    )
    RETURNING id
  `;
  const taskId = inserted[0]?.id;
  if (!taskId) {
    throw new TaskError('TASK_CREATE_FAILED', 'Insert failed');
  }
  // Read the bucket from the INSERTED state, never assume "create ⇒ open":
  // a closed external issue is materialized directly as `done`.
  await applyTaskCountTransition(
    tx,
    projectId,
    'none',
    taskCountBucket({ status, archivedAt: null }),
  );
  await recordActivity(tx, {
    task: { id: taskId, organizationId: args.organizationId, projectId },
    actorType: createdByUser ? 'user' : 'agent',
    actorId: args.actorId,
    action: 'created',
    toValue: status,
  });
  await emitEvent(tx, {
    organizationId: args.organizationId,
    eventType: 'task.created',
    eventData: {
      taskId,
      projectId,
      actorType: args.actorId === 'workflow' ? 'workflow' : 'agent',
      actorId: args.actorId,
    },
  });
  await externalRefAudit(tx, {
    organizationId: args.organizationId,
    actorId: args.actorId,
    action: TASK_AUDIT_ACTIONS.created,
    taskId,
    title,
    metadata: {
      projectId,
      externalSystem: args.externalSystem,
      externalId: args.externalId,
    },
  });
  return { taskId, created: true };
}

/**
 * Start a DEPLOYED automation with the task as its subject input. One live
 * run per (automation, task); the run is attributed to the task's project —
 * org-level automations included — which is what the task modal's live-run
 * lookup and the project run log key on. Not-deployed (and any start
 * failure) degrades to "not started" (`null`), which callers handle.
 */
export async function startWorkflowForTask(
  sql: Sql,
  args: {
    organizationId: string;
    task: Pick<
      TaskRow,
      | 'id'
      | 'title'
      | 'status'
      | 'projectId'
      | 'externalSystem'
      | 'externalId'
      | 'externalUrl'
    >;
    workflowSlug: string;
    startedByUserId: string;
    startedVia?: 'user' | 'api-key';
  },
): Promise<{ runId: string; alreadyRunning: boolean } | null> {
  try {
    const live = await sql<{ id: string }[]>`
      SELECT id FROM app.automation_runs
      WHERE org_id = ${args.organizationId} AND name = ${args.workflowSlug}
        AND status IN ('queued', 'running', 'waiting')
        AND input->'task'->>'id' = ${args.task.id}
      ORDER BY started_at_ms DESC LIMIT 1
    `;
    if (live[0] !== undefined) {
      return { runId: live[0].id, alreadyRunning: true };
    }
    const input = taskWorkflowSubjectInput({
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reused 0.4 helper wants branded Convex ids; PG ids are plain strings of the same shape
      _id: args.task.id as never,
      title: args.task.title,
      status: args.task.status,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see _id
      projectId: args.task.projectId as never,
      ...(args.task.externalSystem !== null
        ? { externalSystem: args.task.externalSystem }
        : {}),
      ...(args.task.externalId !== null
        ? { externalId: args.task.externalId }
        : {}),
      ...(args.task.externalUrl !== null
        ? { externalUrl: args.task.externalUrl }
        : {}),
    });
    const started = await beginRun(sql, {
      organizationId: args.organizationId,
      name: args.workflowSlug,
      input,
      mode: 'live',
      startedBy: `${args.startedVia ?? 'user'}:${args.startedByUserId}`,
      projectId: args.task.projectId,
    });
    if (started === null) {
      console.warn(
        '[task-workflow] start skipped — no deployed automation named',
        args.workflowSlug,
      );
      return null;
    }
    return { runId: started.runId, alreadyRunning: false };
  } catch (error) {
    console.error(
      '[task-workflow] workflow start failed',
      args.workflowSlug,
      error,
    );
    return null;
  }
}
