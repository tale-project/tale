import type { Sql } from 'postgres';

import { isAdminRole } from '../../auth/membership.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { checkOrganizationRateLimit } from '../../lib/rate-limit.ts';
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
  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 | 429 = 400,
  ) {
    super(message);
    this.name = 'ErasureError';
    this.code = code;
    this.status = status;
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
): Promise<{ requestId: string; status: string; effectiveAt: number | null }> {
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
  const requestId = await sql.begin(async (tx) => {
    let id: string;
    try {
      const rows = await tx<{ id: string }[]>`
        INSERT INTO app.gdpr_erasure_requests (
          org_id, target_user_id, reason, reason_code, requested_by,
          requested_at_ms, sla_deadline_at_ms, status
        ) VALUES (
          ${args.organizationId}, ${args.targetUserId}, ${args.reason.trim()},
          ${args.reasonCode}, ${args.actorId}, ${now},
          ${now + SLA_DAYS * DAY_MS}, 'pending'
        ) RETURNING id
      `;
      id = rows[0]?.id ?? '';
    } catch (error) {
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new ErasureError(
          'ERASURE_ALREADY_LIVE',
          'A live erasure request already exists for this subject',
          409,
        );
      }
      throw error;
    }
    // The hold gate (Art 17(3)(e)) AFTER the insert: the refusal is a
    // durable 'blocked' receipt, not a vanished request.
    const holds = await loadActiveHolds(tx, args.organizationId);
    if (holds.orgHeld || holds.userMembershipIds.has(args.targetUserId)) {
      await tx`
        UPDATE app.gdpr_erasure_requests SET status = 'blocked'
        WHERE id = ${id}
      `;
    } else {
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
    }
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      ...(args.actorEmail !== undefined ? { actorEmail: args.actorEmail } : {}),
      actorType: 'user',
      action: 'gdpr_erasure_requested',
      category: 'admin',
      resourceType: 'user',
      resourceId: args.targetUserId,
      status: 'success',
      newState: { requestId: id, reasonCode: args.reasonCode },
    });
    return id;
  });
  const receipt = await sql<{ status: string; effectiveAt: number | null }[]>`
    SELECT status, effective_at_ms::float8 AS "effectiveAt"
    FROM app.gdpr_erasure_requests WHERE id = ${requestId}
  `;
  return {
    requestId,
    status: receipt[0]?.status ?? 'pending',
    effectiveAt: receipt[0]?.effectiveAt ?? null,
  };
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
  const rows = await sql<{ id: string }[]>`
    UPDATE app.gdpr_erasure_requests SET
      status = 'cancelled', cancelled_by = ${args.actorId},
      cancellation_reason = ${args.reason.trim()},
      finished_at_ms = ${Date.now()}
    WHERE id = ${args.requestId} AND org_id = ${args.organizationId}
      AND status = 'pending'
    RETURNING id
  `;
  if (rows.length === 0) {
    throw new ErasureError(
      'ERASURE_NOT_CANCELLABLE',
      'Only a pending request (inside its cooling-off window) can be cancelled',
      409,
    );
  }
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
      'ERASURE_NOT_RETRYABLE',
      'Only blocked, partial, or failed requests retry',
      409,
    );
  }
  if (holds.orgHeld || holds.userMembershipIds.has(target.targetUserId)) {
    throw new ErasureError(
      'LEGAL_HOLD_BLOCKS_ERASURE',
      'An active legal hold still blocks this erasure (Art 17(3)(e))',
      409,
    );
  }
  await sql.begin(async (tx) => {
    await tx`
      UPDATE app.gdpr_erasure_requests SET status = 'pending',
        effective_at_ms = ${Date.now()}
      WHERE id = ${args.requestId}
    `;
    await addJobInTx(tx, 'governance.process_erasure', {
      requestId: args.requestId,
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
        status === 'done' ? 'gdpr_erasure_completed' : 'gdpr_erasure_partial',
      category: 'admin',
      resourceType: 'user',
      resourceId: targetUserId,
      status: 'success',
      newState: { requestId, counts },
    });
  });
}

export async function listErasureRequests(
  sql: Sql,
  organizationId: string,
): Promise<
  Array<{
    id: string;
    targetUserId: string;
    reasonCode: string;
    status: string;
    requestedBy: string;
    requestedAt: number;
    slaDeadlineAt: number;
    effectiveAt: number | null;
    finishedAt: number | null;
    counts: Record<string, number> | null;
  }>
> {
  return sql<
    Array<{
      id: string;
      targetUserId: string;
      reasonCode: string;
      status: string;
      requestedBy: string;
      requestedAt: number;
      slaDeadlineAt: number;
      effectiveAt: number | null;
      finishedAt: number | null;
      counts: Record<string, number> | null;
    }>[number][]
  >`
    SELECT id, target_user_id AS "targetUserId", reason_code AS "reasonCode",
           status, requested_by AS "requestedBy",
           requested_at_ms::float8 AS "requestedAt",
           sla_deadline_at_ms::float8 AS "slaDeadlineAt",
           effective_at_ms::float8 AS "effectiveAt",
           finished_at_ms::float8 AS "finishedAt", counts
    FROM app.gdpr_erasure_requests
    WHERE org_id = ${organizationId}
    ORDER BY requested_at_ms DESC
    LIMIT 200
  `;
}
