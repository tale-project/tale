import { epochMsSchema } from '@tale/shared/schemas/epoch-ms';
import {
  externalStatusDecisionSchema,
  externalStatusRequestValues,
  externalStatusWorkflowSchema,
  taskLifecycleRevisionSchema,
  type ExternalStatusDecision,
  type ExternalStatusRequestInput,
  type ExternalStatusWorkflow,
} from '@tale/shared/schemas/task-external-status';
import { computeContentHash } from '@tale/shared/utils/hashing';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { externalKeySchema } from '../../../lib/shared/utils/external-key.ts';
import { stableStringify } from '../../../lib/shared/utils/stable-stringify.ts';
import { TASK_AUDIT_ACTIONS } from '../../core/tasks/audit_actions.ts';
import { toJson } from '../../db/sql.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  loadProjectOrThrow,
  type ProjectAuthContext,
} from '../projects/service.ts';
import { hasPendingAgentReviewForTask } from './reviews.ts';
import {
  applyExternalTaskStatusProjection,
  assertTaskWorkable,
  recordActivity,
  taskAudit,
  TASK_COLUMNS,
  TASK_STATUSES,
  TaskError,
  type TaskRow,
  type TaskStatus,
} from './service.ts';

export const externalTaskStatusBodySchema = z
  .strictObject({
    externalSystem: externalKeySchema(100),
    externalId: externalKeySchema(500),
    expectedRevision: taskLifecycleRevisionSchema,
    sourceRevision: z.string().min(1).max(512),
    sourceStatusAt: epochMsSchema,
    status: z.enum(TASK_STATUSES),
    archived: z.boolean().optional(),
    workflow: externalStatusWorkflowSchema.optional(),
    requestId: z.uuid().optional(),
    decision: externalStatusDecisionSchema.optional(),
  })
  .refine(
    (input) =>
      (input.requestId === undefined) === (input.decision === undefined),
    { message: 'requestId and decision must be supplied together' },
  );
export type ExternalTaskStatusInput = z.infer<
  typeof externalTaskStatusBodySchema
>;

export interface ExternalTaskStatusReceipt {
  sourceRevision: string;
  sourceStatusAt: number;
  status: TaskStatus;
  archived: boolean;
}

export interface TaskStatusSnapshot {
  task: {
    id: string;
    status: TaskStatus;
    archivedAt?: number;
    externalSystem?: string;
    externalId?: string;
  };
  /** Decimal activity sequence: status, archival, and source transition intent. */
  revision: string;
  statusChangedAt: number | null;
  /** Latest actual status actor; a later archive cannot impersonate them. */
  change: {
    id: string;
    action: string;
    createdAt: number;
    origin: 'native' | 'external';
    actor: {
      type: 'user' | 'agent';
      userId: string;
      email?: string;
      emailVerified: boolean;
      activeMember: boolean;
    };
  } | null;
  externalStatus: ExternalTaskStatusReceipt | null;
  workflow: ExternalStatusWorkflow | null;
  request: {
    id: string;
    revision: string;
    statusChangeId: string;
    actionId: string;
    status: TaskStatus;
    input: Record<string, string | number | boolean>;
    sourceRevision: string;
    sourceStatusAt: number;
    createdAt: number;
    actor: NonNullable<TaskStatusSnapshot['change']>['actor'];
    decision: ExternalStatusDecision | null;
  } | null;
}

interface StatusSnapshotRow {
  id: string;
  status: TaskStatus;
  archivedAt: number | null;
  externalSystem: string | null;
  externalId: string | null;
  statusChangedAt: number | null;
  revisionId: string | null;
  changeId: string | null;
  action: string | null;
  changeAt: number | null;
  actorType: 'user' | 'agent' | null;
  actorId: string | null;
  context: unknown;
  actorEmail: string | null;
  emailVerified: boolean;
  activeMember: boolean;
  sourceRevision: string | null;
  sourceStatusAt: number | null;
  sourceStatus: TaskStatus | null;
  sourceArchived: boolean | null;
  workflow: unknown;
  requestId: string | null;
  requestRevision: string | null;
  requestStatusChangeId: string | null;
  requestActionId: string | null;
  requestStatus: TaskStatus | null;
  requestInput: Record<string, string | number | boolean> | null;
  requestSourceRevision: string | null;
  requestSourceStatusAt: number | null;
  requestCreatedAt: number | null;
  requestActorId: string | null;
  requestActorEmail: string | null;
  requestEmailVerified: boolean;
  requestActiveMember: boolean;
  requestDecision: unknown;
}

