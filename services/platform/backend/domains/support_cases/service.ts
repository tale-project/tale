import type { Sql, TransactionSql } from 'postgres';

import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';

/**
 * Customer support portal — org-scoped cases with lifecycle, escalation,
 * SLA fields, comments, and an activity feed (mirrors the tasks shapes).
 * "Support staff" = any active org member (the 0.4 access model). Agent
 * assignees run their lanes when the agents domain lands.
 */

export const SUPPORT_CASE_SUBJECT_MAX = 200;
export const SUPPORT_CASE_DESCRIPTION_MAX = 20_000;
export const SUPPORT_CASE_COMMENT_MAX = 10_000;

export const SUPPORT_CASE_STATUSES = [
  'open',
  'pending',
  'resolved',
  'closed',
] as const;
export type SupportCaseStatus = (typeof SUPPORT_CASE_STATUSES)[number];

export const SUPPORT_CASE_PRIORITIES = [
  'low',
  'medium',
  'high',
  'urgent',
] as const;
export type SupportCasePriority = (typeof SUPPORT_CASE_PRIORITIES)[number];

export class SupportCaseError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404;

  constructor(code: string, message: string, status: 400 | 403 | 404 = 400) {
    super(message);
    this.name = 'SupportCaseError';
    this.code = code;
    this.status = status;
  }
}

export interface SupportScope {
  organizationId: string;
  userId: string;
  email?: string;
}

export interface SupportCaseRow {
  id: string;
  organizationId: string;
  subject: string;
  description: string | null;
  status: SupportCaseStatus;
  priority: SupportCasePriority | null;
  escalationLevel: number | null;
  assigneeType: string | null;
  assigneeId: string | null;
  contactId: string | null;
  requesterEmail: string | null;
  requesterName: string | null;
  slaDueAt: number | null;
  firstRespondedAt: number | null;
  resolvedAt: number | null;
  closedAt: number | null;
  commentCount: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

const CASE_COLUMNS = `
  id, org_id AS "organizationId", subject, description, status, priority,
  escalation_level AS "escalationLevel", assignee_type AS "assigneeType",
  assignee_id AS "assigneeId", contact_id AS "contactId",
  requester_email AS "requesterEmail", requester_name AS "requesterName",
  sla_due_at_ms::float8 AS "slaDueAt",
  first_responded_at_ms::float8 AS "firstRespondedAt",
  resolved_at_ms::float8 AS "resolvedAt", closed_at_ms::float8 AS "closedAt",
  comment_count AS "commentCount", created_by AS "createdBy",
  created_at_ms::float8 AS "createdAt", updated_at_ms::float8 AS "updatedAt",
  archived_at_ms::float8 AS "archivedAt"
`;

function validateSubject(raw: string): string {
  const subject = raw.trim();
  if (subject.length === 0 || subject.length > SUPPORT_CASE_SUBJECT_MAX) {
    throw new SupportCaseError('invalid_subject', 'Invalid case subject');
  }
  return subject;
}

async function loadCaseOrThrow(
  sql: Sql | TransactionSql,
  scope: SupportScope,
  caseId: string,
): Promise<SupportCaseRow> {
  const rows = await sql<SupportCaseRow[]>`
    SELECT ${sql.unsafe(CASE_COLUMNS)} FROM app.support_cases
    WHERE id = ${caseId} AND org_id = ${scope.organizationId} LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw new SupportCaseError('CASE_NOT_FOUND', 'Case not found', 404);
  }
  return row;
}

async function recordCaseActivity(
  tx: TransactionSql,
  scope: SupportScope,
  caseId: string,
  action: string,
  fromValue?: string,
  toValue?: string,
): Promise<void> {
  await tx`
    INSERT INTO app.support_case_activity (
      org_id, case_id, actor_type, actor_id, action, from_value, to_value,
      created_at_ms
    ) VALUES (
      ${scope.organizationId}, ${caseId}, 'user', ${scope.userId}, ${action},
      ${fromValue ?? null}, ${toValue ?? null}, ${Date.now()}
    )
  `;
}

export async function createSupportCase(
  tx: TransactionSql,
  scope: SupportScope,
  args: {
    subject: string;
    description?: string;
    priority?: SupportCasePriority;
    contactId?: string;
    requesterEmail?: string;
    requesterName?: string;
    slaDueAt?: number;
  },
): Promise<string> {
  const subject = validateSubject(args.subject);
  if ((args.description?.length ?? 0) > SUPPORT_CASE_DESCRIPTION_MAX) {
    throw new SupportCaseError('description_too_long', 'Description too long');
  }
  const now = Date.now();
  const rows = await tx<{ id: string }[]>`
    INSERT INTO app.support_cases (
      org_id, subject, description, status, priority, contact_id,
      requester_email, requester_name, sla_due_at_ms, created_by,
      created_by_type, created_at_ms, updated_at_ms, status_changed_at_ms
    ) VALUES (
      ${scope.organizationId}, ${subject}, ${args.description ?? null},
      'open', ${args.priority ?? null}, ${args.contactId ?? null},
      ${args.requesterEmail ?? null}, ${args.requesterName ?? null},
      ${args.slaDueAt ?? null}, ${scope.userId}, 'user', ${now}, ${now}, ${now}
    )
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) {
    throw new SupportCaseError('CASE_CREATE_FAILED', 'Insert failed');
  }
  await recordCaseActivity(tx, scope, id, 'created', undefined, 'open');
  await createAuditLog(tx, {
    organizationId: scope.organizationId,
    actorId: scope.userId,
    ...(scope.email !== undefined ? { actorEmail: scope.email } : {}),
    actorType: 'user',
    action: 'support_case.created',
    category: 'data',
    resourceType: 'support_case',
    resourceId: id,
    resourceName: subject,
    status: 'success',
  });
  await emitHintInTx(tx, {
    orgId: scope.organizationId,
    entity: 'support_case',
    entityId: id,
  });
  return id;
}

