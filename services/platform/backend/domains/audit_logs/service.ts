import type { Sql, TransactionSql } from 'postgres';

import { computeAuditHash } from '../../../convex/lib/helpers/audit_hash.ts';
import { toJson } from '../../db/sql.ts';
import {
  buildAuditRecordHashInput,
  computeChangedFields,
  redactSensitiveFields,
  rowToHashInput,
} from './hash-input.ts';
import type {
  AuditContext,
  AuditLogCategory,
  AuditLogRow,
  CreateAuditLogArgs,
} from './types.ts';

/**
 * Audit chain writer + readers.
 *
 * `createAuditLog` MUST run inside the caller's transaction: it locks the
 * per-org chain head (`FOR UPDATE`), so concurrent appends serialize and the
 * chain cannot fork; the audit row commits or rolls back atomically with the
 * change it describes. Hash algorithm and canonical record layout are the
 * 0.4 ones, so chains imported at cutover keep verifying.
 */

const ROW_COLUMNS = `
  id, org_id AS "organizationId", actor_id AS "actorId",
  actor_email AS "actorEmail", actor_email_hash AS "actorEmailHash",
  actor_role AS "actorRole", actor_type AS "actorType",
  action, category, resource_type AS "resourceType",
  resource_id AS "resourceId", resource_name AS "resourceName",
  previous_state AS "previousState", new_state AS "newState",
  changed_fields AS "changedFields", session_id AS "sessionId",
  ip_address AS "ipAddress", actor_ip_hash AS "actorIpHash",
  user_agent AS "userAgent", request_id AS "requestId",
  ts::float8 AS "timestamp", status, error_message AS "errorMessage", metadata,
  integrity_hash AS "integrityHash", previous_hash AS "previousHash",
  pii_scrubbed AS "piiScrubbed"
`;

interface ChainHead {
  lastHash: string;
  lastTs: number;
}

async function lockChainHead(
  tx: TransactionSql,
  organizationId: string,
): Promise<ChainHead> {
  // Ensure-then-lock: the INSERT is a no-op after the org's first audit
  // write; the SELECT takes the row lock that serializes this org's chain.
  await tx`
    INSERT INTO app.audit_chain_heads (org_id) VALUES (${organizationId})
    ON CONFLICT (org_id) DO NOTHING
  `;
  const rows = await tx<{ lastHash: string; lastTs: number }[]>`
    SELECT last_hash AS "lastHash", last_ts::float8 AS "lastTs"
    FROM app.audit_chain_heads
    WHERE org_id = ${organizationId}
    FOR UPDATE
  `;
  const head = rows[0];
  if (!head) {
    throw new Error(`audit chain head vanished for org ${organizationId}`);
  }
  return head;
}

/**
 * Inline self-check: recompute the prior head row's hash and compare. The
 * only automated tamper detection on the hot path — MUST never abort the
 * legitimate write (log and continue). Rows written by 0.4's frozen v1
 * algorithm only exist in imported data; the cutover importer re-anchors
 * those chains, so no v1 fallback here.
 */
async function selfCheckPriorRow(
  tx: TransactionSql,
  organizationId: string,
  expectedHash: string,
): Promise<void> {
  if (expectedHash === '') {
    return;
  }
  try {
    const rows = await tx<AuditLogRow[]>`
      SELECT ${tx.unsafe(ROW_COLUMNS)} FROM app.audit_logs
      WHERE org_id = ${organizationId}
      ORDER BY ts DESC
      LIMIT 1
    `;
    const lastEntry = rows[0];
    if (!lastEntry || lastEntry.piiScrubbed === true) {
      return;
    }
    const recomputed = await computeAuditHash(
      lastEntry.previousHash ?? '',
      rowToHashInput(lastEntry),
    );
    if (recomputed !== lastEntry.integrityHash) {
      console.error('[audit-chain] tamper detected on prior row', {
        orgId: organizationId,
        rowId: lastEntry.id,
        stored: lastEntry.integrityHash,
        recomputed,
      });
    }
  } catch (error) {
    console.warn('[audit-chain] self-check threw, skipping', {
      err: String(error),
    });
  }
}

