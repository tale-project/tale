import {
  markRetryQueueKey,
  RETRY_QUEUE_LOCK_CLASS,
} from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import { computeAuditHash } from '../../core/lib/helpers/audit_hash.ts';
import { toJson } from '../../db/sql.ts';
import {
  channelAuditMetadata,
  currentRequestChannel,
} from '../../lib/request-channel.ts';
import {
  computeChangedFields,
  redactSensitiveFields,
  rowToHashInput,
  toStoredAuditRecord,
} from './hash-input.ts';
import { attributeApiKeyAudit } from './request-actor.ts';
import type {
  AuditContext,
  AuditLogCategory,
  AuditLogRow,
  CreateAuditLogArgs,
} from './types.ts';

/**
 * Audit chain writer, sealer and readers.
 *
 * `createAuditLog` MUST run inside the caller's transaction, so the audit
 * row commits or rolls back atomically with the change it describes. It
 * writes the row UNSEALED — no hash, no lock, no chain head — so an
 * organization's audited writes no longer queue behind one another.
 * `sealAuditChain` (the worker's sealer, `startAuditSealer`) seals each
 * organization's unsealed rows in batches under the chain key: it hashes
 * each row onto the one before it and gives it the next `chain_seq`, the
 * chain's order (`ts` stays the moment the event happened; a transaction
 * that commits late is sealed after rows with a later `ts`). Hash algorithm
 * and canonical record layout are the 0.4 ones, so chains imported at
 * cutover keep verifying; the sealer hashes the row as stored
 * (`rowToHashInput`) — exactly what the verifier rebuilds.
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
  chain_seq::text AS "chainSeq", pii_scrubbed AS "piiScrubbed"
`;

interface ChainHead {
  lastHash: string;
  lastTs: number;
  lastSeq: string;
}

/** Retry-queue key of an org's audit chain: the key the sealer seals under. */
export function auditChainQueueKey(organizationId: string): string {
  return `audit-chain:${organizationId}`;
}

/**
 * Take the org's audit chain: the transaction-level advisory lock on the
 * chain's queue key, held until commit. The sealer seals under it (and an
 * image from before sealing moved off the write path appended under it), so
 * whoever holds it has the chain to themselves.
 *
 * For a writer that must hold the chain AHEAD of another lock: an event
 * dispatch about to stamp a trigger row, or a run removal whose delete
 * clears the trigger that names the run, takes it here, because a landing
 * run writes that row only after its own audit row (the lock order in
 * `automations/trigger-failures.ts`). Waiting on it never raises a
 * serialization failure; a deadlock is marked with the queue key, like one
 * raised at the head.
 */
export async function lockAuditChain(
  tx: TransactionSql,
  organizationId: string,
): Promise<void> {
  const queueKey = auditChainQueueKey(organizationId);
  try {
    await tx`
      SELECT pg_advisory_xact_lock(${RETRY_QUEUE_LOCK_CLASS}, hashtext(${queueKey}))
    `;
  } catch (error) {
    throw markRetryQueueKey(error, queueKey);
  }
}

/**
 * {@link lockAuditChain} without waiting: `true` when this transaction now
 * holds the org's chain key (or already did), `false` when another holds it.
 * For a sweep that must not stall behind one busy organization — the wake
 * scan (`automations/wakes.ts`) skips that org for the minute instead; the
 * order stays the chain key first.
 */