const STATUS_TIMESTAMP_COLUMN: Record<SupportCaseStatus, string | null> = {
  open: null,
  pending: null,
  resolved: 'resolved_at_ms',
  closed: 'closed_at_ms',
};

export async function updateSupportCaseStatus(
  tx: TransactionSql,
  scope: SupportScope,
  caseId: string,
  status: SupportCaseStatus,
): Promise<void> {
  const row = await loadCaseOrThrow(tx, scope, caseId);
  if (row.status === status) {
    return;
  }
  const now = Date.now();
  const stampColumn = STATUS_TIMESTAMP_COLUMN[status];
  await tx`
    UPDATE app.support_cases SET
      status = ${status}, status_changed_at_ms = ${now}, updated_at_ms = ${now}
    WHERE id = ${caseId}
  `;
  if (stampColumn !== null) {
    // Column names come from the closed map above, never from input.
    await tx.unsafe(
      `UPDATE app.support_cases SET ${stampColumn} = $1 WHERE id = $2 AND ${stampColumn} IS NULL`,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- positional params
      [now, caseId] as never[],
    );
  }
  await recordCaseActivity(
    tx,
    scope,
    caseId,
    'status.changed',
    row.status,
    status,
  );
  await emitHintInTx(tx, {
    orgId: scope.organizationId,
    entity: 'support_case',
    entityId: caseId,
  });
}

export async function assignSupportCase(
  tx: TransactionSql,
  scope: SupportScope,
  caseId: string,
  assignee: { assigneeType: 'user' | 'agent'; assigneeId: string } | null,
): Promise<void> {
  const row = await loadCaseOrThrow(tx, scope, caseId);
  await tx`
    UPDATE app.support_cases SET
      assignee_type = ${assignee?.assigneeType ?? null},
      assignee_id = ${assignee?.assigneeId ?? null},
      updated_at_ms = ${Date.now()}
    WHERE id = ${caseId}
  `;
  await recordCaseActivity(
    tx,
    scope,
    caseId,
    'assignee.changed',
    row.assigneeId ?? undefined,
    assignee?.assigneeId,
  );
  await emitHintInTx(tx, {
    orgId: scope.organizationId,
    entity: 'support_case',
    entityId: caseId,
  });
}

export async function escalateSupportCase(
  tx: TransactionSql,
  scope: SupportScope,
  caseId: string,
): Promise<number> {
  const row = await loadCaseOrThrow(tx, scope, caseId);
  const level = (row.escalationLevel ?? 0) + 1;
  await tx`
    UPDATE app.support_cases SET
      escalation_level = ${level}, escalated_at_ms = ${Date.now()},
      updated_at_ms = ${Date.now()}
    WHERE id = ${caseId}
  `;
  await recordCaseActivity(
    tx,
    scope,
    caseId,
    'escalated',
    String(row.escalationLevel ?? 0),
    String(level),
  );
  await emitHintInTx(tx, {
    orgId: scope.organizationId,
    entity: 'support_case',
    entityId: caseId,
  });
  return level;
}

