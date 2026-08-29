import type { Sql } from 'postgres';

import { isAdminRole } from '../../auth/membership.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { checkOrganizationRateLimit } from '../../lib/rate-limit.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { loadActiveHolds } from '../legal_holds/service.ts';

/**
 * GDPR Art 17 erasure — the 0.5 twin of `convex/governance/erasure*`:
 * an admin files against a SUBJECT (never themselves — self-erasure could
 * wipe the audit evidence of the filer's own actions); the receipt row is
 * inserted BEFORE the hold gate so a refusal under Art 17(3)(e) is itself
 * durable ('blocked'); the cascade runs after the org's DSAR cooling-off
 * window and erases the subject's rows table by table, scrubbing (never
 * deleting) their audit trail — the row's existence remains per Art
 * 17(3)(b), its PII body goes, `pii_scrubbed` marks the intentional hash
 * divergence (the 0.4 signed-checkpoint window collapses to this flag +
 * the receipt + the gdpr audit rows — rule 5).
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SLA_DAYS = 30;

export class ErasureError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409 | 429;
  /** Extra machine-readable fields the UI reads off the error payload
   * (e.g. the blocked receipt's `requestId`). */
  readonly data: Record<string, string | number | boolean>;
  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 | 429 = 400,
    data: Record<string, string | number | boolean> = {},
  ) {
    super(message);
    this.name = 'ErasureError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

export const ERASURE_REASON_CODES = [
  'consent_withdrawn',
  'no_longer_necessary',
  'unlawful_processing',
  'legal_obligation',
  'objection',
  'child_consent',
  'contract_termination',
] as const;

async function dsarPolicy(sql: Sql, organizationId: string) {
  const config = await readGovernancePolicyForOrg(
    sql,
    organizationId,
    'dsar_governance',
  );
  return {
    coolingOffHours: config?.coolingOffHours ?? 24,
    dailyLimitPerAdmin: config?.dailyLimitPerAdmin ?? 5,
  };
}

export async function requestErasure(
  sql: Sql,
  args: {
    organizationId: string;
    actorId: string;
    actorEmail?: string;
    targetUserId: string;
    reason: string;
    reasonCode: string;
  },
): Promise<{ requestId: string; threadsTargeted: number }> {
  const deny = async (errorMessage: string): Promise<never> => {
    // Surface privilege-escalation attempts via the audit trail.
    await sql.begin((tx) =>
      createAuditLog(tx, {
        organizationId: args.organizationId,
        actorId: args.actorId,
        ...(args.actorEmail !== undefined
          ? { actorEmail: args.actorEmail }
          : {}),
        actorType: 'user',
        action: 'gdpr_erasure_denied',
        category: 'admin',
        resourceType: 'user',
        resourceId: args.targetUserId,
        status: 'denied',
        errorMessage,
      }),
    );
    throw new ErasureError('forbidden', errorMessage, 403);
  };
  const members = await sql<{ role: string }[]>`
    SELECT "role" FROM "member"
    WHERE "organizationId" = ${args.organizationId}
      AND "userId" = ${args.actorId}
    LIMIT 1
  `;
  if (members[0] === undefined || !isAdminRole(members[0].role)) {
    return deny('caller is not an org admin');
  }
  if (!args.reason.trim()) {
    throw new ErasureError('validation', 'reason is required');
  }
  if (
    !ERASURE_REASON_CODES.includes(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- membership test over the closed list
      args.reasonCode as (typeof ERASURE_REASON_CODES)[number],
    )
  ) {
    throw new ErasureError('validation', 'unknown reason code');
  }
  // Self-deletion guard: erasure scrubs the actor's audit trail — a
  // compromised admin must not use it against their own evidence.
  if (args.targetUserId === args.actorId) {
    return deny('self_deletion_forbidden');
  }
  const policy = await dsarPolicy(sql, args.organizationId);
  try {
    await checkOrganizationRateLimit(
      sql,
      'governance:dsar_request',
      `${args.organizationId}:${args.actorId}`,
    );
  } catch {
    return deny('rate_limited');
  }

  const now = Date.now();
  let filed: {
    id: string;
    threadsTargeted: number;
    holdBlock: { orgHeld: boolean; userCustodianHeld: boolean } | null;
  };
  try {
    filed = await sql.begin(async (tx) => {
      // The targeted set is captured at REQUEST time so the receipt shows
      // the scope the admin approved (the 0.4 `threadsTargeted`).
      const targeted = await tx<{ threadId: string }[]>`
      SELECT thread_id AS "threadId" FROM app.thread_metadata
      WHERE org_id = ${args.organizationId}
        AND user_id = ${args.targetUserId} AND branch_root_id IS NULL
    `;
      const threadIds = targeted.map((row) => row.threadId);
      // A duplicate live request trips the partial-unique index here; the
      // violation aborts the tx, and the wrapper catch below answers
      // ALREADY_PENDING from a fresh connection.
      const rows = await tx<{ id: string }[]>`
      INSERT INTO app.gdpr_erasure_requests (
        org_id, target_user_id, reason, reason_code, requested_by,
        requested_at_ms, sla_deadline_at_ms, status, threads_targeted
      ) VALUES (
        ${args.organizationId}, ${args.targetUserId}, ${args.reason.trim()},
        ${args.reasonCode}, ${args.actorId}, ${now},
        ${now + SLA_DAYS * DAY_MS}, 'pending', ${threadIds}
      ) RETURNING id
    `;
      const id = rows[0]?.id ?? '';
      // The hold gate (Art 17(3)(e)) AFTER the insert: the refusal is a
      // durable 'blocked' receipt, not a vanished request.
      const holds = await loadActiveHolds(tx, args.organizationId);
      const userCustodianHeld = holds.userMembershipIds.has(args.targetUserId);
      const blockedByHold = holds.orgHeld || userCustodianHeld;
      if (blockedByHold) {
        await tx`
        UPDATE app.gdpr_erasure_requests SET status = 'blocked'
        WHERE id = ${id}
      `;
        await createAuditLog(tx, {
          organizationId: args.organizationId,
          actorId: args.actorId,
          ...(args.actorEmail !== undefined
            ? { actorEmail: args.actorEmail }
            : {}),
          actorType: 'user',
          action: 'gdpr_erasure_blocked_by_hold',
          category: 'admin',
          resourceType: 'user',
          resourceId: args.targetUserId,
          status: 'failure',
          errorMessage: 'LEGAL_HOLD_BLOCKS_ERASURE',
          newState: {
            requestId: id,
            reason: args.reason.trim(),
            orgHeld: holds.orgHeld,
            userCustodianHeld,
            threadsBlockedByHold: threadIds.length,
          },
        });
        return {
          id,
          threadsTargeted: threadIds.length,
          holdBlock: { orgHeld: holds.orgHeld, userCustodianHeld },
        };
      }
      const effectiveAt = now + policy.coolingOffHours * HOUR_MS;
      await tx`
      UPDATE app.gdpr_erasure_requests SET effective_at_ms = ${effectiveAt}
      WHERE id = ${id}
    `;
      await addJobInTx(
        tx,
        'governance.process_erasure',
        { requestId: id },
        { startAfter: new Date(effectiveAt) },
      );
      await createAuditLog(tx, {
        organizationId: args.organizationId,
        actorId: args.actorId,
        ...(args.actorEmail !== undefined
          ? { actorEmail: args.actorEmail }
          : {}),
        actorType: 'user',
        action: 'gdpr_erasure_requested',
        category: 'admin',
        resourceType: 'user',
        resourceId: args.targetUserId,
        status: 'success',
        newState: { requestId: id, reasonCode: args.reasonCode },
      });
      return { id, threadsTargeted: threadIds.length, holdBlock: null };
    });
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === '23505'
    ) {
      const live = await sql<{ id: string; status: string }[]>`
        SELECT id, status FROM app.gdpr_erasure_requests
        WHERE org_id = ${args.organizationId}
          AND target_user_id = ${args.targetUserId}
          AND status IN ('pending', 'running', 'blocked', 'partial')
        ORDER BY requested_at_ms DESC
        LIMIT 1
      `;
      throw new ErasureError(
        'ALREADY_PENDING',
        `An erasure request for this subject is already ${live[0]?.status ?? 'live'}.`,
        409,
        live[0] !== undefined
          ? { requestId: live[0].id, status: live[0].status }
          : {},
      );
    }
    throw error;
  }
  // The blocked receipt is durable (committed above); the REFUSAL is the
  // mutation's answer — the 0.4 `LEGAL_HOLD_BLOCKS_ERASURE` contract the
  // file-request dialog renders as a "view blocked request" panel.
  if (filed.holdBlock !== null) {
    throw new ErasureError(
      'LEGAL_HOLD_BLOCKS_ERASURE',
      filed.holdBlock.orgHeld
        ? 'Org is under an active legal hold — release the hold and use Retry to re-schedule erasure.'
        : 'The subject user is on an active custodian legal hold — release the hold and use Retry to re-schedule erasure.',
      409,
      {
        requestId: filed.id,
        orgHeld: filed.holdBlock.orgHeld,
        userCustodianHeld: filed.holdBlock.userCustodianHeld,
      },
    );
  }
  return { requestId: filed.id, threadsTargeted: filed.threadsTargeted };
}

