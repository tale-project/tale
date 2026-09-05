import type { Sql, TransactionSql } from 'postgres';

import { isRecord } from '../../../lib/utils/type-utils.ts';
import { isAdminRole } from '../../auth/membership.ts';
import {
  ERASURE_REASON_CODES,
  ERASURE_WATCHDOG_TIMEOUT_MESSAGE,
} from '../../core/governance/erasure_constants.ts';
import { normalizeAuthEmail } from '../../core/lib/auth/normalize_auth_email.ts';
import { parseBlobRef } from '../../core/lib/storage/blob_ref.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { deleteOrgObject } from '../../lib/object-store.ts';
import {
  readGovernancePolicyForOrg,
  resolveOrgSlug,
} from '../../lib/org-config.ts';
import { checkOrganizationRateLimit } from '../../lib/rate-limit.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { applyMaturedDsarPolicyChange } from '../governance/settings-tail.ts';
import { loadActiveHolds } from '../legal_holds/service.ts';
import { writeNotificationForOrgs } from '../notifications/service.ts';

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

/** Stands in for the subject on a record that is kept but de-identified. A
 *  review decision is the audit trail of a governance gate, so the row stays
 *  and the identity goes. Same value 0.4 used, so old and new rows read
 *  alike. */
const ERASED_SUBJECT = 'erased-user';

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

/**
 * Membership test over the closed reason-code list. The ONE list is
 * `core/governance/erasure_constants.ts` — the file-request picker, the
 * i18n labels, and the docs all speak it. (A divergent local copy here
 * once carried `child_consent` while everything user-facing offered
 * `child`, making the documented Art 17(1)(f) ground unfileable.)
 */
export function isValidErasureReasonCode(code: string): boolean {
  return ERASURE_REASON_CODES.includes(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- membership test over the closed list
    code as (typeof ERASURE_REASON_CODES)[number],
  );
}

/**
 * The DSAR policy the erasure lane ENFORCES. A staged loosening whose grace
 * has elapsed applies here first, so filing and approval see the policy the
 * owner was told would be in force at that time — not whatever the last
 * visit to the policy page happened to leave behind.
 */