export async function addSupportCaseComment(
  tx: TransactionSql,
  scope: SupportScope,
  args: { caseId: string; body: string; internal?: boolean },
): Promise<string> {
  const row = await loadCaseOrThrow(tx, scope, args.caseId);
  const body = args.body.trim();
  if (body.length === 0 || body.length > SUPPORT_CASE_COMMENT_MAX) {
    throw new SupportCaseError('invalid_comment', 'Invalid comment body');
  }
  const now = Date.now();
  const rows = await tx<{ id: string }[]>`
    INSERT INTO app.support_case_comments (
      org_id, case_id, author_type, author_id, body, internal, created_at_ms
    ) VALUES (
      ${scope.organizationId}, ${args.caseId}, 'user', ${scope.userId},
      ${body}, ${args.internal ?? null}, ${now}
    )
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) {
    throw new SupportCaseError('COMMENT_CREATE_FAILED', 'Insert failed');
  }
  await tx`
    UPDATE app.support_cases SET
      comment_count = comment_count + 1,
      first_responded_at_ms = coalesce(first_responded_at_ms, ${now}),
      updated_at_ms = ${now}
    WHERE id = ${args.caseId}
  `;
  await recordCaseActivity(tx, scope, args.caseId, 'comment.added');
  await emitHintInTx(tx, {
    orgId: scope.organizationId,
    entity: 'support_case',
    entityId: row.id,
  });
  return id;
}

export async function getSupportCase(
  sql: Sql,
  scope: SupportScope,
  caseId: string,
): Promise<{
  supportCase: SupportCaseRow;
  comments: {
    id: string;
    authorType: string;
    authorId: string;
    body: string;
    internal: boolean | null;
    createdAt: number;
  }[];
  activity: {
    action: string;
    actorId: string;
    fromValue: string | null;
    toValue: string | null;
    createdAt: number;
  }[];
}> {
  const supportCase = await loadCaseOrThrow(sql, scope, caseId);
  const comments = await sql<
    {
      id: string;
      authorType: string;
      authorId: string;
      body: string;
      internal: boolean | null;
      createdAt: number;
    }[]
  >`
    SELECT id, author_type AS "authorType", author_id AS "authorId", body,
           internal, created_at_ms::float8 AS "createdAt"
    FROM app.support_case_comments
    WHERE case_id = ${caseId}
    ORDER BY created_at_ms ASC
  `;
  const activity = await sql<
    {
      action: string;
      actorId: string;
      fromValue: string | null;
      toValue: string | null;
      createdAt: number;
    }[]
  >`
    SELECT action, actor_id AS "actorId", from_value AS "fromValue",
           to_value AS "toValue", created_at_ms::float8 AS "createdAt"
    FROM app.support_case_activity
    WHERE case_id = ${caseId}
    ORDER BY created_at_ms ASC
  `;
  return { supportCase, comments, activity };
}

export async function listSupportCases(
  sql: Sql,
  scope: SupportScope,
  options: {
    status?: SupportCaseStatus;
    includeArchived?: boolean;
    limit?: number;
  } = {},
): Promise<SupportCaseRow[]> {
  const limit = Math.min(options.limit ?? 100, 500);
  return sql<SupportCaseRow[]>`
    SELECT ${sql.unsafe(CASE_COLUMNS)} FROM app.support_cases
    WHERE org_id = ${scope.organizationId}
      AND (${options.includeArchived ?? false} OR archived_at_ms IS NULL)
      AND (${options.status ?? null}::text IS NULL OR status = ${options.status ?? null})
    ORDER BY updated_at_ms DESC
    LIMIT ${limit}
  `;
}

export async function archiveSupportCase(
  tx: TransactionSql,
  scope: SupportScope,
  caseId: string,
): Promise<void> {
  await loadCaseOrThrow(tx, scope, caseId);
  await tx`
    UPDATE app.support_cases SET
      archived_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
    WHERE id = ${caseId}
  `;
  await recordCaseActivity(tx, scope, caseId, 'archived');
}