/** Cancel within the cooling-off window (pending only) — terminal, the
 * cascade never runs, the receipt survives. */
export async function cancelErasure(
  sql: Sql,
  args: {
    organizationId: string;
    actorId: string;
    requestId: string;
    reason: string;
  },
): Promise<void> {
  const reason = args.reason.trim();
  const rows = await sql<
    {
      id: string;
      status: string;
      targetUserId: string;
      effectiveAt: number | null;
    }[]
  >`
    SELECT id, status, target_user_id AS "targetUserId",
           effective_at_ms::float8 AS "effectiveAt"
    FROM app.gdpr_erasure_requests
    WHERE id = ${args.requestId} AND org_id = ${args.organizationId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw new ErasureError('not_found', 'Request not found', 404);
  }
  if (row.status !== 'pending') {
    throw new ErasureError(
      'NOT_CANCELLABLE',
      `Only pending requests in the cooling-off window can be cancelled (status=${row.status}).`,
      409,
    );
  }
  const now = Date.now();
  if (row.effectiveAt === null || row.effectiveAt <= now) {
    throw new ErasureError(
      'cannotCancelAfterCooldown',
      'The cooling-off window has elapsed; the processor has already been dispatched. Use Retry on the resulting receipt instead.',
      409,
    );
  }
  if (reason.length < 10) {
    throw new ErasureError(
      'validation',
      'cancellationReason must be at least 10 characters.',
    );
  }
  await sql.begin(async (tx) => {
    const cancelled = await tx<{ id: string }[]>`
      UPDATE app.gdpr_erasure_requests SET
        status = 'cancelled', cancelled_by = ${args.actorId},
        cancellation_reason = ${reason}, finished_at_ms = ${now}
      WHERE id = ${row.id} AND status = 'pending'
      RETURNING id
    `;
    if (cancelled.length === 0) {
      throw new ErasureError(
        'NOT_CANCELLABLE',
        'The request left the cancellable window while cancelling.',
        409,
      );
    }
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      actorType: 'user',
      action: 'gdpr_erasure_cancelled',
      category: 'admin',
      resourceType: 'user',
      resourceId: row.targetUserId,
      status: 'success',
      previousState: { status: row.status, effectiveAt: row.effectiveAt },
      newState: {
        status: 'cancelled',
        cancellationReason: reason,
        requestId: row.id,
      },
    });
    await emitHintInTx(tx, {
      orgId: args.organizationId,
      entity: 'gdpr_erasure',
      entityId: row.id,
    });
  });
}

/** Re-arm a blocked/partial/failed request (the operator released the hold
 * or wants a fresh pass). Re-checks the hold gate. */
export async function retryErasure(
  sql: Sql,
  args: { organizationId: string; requestId: string },
): Promise<void> {
  const holds = await loadActiveHolds(sql, args.organizationId);
  const rows = await sql<{ targetUserId: string }[]>`
    SELECT target_user_id AS "targetUserId"
    FROM app.gdpr_erasure_requests
    WHERE id = ${args.requestId} AND org_id = ${args.organizationId}
      AND status IN ('blocked', 'partial', 'failed')
    LIMIT 1
  `;
  const target = rows[0];
  if (!target) {
    throw new ErasureError(
      'NOT_RETRIABLE',
      'Only blocked, partial, or failed requests retry',
      409,
    );
  }
  const userCustodianHeld = holds.userMembershipIds.has(target.targetUserId);
  if (holds.orgHeld || userCustodianHeld) {
    throw new ErasureError(
      'LEGAL_HOLD_BLOCKS_ERASURE',
      'An active legal hold still blocks this erasure (Art 17(3)(e))',
      409,
      {
        requestId: args.requestId,
        orgHeld: holds.orgHeld,
        userCustodianHeld,
      },
    );
  }
  const effectiveAt = Date.now();
  await sql.begin(async (tx) => {
    await tx`
      UPDATE app.gdpr_erasure_requests SET status = 'pending',
        effective_at_ms = ${effectiveAt}
      WHERE id = ${args.requestId}
    `;
    await addJobInTx(tx, 'governance.process_erasure', {
      requestId: args.requestId,
    });
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: 'system',
      actorType: 'system',
      action: 'gdpr_erasure_retried',
      category: 'admin',
      resourceType: 'user',
      resourceId: target.targetUserId,
      status: 'success',
      newState: {
        status: 'pending',
        requestId: args.requestId,
        effectiveAt,
      },
    });
    await emitHintInTx(tx, {
      orgId: args.organizationId,
      entity: 'gdpr_erasure',
      entityId: args.requestId,
    });
  });
}

/** Blank the subject's PII on their audit rows — actor pass + resource
 * pass — keeping the rows (Art 17(3)(b)) and flagging the intentional
 * hash divergence. Idempotent. */
async function scrubSubjectAuditLogs(
  sql: Sql,
  organizationId: string,
  userId: string,
): Promise<number> {
  const scrubbed = await sql<{ id: string }[]>`
    UPDATE app.audit_logs SET
      actor_email = NULL, actor_email_hash = NULL, actor_role = NULL,
      ip_address = NULL, actor_ip_hash = NULL, user_agent = NULL,
      previous_state = NULL, new_state = NULL, metadata = NULL,
      pii_scrubbed = true
    WHERE org_id = ${organizationId} AND pii_scrubbed IS NOT true
      AND (actor_id = ${userId}
           OR (resource_type = 'user' AND resource_id = ${userId}))
    RETURNING id
  `;
  return scrubbed.length;
}

/** The cascade — each pass bounded and idempotent; per-pass counts land on
 * the receipt. Reuses the retention purge primitives for threads and the
 * document trash for owned documents. */
export async function processErasure(
  sql: Sql,
  requestId: string,
): Promise<void> {
  const rows = await sql<
    { organizationId: string; targetUserId: string; status: string }[]
  >`
    UPDATE app.gdpr_erasure_requests SET
      status = 'running', started_at_ms = ${Date.now()}
    WHERE id = ${requestId} AND status = 'pending'
    RETURNING org_id AS "organizationId", target_user_id AS "targetUserId",
              status
  `;
  const request = rows[0];
  if (!request) return; // cancelled / already ran / blocked
  const { organizationId, targetUserId } = request;

  // The hold gate re-checked at execution time — a hold placed during the
  // cooling-off window blocks the cascade.
  const holds = await loadActiveHolds(sql, organizationId);
  if (holds.orgHeld || holds.userMembershipIds.has(targetUserId)) {
    await sql`
      UPDATE app.gdpr_erasure_requests SET status = 'blocked'
      WHERE id = ${requestId}
    `;
    return;
  }

  const counts: Record<string, number> = {};
  const failures: string[] = [];
  const pass = async (
    name: string,
    run: () => Promise<number>,
  ): Promise<void> => {
    try {
      counts[name] = await run();
    } catch (error) {
      console.error(`[erasure] pass ${name} failed:`, error);
      failures.push(name);
    }
  };

  const { purgeThreadLineage, purgeDocument } =
    await import('../retention/service.ts');

  await pass('threads', async () => {
    const threads = await sql<{ threadId: string }[]>`
      SELECT tm.thread_id AS "threadId" FROM app.thread_metadata tm
      WHERE tm.org_id = ${organizationId} AND tm.user_id = ${targetUserId}
        AND tm.branch_root_id IS NULL
    `;
    let erased = 0;
    for (const thread of threads) {
      erased += await purgeThreadLineage(sql, organizationId, thread.threadId);
    }
    return erased;
  });

  await pass('documents', async () => {
    const docs = await sql<
      { id: string; fileRef: string | null; historyFiles: string[] }[]
    >`
      SELECT id, file_ref AS "fileRef", history_files AS "historyFiles"
      FROM app.documents
      WHERE org_id = ${organizationId} AND created_by = ${targetUserId}
    `;
    const { resolveOrgSlug } = await import('../../lib/org-config.ts');
    const orgSlug = await resolveOrgSlug(sql, organizationId);
    for (const doc of docs) {
      await purgeDocument(sql, orgSlug, {
        id: doc.id,
        fileRef: doc.fileRef,
        organizationId,
        historyFiles: doc.historyFiles,
      });
    }
    return docs.length;
  });

  await pass('uploads', async () => {
    const removed = await sql<{ id: string }[]>`
      DELETE FROM app.file_metadata
      WHERE org_id = ${organizationId} AND uploaded_by = ${targetUserId}
        AND document_id IS NULL
      RETURNING id
    `;
    return removed.length;
  });

  await pass('preferences', async () => {
    const a = await sql<{ userId: string }[]>`
      DELETE FROM app.user_preferences
      WHERE org_id = ${organizationId} AND user_id = ${targetUserId}
      RETURNING user_id AS "userId"
    `;
    const b = await sql<{ userId: string }[]>`
      DELETE FROM app.notification_preferences
      WHERE org_id = ${organizationId} AND user_id = ${targetUserId}
      RETURNING user_id AS "userId"
    `;
    return a.length + b.length;
  });

  await pass('notifications', async () => {
    const removed = await sql<{ id: string }[]>`
      DELETE FROM app.user_notifications
      WHERE org_id = ${organizationId} AND user_id = ${targetUserId}
      RETURNING id
    `;
    return removed.length;
  });

  await pass('subscriptions', async () => {
    const removed = await sql<{ id: string }[]>`
      DELETE FROM app.task_subscriptions
      WHERE org_id = ${organizationId} AND subscriber_type = 'user'
        AND subscriber_id = ${targetUserId}
      RETURNING id
    `;
    return removed.length;
  });

  await pass('feedback', async () => {
    const removed = await sql<{ id: string }[]>`
      DELETE FROM app.message_feedback
      WHERE org_id = ${organizationId} AND user_id = ${targetUserId}
      RETURNING id
    `;
    return removed.length;
  });

  await pass('memories', async () => {
    const removed = await sql<{ id: string }[]>`
      DELETE FROM app.memories
      WHERE org_id = ${organizationId} AND user_id = ${targetUserId}
      RETURNING id
    `;
    return removed.length;
  });

  await pass('usageLedger', async () => {
    const removed = await sql<{ orgId: string }[]>`
      DELETE FROM app.usage_ledger
      WHERE org_id = ${organizationId} AND user_id = ${targetUserId}
      RETURNING org_id AS "orgId"
    `;
    return removed.length;
  });

  await pass('auditScrub', () =>
    scrubSubjectAuditLogs(sql, organizationId, targetUserId),
  );

  const status = failures.length === 0 ? 'done' : 'partial';
  await sql.begin(async (tx) => {
    await tx`
      UPDATE app.gdpr_erasure_requests SET
        status = ${status}, finished_at_ms = ${Date.now()},
        counts = ${tx.json(toJson(counts))},
        error = ${failures.length > 0 ? `failed passes: ${failures.join(', ')}` : null}
      WHERE id = ${requestId}
    `;
    await createAuditLog(tx, {
      organizationId,
      actorId: 'system',
      actorType: 'system',
      action:
        status === 'done'
          ? 'gdpr_erasure_executed'
          : 'gdpr_erasure_cascade_attempts_exhausted',
      category: 'admin',
      resourceType: 'user',
      resourceId: targetUserId,
      status: 'success',
      newState: { requestId, counts },
    });
  });
}

export interface ErasureRequestSummary {
  _id: string;
  organizationId: string;
  targetUserId: string;
  targetUserName: string;
  reasonCode: string;
  status: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: number;
  slaDeadlineAt: number;
  effectiveAt?: number;
  extensionDeadlineAt?: number;
}

/** The Data-subject-requests table (the 0.4 paginated `listErasureRequests`
 * summaries: resolved names, optional status filter, keyset walk). */
export async function listErasureRequests(
  sql: Sql,
  organizationId: string,
  args: {
    statuses?: string[];
    limit?: number;
    cursor?: { ts: number; id: string };
  } = {},
): Promise<ErasureRequestSummary[]> {
  const limit = Math.min(Math.max(1, args.limit ?? 100), 200);
  const statuses =
    args.statuses !== undefined && args.statuses.length > 0
      ? args.statuses
      : null;
  const cursorTs = args.cursor?.ts ?? null;
  const cursorId = args.cursor?.id ?? null;
  const rows = await sql<
    {
      id: string;
      targetUserId: string;
      reasonCode: string;
      status: string;
      requestedBy: string;
      requestedAt: number;
      slaDeadlineAt: number;
      effectiveAt: number | null;
      extensionDeadlineAt: number | null;
    }[]
  >`
    SELECT id, target_user_id AS "targetUserId", reason_code AS "reasonCode",
           status, requested_by AS "requestedBy",
           requested_at_ms::float8 AS "requestedAt",
           sla_deadline_at_ms::float8 AS "slaDeadlineAt",
           effective_at_ms::float8 AS "effectiveAt",
           extension_deadline_at_ms::float8 AS "extensionDeadlineAt"
    FROM app.gdpr_erasure_requests
    WHERE org_id = ${organizationId}
      AND (${statuses}::text[] IS NULL OR status = ANY(${statuses}))
      AND (${cursorTs}::bigint IS NULL
        OR (requested_at_ms, id) < (${cursorTs}, ${cursorId}))
    ORDER BY requested_at_ms DESC, id DESC
    LIMIT ${limit}
  `;
  const userIds = [
    ...new Set(rows.flatMap((row) => [row.targetUserId, row.requestedBy])),
  ];
  const nameOf = await userNames(sql, userIds);
  return rows.map((row) => {
    const summary: ErasureRequestSummary = {
      _id: row.id,
      organizationId,
      targetUserId: row.targetUserId,
      targetUserName: nameOf.get(row.targetUserId) ?? row.targetUserId,
      reasonCode: row.reasonCode,
      status: row.status,
      requestedBy: row.requestedBy,
      requestedByName: nameOf.get(row.requestedBy) ?? row.requestedBy,
      requestedAt: row.requestedAt,
      slaDeadlineAt: row.slaDeadlineAt,
    };
    if (row.effectiveAt !== null) summary.effectiveAt = row.effectiveAt;
    if (row.extensionDeadlineAt !== null) {
      summary.extensionDeadlineAt = row.extensionDeadlineAt;
    }
    return summary;
  });
}

async function userNames(
  sql: Sql,
  userIds: string[],
): Promise<Map<string, string | null>> {
  if (userIds.length === 0) return new Map();
  const users = await sql<{ id: string; name: string | null }[]>`
    SELECT "id", "name" FROM "user" WHERE "id" = ANY(${userIds})
  `;
  return new Map(users.map((user) => [user.id, user.name] as const));
}

const MAX_EXTENSION_DAYS = 60;

/**
 * Grant the SINGLE Art 12(3) SLA extension (admin-only, once, before the
 * original deadline lapses, terminal states refused). Returns the new
 * effective deadline; the receipt keeps both stamps.
 */
export async function extendErasureDeadline(
  sql: Sql,
  auth: { organizationId: string; userId: string; email?: string },
  args: { requestId: string; extraDays: number; extensionReason: string },
): Promise<{ extensionDeadlineAt: number }> {
  const extraDays = Math.trunc(args.extraDays);
  if (
    !Number.isFinite(extraDays) ||
    extraDays < 1 ||
    extraDays > MAX_EXTENSION_DAYS
  ) {
    throw new ErasureError(
      'validation',
      `extraDays must be an integer between 1 and ${MAX_EXTENSION_DAYS}.`,
    );
  }
  const reason = args.extensionReason.trim();
  if (reason.length < 10) {
    throw new ErasureError(
      'validation',
      'extensionReason must be at least 10 characters.',
    );
  }
  const rows = await sql<
    {
      id: string;
      status: string;
      targetUserId: string;
      slaDeadlineAt: number;
      extensionGrantedAt: number | null;
    }[]
  >`
    SELECT id, status, target_user_id AS "targetUserId",
           sla_deadline_at_ms::float8 AS "slaDeadlineAt",
           extension_granted_at_ms::float8 AS "extensionGrantedAt"
    FROM app.gdpr_erasure_requests
    WHERE id = ${args.requestId} AND org_id = ${auth.organizationId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw new ErasureError('REQUEST_NOT_FOUND', 'Request not found', 404);
  }
  if (row.extensionGrantedAt !== null) {
    throw new ErasureError(
      'ALREADY_EXTENDED',
      'The single Art 12(3) extension was already granted.',
    );
  }
  if (row.status === 'done' || row.status === 'failed') {
    throw new ErasureError(
      'NOT_EXTENDABLE',
      `Request is in a terminal state (status=${row.status}).`,
    );
  }
  const now = Date.now();
  if (row.slaDeadlineAt < now) {
    throw new ErasureError(
      'DEADLINE_LAPSED',
      'The original deadline already lapsed; an extension cannot be granted retroactively.',
    );
  }
  const extensionDeadlineAt =
    row.slaDeadlineAt + extraDays * 24 * 60 * 60 * 1000;
  await sql.begin(async (tx) => {
    await tx`
      UPDATE app.gdpr_erasure_requests SET
        extension_granted_at_ms = ${now},
        extension_granted_by = ${auth.userId},
        extension_reason = ${reason},
        extension_deadline_at_ms = ${extensionDeadlineAt}
      WHERE id = ${row.id}
    `;
    await createAuditLog(tx, {
      organizationId: auth.organizationId,
      actorId: auth.userId,
      ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
      actorType: 'user',
      action: 'gdpr_erasure_extended',
      category: 'admin',
      resourceType: 'user',
      resourceId: row.targetUserId,
      status: 'success',
      previousState: { slaDeadlineAt: row.slaDeadlineAt },
      newState: {
        requestId: row.id,
        extraDays,
        extensionReason: reason,
        extensionDeadlineAt,
      },
    });
    await emitHintInTx(tx, {
      orgId: auth.organizationId,
      entity: 'gdpr_erasure',
      entityId: row.id,
    });
  });
  return { extensionDeadlineAt };
}