/** One statement observes state, ordering, provenance and receipt together. An
 * actor's immutable id stays visible, but their address is relayed only while
 * they are an active verified member of this organization. */
export async function readTaskStatusSnapshot(
  sql: Sql | TransactionSql,
  organizationId: string,
  taskId: string,
): Promise<TaskStatusSnapshot> {
  const rows = await sql<StatusSnapshotRow[]>`
    SELECT t.id, t.status, t.archived_at_ms::float8 AS "archivedAt",
      t.external_system AS "externalSystem", t.external_id AS "externalId",
      t.status_changed_at_ms::float8 AS "statusChangedAt",
      lifecycle.id::text AS "revisionId",
      a.id::text AS "changeId", a.action, a.created_at_ms::float8 AS "changeAt",
      a.actor_type AS "actorType", a.actor_id AS "actorId", a.context,
      lower(u.email) AS "actorEmail", COALESCE(u."emailVerified", false) AS "emailVerified",
      (m.id IS NOT NULL AND lower(m.role) <> 'disabled') AS "activeMember",
      p.source_revision AS "sourceRevision", p.source_status_at_ms::float8 AS "sourceStatusAt",
      p.status AS "sourceStatus", p.archived AS "sourceArchived", p.workflow,
      r.id AS "requestId", r.revision::text AS "requestRevision", r.status_change_id::text AS "requestStatusChangeId", r.action_id AS "requestActionId",
      r.status AS "requestStatus", r.input AS "requestInput", r.source_revision AS "requestSourceRevision",
      r.source_status_at_ms::float8 AS "requestSourceStatusAt", r.created_at_ms::float8 AS "requestCreatedAt",
      r.actor_id AS "requestActorId", lower(ru.email) AS "requestActorEmail",
      COALESCE(ru."emailVerified", false) AS "requestEmailVerified",
      (rm.id IS NOT NULL AND lower(rm.role) <> 'disabled') AS "requestActiveMember", r.decision AS "requestDecision"
    FROM app.tasks t
    LEFT JOIN LATERAL (
      SELECT id, action, created_at_ms, actor_type, actor_id, context
      FROM app.task_activity
      WHERE task_id = t.id AND org_id = t.org_id
        AND action IN ('created', 'status.changed', 'external_status.projected')
      ORDER BY id DESC LIMIT 1
    ) a ON true
    LEFT JOIN LATERAL (
      SELECT id FROM app.task_activity
      WHERE task_id = t.id AND org_id = t.org_id
        AND action IN ('created', 'status.changed', 'archived', 'restored', 'external_status.projected', 'external_status.requested')
      ORDER BY id DESC LIMIT 1
    ) lifecycle ON true
    LEFT JOIN "user" u ON a.actor_type = 'user' AND u.id = a.actor_id
    LEFT JOIN "member" m ON m."userId" = u.id AND m."organizationId" = t.org_id
    LEFT JOIN app.task_external_status p ON p.task_id = t.id AND p.org_id = t.org_id
      AND p.external_system = t.external_system AND p.external_id = t.external_id
    LEFT JOIN LATERAL (
      SELECT * FROM app.task_external_status_requests
      WHERE task_id = t.id AND org_id = t.org_id
        AND external_system = t.external_system AND external_id = t.external_id
      ORDER BY revision DESC LIMIT 1
    ) r ON true
    LEFT JOIN "user" ru ON ru.id = r.actor_id
    LEFT JOIN "member" rm ON rm."userId" = ru.id AND rm."organizationId" = t.org_id
    WHERE t.id = ${taskId} AND t.org_id = ${organizationId}
  `;
  const row = rows[0];
  if (row === undefined) {
    throw new TaskError('TASK_NOT_FOUND', 'Task not found', 404);
  }
  const externalOrigin =
    row.context !== null &&
    typeof row.context === 'object' &&
    'externalStatusProjection' in row.context;
  const workflow = externalStatusWorkflowSchema.safeParse(row.workflow);
  const decision = externalStatusDecisionSchema.safeParse(row.requestDecision);
  return {
    task: {
      id: row.id,
      status: row.status,
      ...(row.archivedAt !== null ? { archivedAt: row.archivedAt } : {}),
      ...(row.externalSystem !== null
        ? { externalSystem: row.externalSystem }
        : {}),
      ...(row.externalId !== null ? { externalId: row.externalId } : {}),
    },
    revision: row.revisionId ?? '0',
    statusChangedAt: row.statusChangedAt,
    change:
      row.changeId !== null && row.actorType !== null && row.actorId !== null
        ? {
            id: row.changeId,
            action: row.action ?? '',
            createdAt: row.changeAt ?? 0,
            origin: externalOrigin ? 'external' : 'native',
            actor: {
              type: row.actorType,
              userId: row.actorId,
              ...(row.emailVerified &&
              row.activeMember &&
              row.actorEmail !== null
                ? { email: row.actorEmail }
                : {}),
              emailVerified: row.emailVerified,
              activeMember: row.activeMember,
            },
          }
        : null,
    externalStatus:
      row.sourceRevision !== null &&
      row.sourceStatusAt !== null &&
      row.sourceStatus !== null &&
      row.sourceArchived !== null
        ? {
            sourceRevision: row.sourceRevision,
            sourceStatusAt: row.sourceStatusAt,
            status: row.sourceStatus,
            archived: row.sourceArchived,
          }
        : null,
    workflow: workflow.success ? workflow.data : null,
    request:
      row.requestId != null &&
      row.requestRevision != null &&
      row.requestActionId != null &&
      row.requestStatus != null &&
      row.requestInput != null &&
      row.requestSourceRevision != null &&
      row.requestSourceStatusAt != null &&
      row.requestActorId != null
        ? {
            id: row.requestId,
            revision: row.requestRevision,
            statusChangeId: row.requestStatusChangeId ?? '0',
            actionId: row.requestActionId,
            status: row.requestStatus,
            input: row.requestInput,
            sourceRevision: row.requestSourceRevision,
            sourceStatusAt: row.requestSourceStatusAt,
            createdAt: row.requestCreatedAt ?? 0,
            actor: {
              type: 'user',
              userId: row.requestActorId,
              emailVerified: row.requestEmailVerified,
              activeMember: row.requestActiveMember,
              ...(row.requestEmailVerified &&
              row.requestActiveMember &&
              row.requestActorEmail != null
                ? { email: row.requestActorEmail }
                : {}),
            },
            decision: decision.success ? decision.data : null,
          }
        : null,
  };
}