export async function readEffectiveDsarPolicy(
  sql: Sql | TransactionSql,
  organizationId: string,
): Promise<{
  coolingOffHours: number;
  dailyLimitPerAdmin: number;
  requireDualApproval: boolean;
}> {
  await applyMaturedDsarPolicyChange(sql, organizationId);
  const config = await readGovernancePolicyForOrg(
    sql,
    organizationId,
    'dsar_governance',
  );
  return {
    coolingOffHours: config?.coolingOffHours ?? 24,
    dailyLimitPerAdmin: config?.dailyLimitPerAdmin ?? 5,
    requireDualApproval: config?.requireDualApproval ?? false,
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
  if (!isValidErasureReasonCode(args.reasonCode)) {
    throw new ErasureError('validation', 'unknown reason code');
  }
  // Self-deletion guard: erasure scrubs the actor's audit trail — a
  // compromised admin must not use it against their own evidence.
  if (args.targetUserId === args.actorId) {
    return deny('self_deletion_forbidden');
  }
  const policy = await readEffectiveDsarPolicy(sql, args.organizationId);
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
      if (policy.requireDualApproval) {
        // Dual-approval path: the row is filed but NOT scheduled. A second
        // admin (≠ filer) must approve it in the Approvals inbox; their
        // decision runs `confirmAndScheduleErasure`, which sets
        // `effective_at_ms` and enqueues the cooling-off processor.
        await tx`
          INSERT INTO app.approvals (
            org_id, status, resource_type, resource_id, priority, metadata,
            created_at_ms
          ) VALUES (
            ${args.organizationId}, 'pending', 'erasure', ${id}, 'high',
            ${tx.json(
              toJson({
                subjectUserId: args.targetUserId,
                requestedBy: args.actorId,
                reason: args.reason.trim(),
                reasonCode: args.reasonCode,
                threadsTargetedCount: threadIds.length,
              }),
            )},
            ${now}
          )
        `;
        await writeNotificationForOrgs(tx, {
          organizationIds: [args.organizationId],
          category: 'security',
          severity: 'warning',
          titleKey: 'dsarApprovalNeeded',
          bodyKey: 'dsarApprovalNeededBody',
          params: {
            subjectUserId: args.targetUserId,
            requestedBy: args.actorId,
            requestId: id,
          },
          subjectUserId: args.targetUserId,
          link: { kind: 'dsar' },
        });
      } else {
        // Default cooling-off path: the row stays `pending` until
        // `effective_at_ms`; any admin may cancel within the window.
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
  // A NULL `effective_at_ms` on a pending row means the request is parked
  // awaiting the second admin's approval (dual-approval mode): nothing is
  // scheduled yet, so it is trivially cancellable — the docs promise "any
  // Admin can cancel" before the cascade runs. Only a stamp in the PAST
  // means the processor was already dispatched.
  if (row.effectiveAt !== null && row.effectiveAt <= now) {
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
    // Dual-approval mode parks an approvals-inbox row per request; a
    // cancelled receipt's approval must not stay decidable, so settle any
    // still-pending row as rejected (an approve that raced ahead flipped
    // it to 'executing' — this update then no-ops, which is fine: the
    // receipt cancel above already prevailed and the processor no-ops on
    // non-pending receipts).
    const settledApprovals = await tx<{ id: string }[]>`
      UPDATE app.approvals SET
        status = 'rejected', approved_by = ${args.actorId},
        reviewed_at_ms = ${now}
      WHERE org_id = ${args.organizationId} AND resource_type = 'erasure'
        AND resource_id = ${row.id} AND status = 'pending'
      RETURNING id
    `;
    for (const approval of settledApprovals) {
      await emitHintInTx(tx, {
        orgId: args.organizationId,
        entity: 'approval',
        entityId: approval.id,
      });
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
  args: {
    organizationId: string;
    requestId: string;
    /** The admin who clicked Retry — audited as the actor. Absent only
     * for system-driven re-arms, which audit as `system`. */
    actor?: { userId: string; email?: string };
  },
): Promise<void> {
  const holds = await loadActiveHolds(sql, args.organizationId);
  const rows = await sql<{ targetUserId: string; error: string | null }[]>`
    SELECT target_user_id AS "targetUserId", error
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
  // A watchdog-failed receipt is NOT retriable: the run timed out mid-cascade
  // and its partial state is unknown, so the next attempt must be a FRESH
  // request rather than a resume (the 0.4 rule).
  if (target.error === ERASURE_WATCHDOG_TIMEOUT_MESSAGE) {
    throw new ErasureError(
      'NOT_RETRIABLE',
      'This request timed out mid-erasure. File a new request instead.',
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
      actorId: args.actor?.userId ?? 'system',
      ...(args.actor?.email !== undefined
        ? { actorEmail: args.actor.email }
        : {}),
      actorType: args.actor !== undefined ? 'user' : 'system',
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

/**
 * `done` is a claim that every category was reached. A pass that threw, or
 * that a legal hold held off, makes the claim false — so the receipt reads
 * `partial` and names which, rather than reporting a clean erasure. Under Art
 * 19 this receipt is the subject's confirmation, so the distinction between
 * "found nothing" and "never looked" has to survive onto it.
 */
export function erasureReceiptStatus(
  failedPasses: readonly string[],
  heldOffPasses: readonly string[],
): 'done' | 'partial' {
  return failedPasses.length === 0 && heldOffPasses.length === 0
    ? 'done'
    : 'partial';
}

/** One line naming what stopped a `partial` receipt from being `done`, or
 *  `null` when nothing did. */
export function erasureReceiptError(
  failedPasses: readonly string[],
  heldOffPasses: readonly string[],
): string | null {
  const parts: string[] = [];
  if (failedPasses.length > 0) {
    parts.push(`failed passes: ${failedPasses.join(', ')}`);
  }
  if (heldOffPasses.length > 0) {
    parts.push(`held off by a legal hold: ${heldOffPasses.join(', ')}`);
  }
  return parts.length > 0 ? parts.join('; ') : null;
}

/**
 * Does the subject still belong to another organization that has not
 * disabled them?
 *
 * `login_attempts`, `login_block_counters` and the two-factor tables are
 * keyed globally, by email or by user id, while a GDPR request is scoped to
 * one organization. Wiping them for one org's request would reset the
 * lockout and 2FA backoff counters protecting every OTHER org the subject
 * belongs to, which hands a multi-org user a cross-tenant bypass. 0.4
 * refused the wipe in that case; so does this.
 *
 * 0.4 paged Better Auth's adapter at 256 memberships and failed CLOSED when
 * the page came back full, because it could not see past the cap. SQL
 * answers exactly, so neither the cap nor its guard is ported.
 */
async function subjectBelongsToOtherActiveOrg(
  sql: Sql,
  userId: string,
  excludeOrgId: string,
): Promise<boolean> {
  const rows = await sql<{ elsewhere: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM "member"
      WHERE "userId" = ${userId}
        AND "organizationId" <> ${excludeOrgId}
        AND "role" <> 'disabled'
    ) AS "elsewhere"
  `;
  return rows[0]?.elsewhere ?? false;
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
  const heldOff: string[] = [];
  const pass = async (
    name: string,
    run: () => Promise<number>,
  ): Promise<void> => {
    // The hold is re-read before EVERY pass, not once before the cascade.
    // The passes are not one transaction, and two of them fan out per-thread
    // and per-document deletes, so a hold placed mid-cascade would otherwise
    // be ignored for everything after it. 0.4 re-read holds inside all 19 of
    // its arms and named the reason: FRCP 37(e) spoliation.
    try {
      const current = await loadActiveHolds(sql, organizationId);
      if (current.orgHeld || current.userMembershipIds.has(targetUserId)) {
        heldOff.push(name);
        return;
      }
    } catch (error) {
      // An unreadable hold table is not evidence that nothing is held, so the
      // pass is skipped rather than run.
      console.error(`[erasure] hold re-check before ${name} failed:`, error);
      heldOff.push(name);
      return;
    }
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
    // Chat/task uploads — document-bound file rows ride the documents pass
    // (`purgeDocument` deletes them with the document's own blobs).
    const uploads = await sql<{ id: string; storageRef: string }[]>`
      SELECT id, storage_ref AS "storageRef" FROM app.file_metadata
      WHERE org_id = ${organizationId} AND uploaded_by = ${targetUserId}
        AND document_id IS NULL
    `;
    if (uploads.length === 0) return 0;
    const orgSlug = await resolveOrgSlug(sql, organizationId);
    if (orgSlug === null) {
      // Rows exist but no slug resolves a store: fail the pass (receipt
      // 'partial', rows kept, Retry re-attempts) instead of dropping the
      // ledger rows while the subject's bytes live on in object storage.
      throw new Error(
        `no org slug for ${organizationId}; upload blobs not deletable`,
      );
    }
    // STRICT blob-then-row — deliberately NOT the retention sweeps'
    // best-effort idiom: an erasure receipt that says done must be TRUE,
    // so a failed S3 delete throws and keeps the row for Retry. A 404 is
    // success (already gone — `s3DeleteObject` treats it so); a legacy
    // Convex ref has no reachable backend left, so only the row remains
    // to delete. The store resolves lazily inside the s3 branch so a
    // legacy-only batch never trips over an unconfigured store; upload
    // keys are minted per object (`buildObjectKey`), and the ref-dedupe
    // set guards a double-listed ref the way `purgeDocument` guards
    // `historyFiles` against `fileRef`.
    const deletedRefs = new Set<string>();
    for (const upload of uploads) {
      const parsed = parseBlobRef(upload.storageRef);
      if (parsed.backend === 's3' && !deletedRefs.has(upload.storageRef)) {
        await deleteOrgObject(orgSlug, parsed.key);
        deletedRefs.add(upload.storageRef);
      }
      await sql`DELETE FROM app.file_metadata WHERE id = ${upload.id}`;
    }
    return uploads.length;
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

  // `video_link_jobs` is its own category, not part of `uploads`: the job can
  // own a blob (Whisper audio, captions transcript) even when the linked
  // `file_metadata` row never landed, and a welcome-page paste has no thread,
  // so neither the uploads pass nor the thread cascade reaches it.
  //
  // Same STRICT blob-then-row posture the uploads pass above uses, and for
  // the same reason: a receipt that says done is a claim about the bytes.
  await pass('videoLinks', async () => {
    const jobs = await sql<{ id: string; storageRef: string | null }[]>`
      SELECT id, storage_ref AS "storageRef" FROM app.video_link_jobs
      WHERE org_id = ${organizationId} AND uploaded_by = ${targetUserId}
    `;
    if (jobs.length === 0) return 0;
    const withBlobs = jobs.filter(
      (job) => job.storageRef !== null && job.storageRef !== '',
    );
    let orgSlug: string | null = null;
    if (withBlobs.length > 0) {
      orgSlug = await resolveOrgSlug(sql, organizationId);
      if (orgSlug === null) {
        throw new Error(
          `no org slug for ${organizationId}; video-link blobs not deletable`,
        );
      }
    }
    const deletedRefs = new Set<string>();
    for (const job of jobs) {
      const ref = job.storageRef;
      if (ref !== null && ref !== '' && orgSlug !== null) {
        const parsed = parseBlobRef(ref);
        if (parsed.backend === 's3' && !deletedRefs.has(ref)) {
          await deleteOrgObject(orgSlug, parsed.key);
          deletedRefs.add(ref);
        }
      }
      await sql`DELETE FROM app.video_link_jobs WHERE id = ${job.id}`;
    }
    return jobs.length;
  });

  // The subject's own OAuth grant for Documents import — a sealed access +
  // refresh token per (org, user, provider). It outlives their membership
  // unless erasure takes it, and an in-flight authorization carries the same
  // identity in its state row.
  await pass('cloudGrants', async () => {
    const grants = await sql<{ id: string }[]>`
      DELETE FROM app.user_cloud_authorizations
      WHERE org_id = ${organizationId} AND user_id = ${targetUserId}
      RETURNING id
    `;
    const states = await sql<{ id: string }[]>`
      DELETE FROM app.cloud_import_oauth_states
      WHERE org_id = ${organizationId} AND user_id = ${targetUserId}
      RETURNING id
    `;
    return grants.length + states.length;
  });

  // Sync configs name the member whose grant the sync runs under, so they are
  // subject data AND a schedule that would keep firing against a revoked
  // grant. Imported documents are not touched here — they are org content,
  // reached by the `documents` pass when the subject created them.
  await pass('syncConfigs', async () => {
    const onedrive = await sql<{ id: string }[]>`
      DELETE FROM app.onedrive_sync_configs
      WHERE org_id = ${organizationId} AND user_id = ${targetUserId}
      RETURNING id
    `;
    const googleDrive = await sql<{ id: string }[]>`
      DELETE FROM app.google_drive_sync_configs
      WHERE org_id = ${organizationId} AND user_id = ${targetUserId}
      RETURNING id
    `;
    return onedrive.length + googleDrive.length;
  });

  // The org-level security and system bells ABOUT the subject, which are a
  // different table from the per-user inbox the `notifications` pass above
  // clears. `subject_user_id` exists for exactly this — 0002_notifications
  // calls it "the data-subject user this notification is ABOUT (GDPR Art 17
  // erasure matches on it)" — and the lockout alert stamps it on the row
  // that carries the subject's email and IP in `params`. `notification_reads`
  // falls with the row on its foreign key.
  await pass('orgNotifications', async () => {
    const removed = await sql<{ id: string }[]>`
      DELETE FROM app.notifications
      WHERE org_id = ${organizationId}
        AND subject_user_id = ${targetUserId}
      RETURNING id
    `;
    return removed.length;
  });

  // Automation runs the subject started. `input`, `output`, `trace` and
  // `effects` hold every node's resolved values, so the run is subject data
  // even though the row is org-owned. The two markers are the ones 0.5
  // writes: `user:<id>` from the app door and `api-key:<id>` from REST.
  await pass('automationRuns', async () => {
    const removed = await sql<{ id: string }[]>`
      DELETE FROM app.automation_runs
      WHERE org_id = ${organizationId}
        AND started_by = ANY(${[`user:${targetUserId}`, `api-key:${targetUserId}`]})
      RETURNING id
    `;
    return removed.length;
  });

  // Review decisions are pseudonymized rather than deleted: the decision is
  // the audit record of a governance gate, so the row stays and the identity
  // goes. `tasks.reviewer_user_id` is different — it is live routing, not
  // history, so it is cleared. Leaving it pointed at an erased user sends
  // the next review to nobody.
  await pass('reviewDecisions', async () => {
    const decisions = await sql<
      { id: string; approvedBy: string | null; metadata: unknown }[]
    >`
      SELECT id, approved_by AS "approvedBy", metadata
      FROM app.approvals
      WHERE org_id = ${organizationId} AND resource_type = 'task_review'
        AND (approved_by = ${targetUserId}
             OR metadata->>'requestedFor' = ${targetUserId}
             OR metadata->'response'->>'respondedBy' = ${targetUserId})
    `;
    let changed = 0;
    for (const row of decisions) {
      const metadata = isRecord(row.metadata) ? { ...row.metadata } : undefined;
      if (metadata !== undefined) {
        if (metadata.requestedFor === targetUserId) {
          metadata.requestedFor = ERASED_SUBJECT;
        }
        const response = metadata.response;
        if (isRecord(response) && response.respondedBy === targetUserId) {
          metadata.response = { ...response, respondedBy: ERASED_SUBJECT };
        }
      }
      await sql`
        UPDATE app.approvals SET
          approved_by = ${row.approvedBy === targetUserId ? ERASED_SUBJECT : row.approvedBy},
          metadata = ${metadata === undefined ? null : sql.json(toJson(metadata))}
        WHERE id = ${row.id}
      `;
      changed++;
    }
    const cleared = await sql<{ id: string }[]>`
      UPDATE app.tasks SET reviewer_user_id = NULL
      WHERE org_id = ${organizationId}
        AND reviewer_user_id = ${targetUserId}
      RETURNING id
    `;
    return changed + cleared.length;
  });

  // Global auth state: the lockout trail is keyed by email and the two-factor
  // backoff by user id, so neither is org-scoped. Refused outright while the
  // subject is still an active member elsewhere, because these counters
  // protect those organizations too.
  await pass('authState', async () => {
    if (
      await subjectBelongsToOtherActiveOrg(sql, targetUserId, organizationId)
    ) {
      console.warn(
        `[erasure] skipping global auth-state wipe for ${targetUserId}: still an active member of another organization`,
      );
      return 0;
    }
    const users = await sql<{ email: string | null }[]>`
      SELECT "email" FROM "user" WHERE "id" = ${targetUserId} LIMIT 1
    `;
    const email = users[0]?.email ?? null;
    let removed = 0;
    if (email !== null) {
      const normalized = normalizeAuthEmail(email);
      const attempts = await sql<{ email: string }[]>`
        DELETE FROM app.login_attempts WHERE lower(email) = ${normalized}
        RETURNING email
      `;
      const counters = await sql<{ email: string }[]>`
        DELETE FROM app.login_block_counters WHERE lower(email) = ${normalized}
        RETURNING email
      `;
      removed += attempts.length + counters.length;
    }
    const twoFactor = await sql<{ userId: string }[]>`
      DELETE FROM app.two_factor_attempts WHERE user_id = ${targetUserId}
      RETURNING user_id AS "userId"
    `;
    const grace = await sql<{ userId: string }[]>`
      DELETE FROM app.two_factor_grace WHERE user_id = ${targetUserId}
      RETURNING user_id AS "userId"
    `;
    return removed + twoFactor.length + grace.length;
  });

  await pass('auditScrub', () =>
    scrubSubjectAuditLogs(sql, organizationId, targetUserId),
  );

  const status = erasureReceiptStatus(failures, heldOff);
  await sql.begin(async (tx) => {
    await tx`
      UPDATE app.gdpr_erasure_requests SET
        status = ${status}, finished_at_ms = ${Date.now()},
        counts = ${tx.json(toJson(counts))},
        error = ${erasureReceiptError(failures, heldOff)}
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

/**
 * The dual-approval hand-off: a SECOND admin approved the erasure row, so
 * the cooling-off window starts now and the processor is scheduled (the 0.4
 * `confirmAndScheduleErasure`). Filer ≠ approver is a HARD refusal here, not
 * just a UI gate — the approvals inbox enforces it above, this enforces it
 * again at the write (the approver-must-be-an-admin half of the contract is
 * `decideApproval`'s kind gate, which runs before this dispatch). An
 * already-scheduled or no-longer-pending row is a no-op: approving twice is
 * a double-submit, not an error.
 */
export async function confirmAndScheduleErasure(
  tx: TransactionSql,
  args: { requestId: string; approverId: string; organizationId: string },
): Promise<void> {
  const rows = await tx<
    {
      id: string;
      organizationId: string;
      targetUserId: string;
      requestedBy: string;
      status: string;
      effectiveAt: number | null;
    }[]
  >`
    SELECT id, org_id AS "organizationId",
           target_user_id AS "targetUserId", requested_by AS "requestedBy",
           status, effective_at_ms::float8 AS "effectiveAt"
    FROM app.gdpr_erasure_requests
    WHERE id = ${args.requestId} AND org_id = ${args.organizationId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (row === undefined) return;
  if (row.status !== 'pending' || row.effectiveAt !== null) return;
  if (args.approverId === row.requestedBy) {
    throw new ErasureError(
      'dualApprovalRequired',
      'The filer of an erasure request cannot also approve it. Ask another admin.',
      403,
    );
  }

  const policy = await readEffectiveDsarPolicy(tx, row.organizationId);
  const effectiveAt = Date.now() + policy.coolingOffHours * HOUR_MS;
  await tx`
    UPDATE app.gdpr_erasure_requests SET effective_at_ms = ${effectiveAt}
    WHERE id = ${row.id}
  `;
  await addJobInTx(
    tx,
    'governance.process_erasure',
    { requestId: row.id },
    { startAfter: new Date(effectiveAt) },
  );
  await createAuditLog(tx, {
    organizationId: row.organizationId,
    actorId: args.approverId,
    actorType: 'user',
    action: 'gdpr_erasure_requested',
    category: 'admin',
    resourceType: 'user',
    resourceId: row.targetUserId,
    status: 'success',
    newState: {
      requestId: row.id,
      dualApproval: true,
      approvedBy: args.approverId,
      effectiveAt,
    },
  });
  await writeNotificationForOrgs(tx, {
    organizationIds: [row.organizationId],
    category: 'security',
    severity: 'warning',
    titleKey: 'dsarScheduled',
    bodyKey: 'dsarScheduledBody',
    params: {
      subjectUserId: row.targetUserId,
      requestedBy: row.requestedBy,
      requestId: row.id,
    },
    subjectUserId: row.targetUserId,
    link: { kind: 'dsar' },
  });
}

/**
 * The dual-approval refusal hand-off: the second admin REJECTED the erasure
 * row in the approvals inbox. Without this the receipt stayed `pending`
 * with `effective_at_ms` NULL forever — unschedulable, and the live
 * partial-unique index blocked ever re-filing the subject. A rejection
 * lands the receipt in the terminal `cancelled` state (the existing status
 * vocabulary; the live index covers only pending/running, so the subject
 * becomes re-filable), attributed to the rejecting admin with a distinct
 * `gdpr_erasure_rejected` audit action. An already-scheduled or settled
 * row is a no-op: the decision FSM refuses a second decide anyway, and a
 * cancel that raced ahead already settled the receipt.
 */
export async function rejectErasure(
  tx: TransactionSql,
  args: {
    requestId: string;
    rejectedBy: string;
    organizationId: string;
    comments?: string;
  },
): Promise<void> {
  const rows = await tx<
    {
      id: string;
      targetUserId: string;
      status: string;
      effectiveAt: number | null;
    }[]
  >`
    SELECT id, target_user_id AS "targetUserId", status,
           effective_at_ms::float8 AS "effectiveAt"
    FROM app.gdpr_erasure_requests
    WHERE id = ${args.requestId} AND org_id = ${args.organizationId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (row === undefined) return;
  if (row.status !== 'pending' || row.effectiveAt !== null) return;
  const now = Date.now();
  const trimmed = args.comments?.trim() ?? '';
  await tx`
    UPDATE app.gdpr_erasure_requests SET
      status = 'cancelled', cancelled_by = ${args.rejectedBy},
      cancellation_reason = ${
        trimmed !== ''
          ? `Dual approval rejected: ${trimmed}`
          : 'Dual approval rejected.'
      },
      finished_at_ms = ${now}
    WHERE id = ${row.id}
  `;
  await createAuditLog(tx, {
    organizationId: args.organizationId,
    actorId: args.rejectedBy,
    actorType: 'user',
    action: 'gdpr_erasure_rejected',
    category: 'admin',
    resourceType: 'user',
    resourceId: row.targetUserId,
    status: 'success',
    previousState: { status: 'pending' },
    newState: {
      requestId: row.id,
      status: 'cancelled',
      rejectedBy: args.rejectedBy,
      ...(trimmed !== '' ? { comments: trimmed } : {}),
    },
  });
  await emitHintInTx(tx, {
    orgId: args.organizationId,
    entity: 'gdpr_erasure',
    entityId: row.id,
  });
}

/**
 * An erasure whose processor died mid-run — the 0.4
 * `recoverStuckErasureRequests` window. Beyond it the cascade is not coming
 * back on its own.
 */
const ERASURE_WATCHDOG_TIMEOUT_MS = 35 * 60 * 1000;

/**
 * Fail erasure requests whose processor never finished.
 *
 * A receipt stuck at `running` is worse than a failed one: the subject's data
 * is partly gone, the SLA clock is running, and nothing will move it. The
 * sweep settles it as failed with a message the retry path deliberately
 * refuses to act on (the run timed out mid-cascade — the next attempt must
 * be a FRESH request, not a resume of an unknown partial state).
 */
export async function recoverStuckErasureRequests(
  sql: Sql,
  options: { staleMs?: number } = {},
): Promise<{ recovered: number }> {
  const now = Date.now();
  const cutoff = now - (options.staleMs ?? ERASURE_WATCHDOG_TIMEOUT_MS);
  const rows = await sql<
    { id: string; organizationId: string; targetUserId: string }[]
  >`
    UPDATE app.gdpr_erasure_requests SET
      status = 'failed',
      error = ${ERASURE_WATCHDOG_TIMEOUT_MESSAGE},
      finished_at_ms = ${now}
    WHERE status = 'running'
      AND coalesce(started_at_ms, requested_at_ms) < ${cutoff}
    RETURNING id, org_id AS "organizationId",
              target_user_id AS "targetUserId"
  `;
  for (const row of rows) {
    // One audit row per recovered receipt, each in its own transaction: a
    // single bad row must not roll back the whole sweep.
    await sql.begin((tx) =>
      createAuditLog(tx, {
        organizationId: row.organizationId,
        actorId: 'system',
        actorEmail: 'system@tale.so',
        actorType: 'system',
        action: 'gdpr_erasure_watchdog_failed',
        category: 'admin',
        resourceType: 'user',
        resourceId: row.targetUserId,
        resourceName: row.targetUserId,
        status: 'failure',
        errorMessage: ERASURE_WATCHDOG_TIMEOUT_MESSAGE,
        newState: { requestId: row.id, cutoff },
      }),
    );
  }
  if (rows.length > 0) {
    console.warn(
      `[watchdog] failed ${rows.length} stuck erasure request(s) past the timeout`,
    );
  }
  return { recovered: rows.length };
}