/** One request's full receipt + its gdpr_erasure audit timeline (the 0.4
 * detail read the drawer renders). `counts` maps onto the 0.4 per-pass
 * fields where the cascades line up and rides whole as
 * `perCategorySnapshot`. */
export async function getErasureRequest(
  sql: Sql,
  organizationId: string,
  requestId: string,
): Promise<{
  request: Record<string, unknown>;
  auditEntries: Array<{
    _id: string;
    action: string;
    timestamp: number;
    errorMessage?: string;
  }>;
} | null> {
  const rows = await sql<
    {
      id: string;
      targetUserId: string;
      reason: string;
      reasonCode: string;
      status: string;
      requestedBy: string;
      requestedAt: number;
      slaDeadlineAt: number;
      effectiveAt: number | null;
      extensionGrantedAt: number | null;
      extensionGrantedBy: string | null;
      extensionReason: string | null;
      extensionDeadlineAt: number | null;
      startedAt: number | null;
      finishedAt: number | null;
      cancelledBy: string | null;
      cancellationReason: string | null;
      threadsTargeted: string[] | null;
      counts: Record<string, number> | null;
      error: string | null;
    }[]
  >`
    SELECT id, target_user_id AS "targetUserId", reason,
           reason_code AS "reasonCode", status,
           requested_by AS "requestedBy",
           requested_at_ms::float8 AS "requestedAt",
           sla_deadline_at_ms::float8 AS "slaDeadlineAt",
           effective_at_ms::float8 AS "effectiveAt",
           extension_granted_at_ms::float8 AS "extensionGrantedAt",
           extension_granted_by AS "extensionGrantedBy",
           extension_reason AS "extensionReason",
           extension_deadline_at_ms::float8 AS "extensionDeadlineAt",
           started_at_ms::float8 AS "startedAt",
           finished_at_ms::float8 AS "finishedAt",
           cancelled_by AS "cancelledBy",
           cancellation_reason AS "cancellationReason",
           threads_targeted AS "threadsTargeted",
           counts, error
    FROM app.gdpr_erasure_requests
    WHERE id = ${requestId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined) return null;
  const userIds = [
    ...new Set(
      [
        row.targetUserId,
        row.requestedBy,
        row.extensionGrantedBy,
        row.cancelledBy,
      ].filter((id): id is string => id !== null),
    ),
  ];
  const nameOf = await userNames(sql, userIds);
  const counts = row.counts;
  const terminalAt = row.finishedAt;
  const request: Record<string, unknown> = {
    _id: row.id,
    organizationId,
    targetUserId: row.targetUserId,
    targetUserName: nameOf.get(row.targetUserId) ?? row.targetUserId,
    reason: row.reason,
    reasonCode: row.reasonCode,
    requestedBy: row.requestedBy,
    requestedByName: nameOf.get(row.requestedBy) ?? row.requestedBy,
    requestedAt: row.requestedAt,
    slaDeadlineAt: row.slaDeadlineAt,
    status: row.status,
    ...(row.threadsTargeted !== null
      ? { threadsTargeted: row.threadsTargeted }
      : {}),
    ...(counts?.threads !== undefined ? { threadsErased: counts.threads } : {}),
    ...(counts?.documents !== undefined
      ? { documentsErased: counts.documents }
      : {}),
    ...(counts !== null ? { perCategorySnapshot: counts } : {}),
    ...(row.error !== null ? { errorMessage: row.error } : {}),
    ...(row.startedAt !== null ? { startedAt: row.startedAt } : {}),
    ...(row.status === 'cancelled'
      ? {
          ...(terminalAt !== null ? { cancelledAt: terminalAt } : {}),
          ...(row.cancelledBy !== null
            ? {
                cancelledBy: row.cancelledBy,
                cancelledByName: nameOf.get(row.cancelledBy) ?? row.cancelledBy,
              }
            : {}),
          ...(row.cancellationReason !== null
            ? { cancellationReason: row.cancellationReason }
            : {}),
        }
      : terminalAt !== null
        ? { completedAt: terminalAt }
        : {}),
    ...(row.effectiveAt !== null ? { effectiveAt: row.effectiveAt } : {}),
    ...(row.extensionGrantedAt !== null
      ? { extensionGrantedAt: row.extensionGrantedAt }
      : {}),
    ...(row.extensionGrantedBy !== null
      ? {
          extensionGrantedBy: row.extensionGrantedBy,
          extensionGrantedByName:
            nameOf.get(row.extensionGrantedBy) ?? row.extensionGrantedBy,
        }
      : {}),
    ...(row.extensionReason !== null
      ? { extensionReason: row.extensionReason }
      : {}),
    ...(row.extensionDeadlineAt !== null
      ? { extensionDeadlineAt: row.extensionDeadlineAt }
      : {}),
  };
  const audit = await sql<
    {
      id: string;
      action: string;
      timestamp: number;
      errorMessage: string | null;
    }[]
  >`
    SELECT id, action, ts::float8 AS "timestamp",
           error_message AS "errorMessage"
    FROM app.audit_logs
    WHERE org_id = ${organizationId} AND resource_type = 'user'
      AND resource_id = ${row.targetUserId}
      AND action LIKE 'gdpr_erasure%'
    ORDER BY ts ASC
    LIMIT 500
  `;
  return {
    request,
    auditEntries: audit.map((entry) => {
      const item: {
        _id: string;
        action: string;
        timestamp: number;
        errorMessage?: string;
      } = {
        _id: entry.id,
        action: entry.action,
        timestamp: entry.timestamp,
      };
      if (entry.errorMessage !== null) item.errorMessage = entry.errorMessage;
      return item;
    }),
  };
}