/** This door is mounted only behind the native session middleware. Neither an
 * API key nor the payload can choose the person whose transition is proposed. */
export async function requestExternalTaskStatus(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  taskId: string,
  input: ExternalStatusRequestInput,
): Promise<TaskStatusSnapshot> {
  const rows = await tx<
    TaskRow[]
  >`SELECT ${tx.unsafe(TASK_COLUMNS)} FROM app.tasks WHERE id = ${taskId} AND org_id = ${auth.organizationId} FOR UPDATE`;
  const task = rows[0];
  if (task === undefined)
    throw new TaskError('TASK_NOT_FOUND', 'Task not found', 404);
  const project = await loadProjectOrThrow(tx, task.projectId);
  await assertTaskWorkable(tx, project, task, auth);
  const actors = await tx<{ verified: boolean }[]>`
    SELECT (u."emailVerified" AND lower(m.role) <> 'disabled') AS verified
    FROM "user" u JOIN "member" m ON m."userId" = u.id
    WHERE u.id = ${auth.userId} AND m."organizationId" = ${auth.organizationId}
  `;
  if (!actors[0]?.verified)
    throw new TaskError(
      'TASK_FORBIDDEN',
      'A verified active member must submit a source transition',
      403,
    );
  const hash = computeContentHash(
    stableStringify({ taskId, actorId: auth.userId, input }),
  );
  const previous = await tx<{ requestHash: string; actorId: string }[]>`
    SELECT request_hash AS "requestHash", actor_id AS "actorId" FROM app.task_external_status_requests
    WHERE id = ${input.requestId} AND org_id = ${auth.organizationId} AND task_id = ${taskId}
  `;
  if (previous[0] !== undefined) {
    if (previous[0].requestHash !== hash || previous[0].actorId !== auth.userId)
      throw new TaskError(
        'TASK_STATUS_CONFLICT',
        'This request id was already used with different transition input',
        409,
      );
    return readTaskStatusSnapshot(tx, auth.organizationId, taskId);
  }
  const current = await readTaskStatusSnapshot(tx, auth.organizationId, taskId);
  if (
    current.revision !== input.expectedRevision ||
    current.externalStatus?.sourceRevision !== input.expectedSourceRevision
  )
    throw new TaskError(
      'TASK_STATUS_CONFLICT',
      'The task or source form changed; reopen the form before requesting a transition',
      409,
    );
  if (
    current.externalStatus === null ||
    current.workflow === null ||
    task.externalSystem === null ||
    task.externalId === null ||
    task.externalIssue != null ||
    ['github', 'glitchtip'].includes(task.externalSystem.toLowerCase())
  )
    throw new TaskError(
      'TASK_EXTERNAL_REF_INVALID',
      'This task has no source-declared transition form',
      409,
    );
  if (current.request !== null && current.request.decision === null)
    throw new TaskError(
      'TASK_STATUS_CONFLICT',
      'The source is still validating the previous transition request',
      409,
    );
  if (await hasPendingAgentReviewForTask(tx, auth.organizationId, taskId))
    throw new TaskError(
      'TASK_AGENT_REVIEW_REQUIRED',
      'A native agent review must be resolved before requesting source status',
      409,
    );
  const action = current.workflow.actions.find(
    (candidate) => candidate.id === input.actionId,
  );
  if (action === undefined)
    throw new TaskError(
      'TASK_STATUS_CONFLICT',
      'The source no longer offers this transition; reopen the form',
      409,
    );
  let values: Record<string, string | number | boolean>;
  try {
    values = externalStatusRequestValues(action, input.values);
  } catch {
    throw new TaskError(
      'INVALID_BODY',
      'Complete the declared source fields with valid values',
      400,
    );
  }
  await recordActivity(tx, {
    task,
    actorType: 'user',
    actorId: auth.userId,
    action: 'external_status.requested',
    toValue: action.status,
    context: {
      externalStatusRequest: {
        id: input.requestId,
        sourceRevision: current.externalStatus.sourceRevision,
        sourceStatusAt: current.externalStatus.sourceStatusAt,
        actionId: action.id,
        input: values,
      },
    },
  });
  const afterActivity = await readTaskStatusSnapshot(
    tx,
    auth.organizationId,
    taskId,
  );
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.task_external_status_requests (id, task_id, org_id, external_system, external_id, request_hash, actor_id, source_revision, source_status_at_ms, action_id, status, input, revision, status_change_id, created_at_ms)
    VALUES (${input.requestId}, ${taskId}, ${auth.organizationId}, ${task.externalSystem}, ${task.externalId}, ${hash}, ${auth.userId}, ${current.externalStatus.sourceRevision}, ${current.externalStatus.sourceStatusAt}, ${action.id}, ${action.status}, ${tx.json(values)}, ${afterActivity.revision}, ${current.change?.id ?? '0'}, ${Date.now()})
    ON CONFLICT (id) DO NOTHING RETURNING id
  `;
  if (inserted.length !== 1)
    throw new TaskError(
      'TASK_STATUS_CONFLICT',
      'This request id is already in use',
      409,
    );
  await createAuditLog(
    tx,
    taskAudit(auth, task, TASK_AUDIT_ACTIONS.externalStatusRequested, {
      metadata: {
        requestId: input.requestId,
        actionId: action.id,
        sourceRevision: current.externalStatus.sourceRevision,
        revision: afterActivity.revision,
      },
    }),
  );
  return readTaskStatusSnapshot(tx, auth.organizationId, taskId);
}

/** Explicit opt-in for a custom mirror whose business system validates every
 * transition. Only this lane projects source-approved completion: generic
 * agents and issue importers keep their native triage and review safeguards. */
export async function projectExternalTaskStatus(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: { projectId: string; taskId: string; input: ExternalTaskStatusInput },
): Promise<TaskStatusSnapshot> {
  const project = await loadProjectOrThrow(tx, args.projectId);
  if (project.organizationId !== auth.organizationId) {
    throw new TaskError('PROJECT_NOT_FOUND', 'Project not found', 404);
  }
  const rows = await tx<TaskRow[]>`
    SELECT ${tx.unsafe(TASK_COLUMNS)} FROM app.tasks
    WHERE id = ${args.taskId} AND org_id = ${auth.organizationId} FOR UPDATE
  `;
  const task = rows[0];
  if (task === undefined || task.projectId !== args.projectId) {
    throw new TaskError('TASK_NOT_FOUND', 'Task not found', 404);
  }
  await assertTaskWorkable(tx, project, task, auth);
  const { input } = args;
  if (
    task.externalSystem !== input.externalSystem ||
    task.externalId !== input.externalId ||
    input.externalSystem.toLowerCase() === 'github' ||
    input.externalSystem.toLowerCase() === 'glitchtip' ||
    task.externalIssue != null
  ) {
    throw new TaskError(
      'TASK_EXTERNAL_REF_INVALID',
      'Accepted source status requires this task’s exact custom external reference',
      409,
    );
  }
  const current = await readTaskStatusSnapshot(
    tx,
    auth.organizationId,
    task.id,
  );
  const archived = input.archived ?? task.archivedAt !== null;
  const receipt = current.externalStatus;
  if (await hasPendingAgentReviewForTask(tx, auth.organizationId, task.id)) {
    throw new TaskError(
      'TASK_AGENT_REVIEW_REQUIRED',
      'A native agent review must be resolved or explicitly transferred before projecting source status',
      409,
    );
  }
  const workflow = input.workflow ?? current.workflow;
  let existingDecision: ExternalStatusDecision | null = null;
  if (input.requestId !== undefined && input.decision !== undefined) {
    const requests = await tx<{ decision: unknown }[]>`
      SELECT decision FROM app.task_external_status_requests
      WHERE id = ${input.requestId} AND task_id = ${task.id} AND org_id = ${auth.organizationId}
        AND external_system = ${input.externalSystem} AND external_id = ${input.externalId}
      FOR UPDATE
    `;
    if (requests[0] === undefined)
      throw new TaskError(
        'TASK_STATUS_CONFLICT',
        'The source decision does not name a transition request for this task',
        409,
      );
    const stored = externalStatusDecisionSchema.safeParse(requests[0].decision);
    existingDecision = stored.success ? stored.data : null;
    if (
      existingDecision !== null &&
      stableStringify(existingDecision) !== stableStringify(input.decision)
    )
      throw new TaskError(
        'TASK_STATUS_CONFLICT',
        'The immutable transition request already has a different source decision',
        409,
      );
  }
  if (
    receipt !== null &&
    (input.sourceStatusAt < receipt.sourceStatusAt ||
      (input.sourceStatusAt === receipt.sourceStatusAt &&
        (input.status !== receipt.status || archived !== receipt.archived)))
  ) {
    throw new TaskError(
      'TASK_EXTERNAL_STATUS_STALE',
      'A newer source lifecycle is already recorded; read and validate the current source state',
      409,
    );
  }
  const sameReceipt =
    receipt !== null &&
    receipt.sourceRevision === input.sourceRevision &&
    receipt.sourceStatusAt === input.sourceStatusAt &&
    receipt.status === input.status &&
    receipt.archived === archived &&
    stableStringify(workflow) === stableStringify(current.workflow) &&
    (input.decision === undefined || existingDecision !== null);
  if (
    sameReceipt &&
    task.status === input.status &&
    (task.archivedAt !== null) === archived
  ) {
    const applied = await tx<{ revision: string }[]>`
      SELECT applied_revision::text AS revision FROM app.task_external_status
      WHERE task_id = ${task.id} AND org_id = ${auth.organizationId}
    `;
    // Lost-reply replay is a no-op only while this receipt is still the latest
    // lifecycle activity. A later native move, even back to the same column,
    // must reach the source validator before an old request can be accepted.
    if (applied[0]?.revision === current.revision) return current;
  }
  if (input.expectedRevision !== current.revision) {
    throw new TaskError(
      'TASK_STATUS_CONFLICT',
      'Task status or archival changed; read it again before projecting a source decision',
      409,
    );
  }
  if (
    sameReceipt &&
    existingDecision !== null &&
    input.requestId !== current.request?.id &&
    task.status === input.status &&
    (task.archivedAt !== null) === archived
  ) {
    // A delayed replay of an older, already settled fact must not manufacture
    // a newer projection activity over the currently pending form. Its ledger
    // decision is already durable; fresh CAS confirms that no state is written.
    return current;
  }
  const evidence = {
    externalSystem: input.externalSystem,
    externalId: input.externalId,
    sourceRevision: input.sourceRevision,
    sourceStatusAt: input.sourceStatusAt,
    ...(input.requestId !== undefined
      ? { requestId: input.requestId, decision: input.decision }
      : {}),
  };
  await applyExternalTaskStatusProjection(tx, {
    task,
    actorId: auth.userId,
    status: input.status,
    archived,
    context: { externalStatusProjection: evidence },
  });
  const projected = await readTaskStatusSnapshot(
    tx,
    auth.organizationId,
    task.id,
  );
  await tx`
    INSERT INTO app.task_external_status (
      task_id, org_id, external_system, external_id, source_revision,
      source_status_at_ms, status, archived, applied_revision, updated_at_ms, workflow
    ) VALUES (
      ${task.id}, ${auth.organizationId}, ${input.externalSystem}, ${input.externalId},
      ${input.sourceRevision}, ${input.sourceStatusAt}, ${input.status}, ${archived},
      ${projected.revision}, ${Date.now()}, ${workflow === null ? null : tx.json(toJson(workflow))}
    ) ON CONFLICT (task_id) DO UPDATE SET
      external_system = EXCLUDED.external_system, external_id = EXCLUDED.external_id,
      source_revision = EXCLUDED.source_revision, source_status_at_ms = EXCLUDED.source_status_at_ms,
      status = EXCLUDED.status, archived = EXCLUDED.archived,
      workflow = EXCLUDED.workflow,
      applied_revision = EXCLUDED.applied_revision, updated_at_ms = EXCLUDED.updated_at_ms
    WHERE app.task_external_status.org_id = EXCLUDED.org_id
  `;
  if (
    input.requestId !== undefined &&
    input.decision !== undefined &&
    existingDecision === null
  ) {
    // A lost source reply can be acknowledged after a later board move, under
    // the fresh native CAS. The decision remains attached to its immutable
    // request; acknowledging an older fact cannot replace a newer request.
    await tx`
      UPDATE app.task_external_status_requests SET decision = ${tx.json(toJson(input.decision))}, decided_at_ms = ${Date.now()}
      WHERE id = ${input.requestId} AND task_id = ${task.id} AND org_id = ${auth.organizationId}
        AND external_system = ${input.externalSystem} AND external_id = ${input.externalId} AND decision IS NULL
    `;
  }
  await createAuditLog(tx, {
    organizationId: auth.organizationId,
    actorId: auth.userId,
    actorType: 'api',
    action: TASK_AUDIT_ACTIONS.externalStatusProjected,
    category: 'data',
    resourceType: 'task',
    resourceId: task.id,
    resourceName: task.title,
    previousState: { status: task.status, archived: task.archivedAt !== null },
    newState: { status: input.status, archived },
    metadata: {
      ...evidence,
      expectedRevision: input.expectedRevision,
      revision: projected.revision,
    },
    status: 'success',
  });
  return readTaskStatusSnapshot(tx, auth.organizationId, task.id);
}