/** Append one audit row to the org's chain inside the caller's transaction. */
export async function createAuditLog(
  tx: TransactionSql,
  args: CreateAuditLogArgs,
): Promise<string> {
  const head = await lockChainHead(tx, args.organizationId);
  await selfCheckPriorRow(tx, args.organizationId, head.lastHash);

  const redactedPreviousState = redactSensitiveFields(args.previousState);
  const redactedNewState = redactSensitiveFields(args.newState);
  const changedFields =
    args.changedFields ??
    computeChangedFields(args.previousState, args.newState);

  // Monotonic clamp: the chain is ordered by `ts` for both head-pick and
  // verify walk, so a backwards wall-clock step must not sort a new row
  // before the head it chains off (see the 0.4 writer's tradeoff note).
  const timestamp = Math.max(Date.now(), head.lastTs + 1);

  const recordForHash = buildAuditRecordHashInput({
    ...args,
    previousState: redactedPreviousState,
    newState: redactedNewState,
    changedFields,
    timestamp,
  });
  const integrityHash = await computeAuditHash(head.lastHash, recordForHash);

  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.audit_logs (
      org_id, actor_id, actor_email, actor_email_hash, actor_role,
      actor_type, action, category, resource_type, resource_id,
      resource_name, previous_state, new_state, changed_fields, session_id,
      ip_address, actor_ip_hash, user_agent, request_id, ts, status,
      error_message, metadata, integrity_hash, previous_hash
    ) VALUES (
      ${args.organizationId}, ${args.actorId}, ${args.actorEmail ?? null},
      ${args.actorEmailHash ?? null}, ${args.actorRole ?? null},
      ${args.actorType}, ${args.action}, ${args.category},
      ${args.resourceType}, ${args.resourceId ?? null},
      ${args.resourceName ?? null},
      ${redactedPreviousState === undefined ? null : tx.json(toJson(redactedPreviousState))},
      ${redactedNewState === undefined ? null : tx.json(toJson(redactedNewState))},
      ${changedFields.length > 0 ? changedFields : null},
      ${args.sessionId ?? null}, ${args.ipAddress ?? null},
      ${args.actorIpHash ?? null}, ${args.userAgent ?? null},
      ${args.requestId ?? null}, ${timestamp}, ${args.status},
      ${args.errorMessage ?? null},
      ${args.metadata === undefined ? null : tx.json(toJson(args.metadata))},
      ${integrityHash}, ${head.lastHash === '' ? null : head.lastHash}
    )
    RETURNING id
  `;
  const row = inserted[0];
  if (!row) {
    throw new Error('audit insert returned no row');
  }

  await tx`
    UPDATE app.audit_chain_heads
    SET last_hash = ${integrityHash}, last_ts = ${timestamp}
    WHERE org_id = ${args.organizationId}
  `;
  return row.id;
}

function auditCtxFields(auditCtx: AuditContext) {
  return {
    organizationId: auditCtx.organizationId,
    actorId: auditCtx.actor.id,
    ...(auditCtx.actor.email !== undefined
      ? { actorEmail: auditCtx.actor.email }
      : {}),
    ...(auditCtx.actor.role !== undefined
      ? { actorRole: auditCtx.actor.role }
      : {}),
    actorType: auditCtx.actor.type,
    ...(auditCtx.sessionId !== undefined
      ? { sessionId: auditCtx.sessionId }
      : {}),
    ...(auditCtx.ipAddress !== undefined
      ? { ipAddress: auditCtx.ipAddress }
      : {}),
    ...(auditCtx.userAgent !== undefined
      ? { userAgent: auditCtx.userAgent }
      : {}),
    ...(auditCtx.requestId !== undefined
      ? { requestId: auditCtx.requestId }
      : {}),
  };
}

interface LogEventOptions {
  auditCtx: AuditContext;
  action: string;
  category: AuditLogCategory;
  resourceType: string;
  resourceId?: string;
  resourceName?: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export function logSuccess(
  tx: TransactionSql,
  options: LogEventOptions,
): Promise<string> {
  const { auditCtx, ...rest } = options;
  return createAuditLog(tx, {
    ...auditCtxFields(auditCtx),
    ...rest,
    status: 'success',
  });
}

export function logFailure(
  tx: TransactionSql,
  options: LogEventOptions & { errorMessage: string },
): Promise<string> {
  const { auditCtx, ...rest } = options;
  return createAuditLog(tx, {
    ...auditCtxFields(auditCtx),
    ...rest,
    status: 'failure',
  });
}

export function logDenied(
  tx: TransactionSql,
  options: LogEventOptions & { errorMessage?: string },
): Promise<string> {
  const { auditCtx, ...rest } = options;
  return createAuditLog(tx, {
    ...auditCtxFields(auditCtx),
    ...rest,
    status: 'denied',
  });
}

/** Member-POV "joined organization" row (org create / invitation accept). */
export function logJoinedOrganization(
  tx: TransactionSql,
  args: {
    organizationId: string;
    userId: string;
    userEmail?: string;
    userRole?: string;
  },
): Promise<string> {
  return createAuditLog(tx, {
    organizationId: args.organizationId,
    actorId: args.userId,
    ...(args.userEmail !== undefined ? { actorEmail: args.userEmail } : {}),
    ...(args.userRole !== undefined ? { actorRole: args.userRole } : {}),
    actorType: 'user',
    action: 'joined_organization',
    category: 'member',
    resourceType: 'member',
    resourceId: args.userId,
    status: 'success',
  });
}

export interface AuditLogFilter {
  category?: AuditLogCategory;
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  status?: 'success' | 'failure' | 'denied';
  startDate?: number;
  endDate?: number;
  search?: string;
}

/**
 * Keyset-paginated audit list for one org, newest first. Cursor is the
 * `(ts, id)` pair of the last row, so pagination is stable under inserts.
 */
export async function listAuditLogs(
  sql: Sql,
  organizationId: string,
  options: {
    filter?: AuditLogFilter;
    limit?: number;
    cursor?: { ts: number; id: string } | null;
  } = {},
): Promise<{
  items: AuditLogRow[];
  nextCursor: { ts: number; id: string } | null;
}> {
  const limit = Math.min(options.limit ?? 50, 200);
  const filter = options.filter ?? {};
  const cursor = options.cursor ?? null;
  const search = filter.search ? `%${filter.search}%` : null;

  const rows = await sql<AuditLogRow[]>`
    SELECT ${sql.unsafe(ROW_COLUMNS)} FROM app.audit_logs
    WHERE org_id = ${organizationId}
      AND (${filter.category ?? null}::text IS NULL OR category = ${filter.category ?? null})
      AND (${filter.actorId ?? null}::text IS NULL OR actor_id = ${filter.actorId ?? null})
      AND (${filter.resourceType ?? null}::text IS NULL OR resource_type = ${filter.resourceType ?? null})
      AND (${filter.resourceId ?? null}::text IS NULL OR resource_id = ${filter.resourceId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.startDate ?? null}::bigint IS NULL OR ts >= ${filter.startDate ?? null})
      AND (${filter.endDate ?? null}::bigint IS NULL OR ts <= ${filter.endDate ?? null})
      AND (${search}::text IS NULL OR (
        action ILIKE ${search} OR resource_type ILIKE ${search}
        OR coalesce(resource_name, '') ILIKE ${search}
        OR coalesce(actor_email, '') ILIKE ${search}
      ))
      AND (${cursor?.ts ?? null}::bigint IS NULL
        OR ts < ${cursor?.ts ?? null}
        OR (ts = ${cursor?.ts ?? null} AND id < ${cursor?.id ?? null}))
    ORDER BY ts DESC, id DESC
    LIMIT ${limit + 1}
  `;

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor:
      rows.length > limit && last ? { ts: last.timestamp, id: last.id } : null,
  };
}