export async function tryLockAuditChain(
  tx: TransactionSql,
  organizationId: string,
): Promise<boolean> {
  const queueKey = auditChainQueueKey(organizationId);
  const rows = await tx<{ locked: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(${RETRY_QUEUE_LOCK_CLASS}, hashtext(${queueKey})) AS locked
  `;
  // oxlint-disable-next-line typescript/no-unnecessary-boolean-literal-compare -- only an explicit database true admits a sweep
  return rows[0]?.locked === true;
}

/**
 * Read the org's chain head for a sealing pass, locked: the sealer holds the
 * chain key already, and the row lock keeps an image from before sealing
 * moved off the write path — which appends under the same head — in order.
 */
async function readChainHead(
  tx: TransactionSql,
  organizationId: string,
): Promise<ChainHead> {
  // Ensure-then-lock: the INSERT is a no-op after the org's first seal.
  await tx`
    INSERT INTO app.audit_chain_heads (org_id) VALUES (${organizationId})
    ON CONFLICT (org_id) DO NOTHING
  `;
  const rows = await tx<ChainHead[]>`
    SELECT last_hash AS "lastHash", last_ts::float8 AS "lastTs",
           last_seq::text AS "lastSeq"
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
 * Self-check before a pass extends the chain: recompute the newest sealed
 * row's hash and compare it with the head the pass chains onto. Tamper
 * detection proper is the scheduled walk (`verify.ts`); this MUST never stop
 * the seal (log and continue). Rows written by 0.4's frozen v1 algorithm
 * only exist in imported data; the cutover importer re-anchors those chains,
 * so no v1 fallback here.
 */
async function selfCheckChainHead(
  tx: TransactionSql,
  organizationId: string,
  head: ChainHead,
): Promise<void> {
  if (head.lastHash === '') {
    return;
  }
  try {
    const rows = await tx<AuditLogRow[]>`
      SELECT ${tx.unsafe(ROW_COLUMNS)} FROM app.audit_logs
      WHERE org_id = ${organizationId} AND integrity_hash = ${head.lastHash}
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

/**
 * The row as the caller described it, plus the door it came through: inside
 * a request channel (an MCP tool call, a REST definition write) `metadata`
 * gains `via`, the tool, the API key and the client, and `requestId` the
 * request's, unless the writer named its own `via` (the skills publish
 * door). What the channel stamps WINS over a writer's key of the same name:
 * the channel's `apiKeyId` is the key that made the call, and a writer that
 * records another key (one it created, say) names it differently — an
 * admin reading the row must never be pointed at the wrong key to revoke.
 * Applied BEFORE hashing, so the stored row and its hash agree and the
 * verifier, which rebuilds from the row, sees the same record.
 */
function withRequestChannel(args: CreateAuditLogArgs): CreateAuditLogArgs {
  const channel = currentRequestChannel();
  if (channel === undefined) return args;
  const stamped =
    args.metadata?.via === undefined
      ? {
          metadata: {
            ...args.metadata,
            ...channelAuditMetadata(channel),
          },
        }
      : {};
  return {
    ...args,
    ...stamped,
    ...(args.requestId === undefined && channel.requestId !== undefined
      ? { requestId: channel.requestId }
      : {}),
  };
}

/**
 * Write one audit row inside the caller's transaction, unsealed: the sealer
 * chains it within seconds (`sealAuditChain`).
 */
export async function createAuditLog(
  tx: TransactionSql,
  callerArgs: CreateAuditLogArgs,
): Promise<string> {
  const args = attributeApiKeyAudit(withRequestChannel(callerArgs));
  const redactedPreviousState = redactSensitiveFields(args.previousState);
  const redactedNewState = redactSensitiveFields(args.newState);
  const changedFields =
    args.changedFields ??
    computeChangedFields(args.previousState, args.newState);
  const timestamp = Date.now();

  // Insert the STORED form: every text field and jsonb payload shaped the
  // way Postgres hands it back (lone surrogates and NUL → U+FFFD, jsonb
  // through one JSON round-trip). The sealer hashes the row as read back,
  // and anything storage would refuse must not take the user's transaction
  // with it.
  const stored = toStoredAuditRecord({
    ...args,
    previousState: redactedPreviousState,
    newState: redactedNewState,
    changedFields,
    timestamp,
  });

  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.audit_logs (
      org_id, actor_id, actor_email, actor_email_hash, actor_role,
      actor_type, action, category, resource_type, resource_id,
      resource_name, previous_state, new_state, changed_fields, session_id,
      ip_address, actor_ip_hash, user_agent, request_id, ts, status,
      error_message, metadata
    ) VALUES (
      ${stored.organizationId}, ${stored.actorId}, ${stored.actorEmail ?? null},
      ${stored.actorEmailHash ?? null}, ${stored.actorRole ?? null},
      ${stored.actorType}, ${stored.action}, ${stored.category},
      ${stored.resourceType}, ${stored.resourceId ?? null},
      ${stored.resourceName ?? null},
      ${stored.previousState === undefined ? null : tx.json(toJson(stored.previousState))},
      ${stored.newState === undefined ? null : tx.json(toJson(stored.newState))},
      ${stored.changedFields.length > 0 ? stored.changedFields : null},
      ${stored.sessionId ?? null}, ${stored.ipAddress ?? null},
      ${stored.actorIpHash ?? null}, ${stored.userAgent ?? null},
      ${stored.requestId ?? null}, ${timestamp}, ${stored.status},
      ${stored.errorMessage ?? null},
      ${stored.metadata === undefined ? null : tx.json(toJson(stored.metadata))}
    )
    RETURNING id
  `;
  const row = inserted[0];
  if (!row) {
    throw new Error('audit insert returned no row');
  }
  return row.id;
}

/** Rows one sealing pass chains at most, per organization. */
const SEAL_BATCH = 500;

/**
 * Seal one batch of the org's unsealed rows, oldest `ts` first: each row is
 * hashed onto the one before it and takes the next `chain_seq`; the head
 * moves once per batch. Returns how many rows were sealed — 0 when nothing
 * waited, or when another holder has the chain (another worker's sealer, an
 * image from before this change appending, a writer coordinating under the
 * chain key): the next pass picks the rows up.
 */
export async function sealAuditChain(
  sql: Sql,
  organizationId: string,
  options: { batch?: number } = {},
): Promise<number> {
  const batch = options.batch ?? SEAL_BATCH;
  return sql.begin(async (tx) => {
    if (!(await tryLockAuditChain(tx, organizationId))) return 0;
    const pending = await tx<AuditLogRow[]>`
      SELECT ${tx.unsafe(ROW_COLUMNS)} FROM app.audit_logs
      WHERE org_id = ${organizationId} AND integrity_hash IS NULL
      ORDER BY ts ASC, id ASC
      LIMIT ${batch}
      FOR UPDATE
    `;
    if (pending.length === 0) return 0;
    const head = await readChainHead(tx, organizationId);
    await selfCheckChainHead(tx, organizationId, head);

    let previous = head.lastHash;
    let seq = BigInt(head.lastSeq);
    let lastTs = head.lastTs;
    const ids: string[] = [];
    const previousHashes: (string | null)[] = [];
    const hashes: string[] = [];
    const seqs: string[] = [];
    for (const row of pending) {
      const hash = await computeAuditHash(previous, rowToHashInput(row));
      seq += 1n;
      ids.push(row.id);
      previousHashes.push(previous === '' ? null : previous);
      hashes.push(hash);
      seqs.push(seq.toString());
      previous = hash;
      lastTs = Math.max(lastTs, row.timestamp);
    }
    await tx`
      UPDATE app.audit_logs AS a
      SET integrity_hash = s.hash, previous_hash = s.previous,
          chain_seq = s.seq::bigint
      FROM unnest(
        ${ids}::text[], ${previousHashes}::text[], ${hashes}::text[],
        ${seqs}::text[]
      ) AS s(id, previous, hash, seq)
      WHERE a.id = s.id
    `;
    await tx`
      UPDATE app.audit_chain_heads
      SET last_hash = ${previous}, last_ts = ${lastTs},
          last_seq = ${seq.toString()}::bigint
      WHERE org_id = ${organizationId}
    `;
    return pending.length;
  });
}

/** Seal everything the org has waiting — for a reader that wants the whole
 * chain (the on-demand check, an export) rather than the sealer's cadence.
 * Stops early when another holder has the chain. */
export async function sealAuditChainNow(
  sql: Sql,
  organizationId: string,
): Promise<number> {
  let total = 0;
  for (;;) {
    const sealed = await sealAuditChain(sql, organizationId);
    total += sealed;
    if (sealed < SEAL_BATCH) return total;
  }
}

/** Every org with a row waiting to be sealed. */
export async function listUnsealedOrgIds(sql: Sql): Promise<string[]> {
  const rows = await sql<{ orgId: string }[]>`
    SELECT DISTINCT org_id AS "orgId" FROM app.audit_logs
    WHERE integrity_hash IS NULL
  `;
  return rows.map((row) => row.orgId);
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
    /** Restrict to `failure`/`denied` rows (the Error-logs tab). */
    onlyErrors?: boolean;
  } = {},
): Promise<{
  items: AuditLogRow[];
  nextCursor: { ts: number; id: string } | null;
}> {
  // Clamped here, not only at the doors: a negative or fractional limit
  // reaching `LIMIT` is a Postgres error, and every caller pages through
  // this one function.
  const limit = Math.min(Math.max(1, Math.trunc(options.limit ?? 50)), 200);
  const filter = options.filter ?? {};
  const cursor = options.cursor ?? null;
  const search = filter.search ? `%${filter.search}%` : null;
  const onlyErrors = options.onlyErrors === true;

  const rows = await sql<AuditLogRow[]>`
    SELECT ${sql.unsafe(ROW_COLUMNS)} FROM app.audit_logs
    WHERE org_id = ${organizationId}
      AND (${filter.category ?? null}::text IS NULL OR category = ${filter.category ?? null})
      AND (${filter.actorId ?? null}::text IS NULL OR actor_id = ${filter.actorId ?? null})
      AND (${filter.resourceType ?? null}::text IS NULL OR resource_type = ${filter.resourceType ?? null})
      AND (${filter.resourceId ?? null}::text IS NULL OR resource_id = ${filter.resourceId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${onlyErrors}::boolean IS NOT true OR status IN ('failure', 'denied'))
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

/** One row by id (the detail dialog / deep link). */
export async function getAuditLogById(
  sql: Sql,
  organizationId: string,
  logId: string,
): Promise<AuditLogRow | null> {
  const rows = await sql<AuditLogRow[]>`
    SELECT ${sql.unsafe(ROW_COLUMNS)} FROM app.audit_logs
    WHERE org_id = ${organizationId} AND id = ${logId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export interface ActivitySummary {
  totalActions: number;
  successCount: number;
  failureCount: number;
  deniedCount: number;
  byCategory: Record<string, number>;
  byResourceType: Record<string, number>;
  topActors: Array<{ actorId: string; actorEmail?: string; count: number }>;
}

/** The Logs page's activity roll-up over a trailing window (the 0.4
 * `getActivitySummary`). */
export async function getActivitySummary(
  sql: Sql,
  organizationId: string,
  args: { periodDays?: number } = {},
): Promise<ActivitySummary> {
  const periodDays = Math.min(Math.max(1, args.periodDays ?? 7), 365);
  const startDate = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  const totals = await sql<
    { status: string; category: string; resourceType: string; count: number }[]
  >`
    SELECT status, category, resource_type AS "resourceType",
           count(*)::int AS count
    FROM app.audit_logs
    WHERE org_id = ${organizationId} AND ts >= ${startDate}
    GROUP BY status, category, resource_type
  `;
  const summary: ActivitySummary = {
    totalActions: 0,
    successCount: 0,
    failureCount: 0,
    deniedCount: 0,
    byCategory: {},
    byResourceType: {},
    topActors: [],
  };
  for (const row of totals) {
    summary.totalActions += row.count;
    if (row.status === 'success') summary.successCount += row.count;
    else if (row.status === 'failure') summary.failureCount += row.count;
    else if (row.status === 'denied') summary.deniedCount += row.count;
    summary.byCategory[row.category] =
      (summary.byCategory[row.category] ?? 0) + row.count;
    summary.byResourceType[row.resourceType] =
      (summary.byResourceType[row.resourceType] ?? 0) + row.count;
  }
  const actors = await sql<
    { actorId: string; actorEmail: string | null; count: number }[]
  >`
    SELECT actor_id AS "actorId", max(actor_email) AS "actorEmail",
           count(*)::int AS count
    FROM app.audit_logs
    WHERE org_id = ${organizationId} AND ts >= ${startDate}
    GROUP BY actor_id
    ORDER BY count DESC
    LIMIT 5
  `;
  summary.topActors = actors.map((row) => {
    const actor: ActivitySummary['topActors'][number] = {
      actorId: row.actorId,
      count: row.count,
    };
    if (row.actorEmail !== null) actor.actorEmail = row.actorEmail;
    return actor;
  });
  return summary;
}

const EXPORT_MAX_ROWS = 10_000;
const EXPORT_CSV_HEADERS = [
  'timestamp',
  'action',
  'category',
  'actorEmail',
  'actorId',
  'actorType',
  'actorRole',
  'resourceType',
  'resourceId',
  'resourceName',
  'status',
  'errorMessage',
] as const;

/** A cell whose first character a spreadsheet would read as a formula
 * (`=`, `+`, `-`, `@`, tab, CR). Titles and e-mails are member-authored,
 * and the export's reader is the most privileged one in the org, so such
 * a cell is neutralised with a leading apostrophe (the OWASP CSV-injection
 * mitigation) before the ordinary quoting runs. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function csvCell(value: unknown): string {
  if (value == null) return '';
  const raw =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);
  const str = FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replaceAll('"', '""') + '"';
  }
  return str;
}

/** Build the export payload (the 0.4 `exportAuditLogs` formats, verbatim
 * CSV column set). Rows walk newest-first up to the cap. */
export async function buildAuditExport(
  sql: Sql,
  organizationId: string,
  args: { format: 'csv' | 'json'; filter?: AuditLogFilter },
): Promise<{ content: string; fileName: string; contentType: string }> {
  const rows: AuditLogRow[] = [];
  let cursor: { ts: number; id: string } | null = null;
  while (rows.length < EXPORT_MAX_ROWS) {
    const page = await listAuditLogs(sql, organizationId, {
      ...(args.filter !== undefined ? { filter: args.filter } : {}),
      limit: Math.min(200, EXPORT_MAX_ROWS - rows.length),
      cursor,
    });
    rows.push(...page.items);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  if (args.format === 'json') {
    return {
      content: JSON.stringify(rows, null, 2),
      fileName: `audit-logs-${timestamp}.json`,
      contentType: 'application/json',
    };
  }
  const lines = rows.map((row) =>
    EXPORT_CSV_HEADERS.map((header) => {
      const value = row[header];
      if (header === 'timestamp' && typeof value === 'number') {
        return new Date(value).toISOString();
      }
      return csvCell(value);
    }).join(','),
  );
  return {
    content: [EXPORT_CSV_HEADERS.join(','), ...lines].join('\n'),
    fileName: `audit-logs-${timestamp}.csv`,
    contentType: 'text/csv',
  };
}
