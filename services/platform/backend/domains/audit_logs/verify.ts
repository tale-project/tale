import type { Sql } from 'postgres';

import { computeAuditHash } from '../../core/lib/helpers/audit_hash.ts';
import { writeNotificationForOrgs } from '../notifications/service.ts';
import { auditLogRetentionCutoff } from '../retention/service.ts';
import { rowToHashInput } from './hash-input.ts';
import type { AuditLogRow } from './types.ts';

/**
 * Hash-chain verification over `app.audit_logs` — the pg port of the 0.4
 * `verifyIntegrity` walk and the scheduled `auditIntegrityProgress` check.
 *
 * Anchoring: the walk trusts the FIRST REMAINING row's stored
 * `previous_hash` (retention deletes prefixes, so genesis is usually gone);
 * a resume passes the previous page's hash instead — unless the resume
 * anchor itself is gone AND old enough for the retention sweep to have
 * reaped it (`reapedBefore`), in which case the walk re-anchors on the first
 * surviving row exactly as a fresh walk would. An anchor that vanished
 * INSIDE the retention window is not excused: nothing legitimately deletes
 * an audit row there, so the linkage check runs against the resume hash and
 * reports the break. Scrubbed rows (GDPR
 * Art 17) skip recompute — their content was intentionally blanked — but
 * still participate in linkage, and each one must be covered by an erasure
 * receipt; a scrubbed row with NO matching receipt counts into
 * `unsignedScrubCount` (the 0.5 stand-in for the 0.4 signed-checkpoint
 * mismatch: flag-without-receipt is exactly what a forgery would look like).
 *
 * Order: rows sealed before chain positions existed (`chain_seq` NULL) come
 * first, in the (ts, id) order they were chained in; every row the sealer
 * chained follows in `chain_seq` order. A row not sealed yet is no break —
 * it is counted as awaiting its seal and the walk passes it by.
 */
export interface VerifyChainResult {
  valid: boolean;
  verifiedCount: number;
  checkpointsVerified: number;
  truncated: boolean;
  lastVerifiedTimestamp?: number;
  lastVerifiedId?: string;
  lastVerifiedHash?: string;
  /** Position of the last verified row; absent while the walk is still in
   * the rows sealed before positions existed. */
  lastVerifiedSeq?: string;
  unsignedScrubCount: number;
  /** Rows written and not sealed yet, and when the oldest was written. */
  awaitingSeal: { count: number; oldestTimestamp?: number };
  firstBrokenAt?: {
    logId: string;
    timestamp: number;
    expected: string;
    actual: string;
  };
  /** The resume anchor had been reaped by retention; the walk re-anchored
   * on the first surviving row's stored `previous_hash`. */
  reanchored?: boolean;
}

const VERIFY_COLUMNS = `
  id, org_id AS "organizationId", actor_id AS "actorId",
  actor_email AS "actorEmail", actor_email_hash AS "actorEmailHash",
  actor_role AS "actorRole", actor_type AS "actorType", action, category,
  resource_type AS "resourceType", resource_id AS "resourceId",
  resource_name AS "resourceName", previous_state AS "previousState",
  new_state AS "newState", changed_fields AS "changedFields",
  session_id AS "sessionId", ip_address AS "ipAddress",
  actor_ip_hash AS "actorIpHash", user_agent AS "userAgent",
  request_id AS "requestId", ts::float8 AS "timestamp", status,
  error_message AS "errorMessage", metadata,
  integrity_hash AS "integrityHash", previous_hash AS "previousHash",
  chain_seq::text AS "chainSeq", pii_scrubbed AS "piiScrubbed"
`;

/** Rows a resume may have to skip past at its anchor's timestamp. */
const SAME_TS_SLACK = 50;

export async function verifyAuditChain(
  sql: Sql,
  organizationId: string,
  args: {
    maxEntries?: number;
    fromTimestamp?: number;
    afterId?: string;
    /** The anchor's chain position, once the walk has passed the rows
     * sealed before positions existed. */
    afterSeq?: string;
    previousExpectedHash?: string;
    /** Rows with `ts` below this may have been reaped by the org's retention
     * sweep (its current cutoff). A resume anchor (`afterId` at
     * `fromTimestamp`) that is missing AND older than this re-anchors the
     * walk instead of reading as a break. */
    reapedBefore?: number;
  } = {},
): Promise<VerifyChainResult> {
  const maxEntries = Math.min(Math.max(1, args.maxEntries ?? 1000), 5000);
  const fromTs = args.fromTimestamp ?? null;
  const afterId = args.afterId ?? null;
  const afterSeq = args.afterSeq ?? null;
  // A missing anchor that was old enough for the sweep to have reaped it (a
  // job outage longer than the window, or a backlog that outpaced the daily
  // page) re-anchors on the first survivor: its successors' linkage still
  // proves the chain from there on, and holding the walk to the reaped row's
  // hash would report retention as tampering — a false verdict a broken pass
  // never advances past.
  const reaped =
    args.reapedBefore !== undefined &&
    fromTs !== null &&
    fromTs < args.reapedBefore;

  const positioned = (afterPosition: string | null, limit: number) =>
    sql<AuditLogRow[]>`
      SELECT ${sql.unsafe(VERIFY_COLUMNS)} FROM app.audit_logs
      WHERE org_id = ${organizationId} AND chain_seq IS NOT NULL
        AND (${afterPosition}::bigint IS NULL OR chain_seq >= ${afterPosition}::bigint)
      ORDER BY chain_seq ASC
      LIMIT ${limit}
    `;

  let rows: AuditLogRow[];
  let reanchored = false;
  if (afterSeq !== null) {
    // The anchor is read with the rest, to tell it present from missing.
    const read = await positioned(afterSeq, maxEntries + 2);
    if (read[0]?.chainSeq === afterSeq) {
      rows = read.slice(1);
    } else {
      rows = read;
      reanchored = afterId !== null && reaped;
    }
  } else {
    const legacy = await sql<AuditLogRow[]>`
      SELECT ${sql.unsafe(VERIFY_COLUMNS)} FROM app.audit_logs
      WHERE org_id = ${organizationId} AND chain_seq IS NULL
        AND integrity_hash IS NOT NULL
        AND (${fromTs}::bigint IS NULL OR ts >= ${fromTs})
      ORDER BY ts ASC, id ASC
      LIMIT ${maxEntries + SAME_TS_SLACK}
    `;
    // Exact resume: rows up to and INCLUDING afterId are skipped, so
    // same-timestamp siblings the `>=` re-returned still get verified.
    let startIndex = 0;
    if (afterId !== null) {
      const idx = legacy.findIndex((row) => row.id === afterId);
      if (idx !== -1) startIndex = idx + 1;
      else reanchored = reaped;
    }
    rows = legacy.slice(startIndex);
    // Past the rows sealed before positions existed, the chain goes on in
    // the sealer's order.
    if (
      rows.length <= maxEntries &&
      legacy.length < maxEntries + SAME_TS_SLACK
    ) {
      rows = rows.concat(await positioned(null, maxEntries + 1 - rows.length));
    }
  }
  const walk = rows.slice(0, maxEntries);
  const truncated = rows.length > maxEntries;
  const awaitingSeal = await countAwaitingSeal(sql, organizationId);

  const scrubbedIds = walk
    .filter((row) => row.piiScrubbed === true)
    .map((row) => row.id);
  const receiptCovered = new Set<string>();
  if (scrubbedIds.length > 0) {
    const covered = await sql<{ id: string }[]>`
      SELECT a.id FROM app.audit_logs a
      WHERE a.id = ANY(${scrubbedIds})
        AND EXISTS (
          SELECT 1 FROM app.gdpr_erasure_requests r
          WHERE r.org_id = a.org_id
            AND (r.target_user_id = a.actor_id
                 OR r.target_user_id = a.resource_id)
        )
    `;
    for (const row of covered) receiptCovered.add(row.id);
  }

  let previousHash = reanchored
    ? (walk[0]?.previousHash ?? null)
    : (args.previousExpectedHash ?? walk[0]?.previousHash ?? null);
  let verifiedCount = 0;
  let unsignedScrubCount = 0;
  let lastVerified: AuditLogRow | undefined;
  const reanchorFlag = reanchored ? { reanchored: true } : {};

  for (const row of walk) {
    const expectedPrevious = previousHash ?? null;
    const storedPrevious = row.previousHash ?? null;
    if (storedPrevious !== expectedPrevious) {
      return {
        valid: false,
        verifiedCount,
        checkpointsVerified: 0,
        truncated,
        ...verifiedThrough(lastVerified),
        unsignedScrubCount,
        awaitingSeal,
        firstBrokenAt: {
          logId: row.id,
          timestamp: row.timestamp,
          expected: expectedPrevious ?? '',
          actual: storedPrevious ?? '',
        },
        ...reanchorFlag,
      };
    }
    if (row.piiScrubbed === true) {
      // Content intentionally blanked — recompute would always diverge.
      if (!receiptCovered.has(row.id)) unsignedScrubCount += 1;
    } else {
      const recomputed = await computeAuditHash(
        storedPrevious ?? '',
        rowToHashInput(row),
      );
      if (recomputed !== row.integrityHash) {
        return {
          valid: false,
          verifiedCount,
          checkpointsVerified: 0,
          truncated,
          ...verifiedThrough(lastVerified),
          unsignedScrubCount,
          awaitingSeal,
          firstBrokenAt: {
            logId: row.id,
            timestamp: row.timestamp,
            expected: recomputed,
            actual: row.integrityHash ?? '',
          },
          ...reanchorFlag,
        };
      }
    }
    previousHash = row.integrityHash;
    verifiedCount += 1;
    lastVerified = row;
  }

  return {
    valid: true,
    verifiedCount,
    checkpointsVerified: 0,
    truncated,
    ...verifiedThrough(lastVerified),
    unsignedScrubCount,
    awaitingSeal,
    ...reanchorFlag,
  };
}

/** The resume fields of the last row a walk verified. */
function verifiedThrough(
  row: AuditLogRow | undefined,
): Pick<
  VerifyChainResult,
  | 'lastVerifiedTimestamp'
  | 'lastVerifiedId'
  | 'lastVerifiedHash'
  | 'lastVerifiedSeq'
> {
  if (row === undefined) return {};
  return {
    lastVerifiedTimestamp: row.timestamp,
    lastVerifiedId: row.id,
    ...(row.integrityHash !== null
      ? { lastVerifiedHash: row.integrityHash }
      : {}),
    ...(row.chainSeq !== null ? { lastVerifiedSeq: row.chainSeq } : {}),
  };
}

/** Rows written and not sealed yet: no break, but counted, so a sealer that
 * stopped shows. */
async function countAwaitingSeal(
  sql: Sql,
  organizationId: string,
): Promise<VerifyChainResult['awaitingSeal']> {
  const rows = await sql<{ count: number; oldest: number | null }[]>`
    SELECT count(*)::int AS count, min(ts)::float8 AS oldest
    FROM app.audit_logs
    WHERE org_id = ${organizationId} AND integrity_hash IS NULL
  `;
  const row = rows[0];
  return {
    count: row?.count ?? 0,
    ...(row?.oldest != null ? { oldestTimestamp: row.oldest } : {}),
  };
}

export interface IntegrityStatusView {
  lastVerifiedTimestamp?: number;
  lastVerifiedId?: string;
  headReached: boolean;
  updatedAt: number;
  lastAlertedFingerprint?: string;
  lastAlertedAt?: number;
  alertActive: boolean;
}

/** The scheduled check's per-org snapshot; `null` = never checked. */
export async function getIntegrityStatus(
  sql: Sql,
  organizationId: string,
): Promise<IntegrityStatusView | null> {
  const rows = await sql<
    {
      lastVerifiedTs: number | null;
      lastVerifiedId: string | null;
      headReached: boolean;
      updatedAt: number;
      lastAlertedFingerprint: string | null;
      lastAlertedAt: number | null;
    }[]
  >`
    SELECT last_verified_ts::float8 AS "lastVerifiedTs",
           last_verified_id AS "lastVerifiedId",
           head_reached AS "headReached",
           updated_at_ms::float8 AS "updatedAt",
           last_alerted_fingerprint AS "lastAlertedFingerprint",
           last_alerted_at_ms::float8 AS "lastAlertedAt"
    FROM app.audit_integrity_progress
    WHERE org_id = ${organizationId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    ...(row.lastVerifiedTs !== null
      ? { lastVerifiedTimestamp: row.lastVerifiedTs }
      : {}),
    ...(row.lastVerifiedId !== null
      ? { lastVerifiedId: row.lastVerifiedId }
      : {}),
    headReached: row.headReached,
    updatedAt: row.updatedAt,
    ...(row.lastAlertedFingerprint !== null
      ? { lastAlertedFingerprint: row.lastAlertedFingerprint }
      : {}),
    ...(row.lastAlertedAt !== null ? { lastAlertedAt: row.lastAlertedAt } : {}),
    alertActive: row.lastAlertedFingerprint !== null,
  };
}

const SCHEDULED_PAGE = 2000;

export interface ScheduledIntegrityRun {
  verified: number;
  broken: boolean;
  /** With `broken`: the admins' bell for this break is in place (written
   * now, or already there from an earlier run). `false` means the write
   * failed and the next run re-asserts it. */
  alerted?: boolean;
  /** The resume anchor had been reaped by retention and the walk
   * re-anchored on the first surviving row (see `verifyAuditChain`). */
  reanchored?: boolean;
  /** Rows not sealed yet (see `VerifyChainResult.awaitingSeal`). */
  awaitingSeal: VerifyChainResult['awaitingSeal'];
}

/**
 * One org's scheduled incremental walk: resume from the progress row,
 * verify up to a page, stamp progress. A break stamps the alert fingerprint
 * and bells the org admins — the bell is re-asserted on EVERY broken run
 * and deduplicated per fingerprint, so a failed write is retried rather
 * than lost; a clean pass that re-covers the previously-broken region
 * clears the alert.
 */
export async function runScheduledIntegrityCheck(
  sql: Sql,
  organizationId: string,
): Promise<ScheduledIntegrityRun> {
  const progress = await sql<
    {
      lastVerifiedTs: number | null;
      lastVerifiedId: string | null;
      lastVerifiedHash: string | null;
      lastVerifiedSeq: string | null;
      lastAlertedFingerprint: string | null;
    }[]
  >`
    SELECT last_verified_ts::float8 AS "lastVerifiedTs",
           last_verified_id AS "lastVerifiedId",
           last_verified_hash AS "lastVerifiedHash",
           last_verified_seq::text AS "lastVerifiedSeq",
           last_alerted_fingerprint AS "lastAlertedFingerprint"
    FROM app.audit_integrity_progress WHERE org_id = ${organizationId}
  `;
  const resume = progress[0];
  // The sweep may have reaped a resume anchor older than the org's audit
  // retention window since the last walk; the walk needs that cutoff to
  // tell a reaped anchor from a row that vanished inside the window.
  const reapedBefore =
    resume?.lastVerifiedId != null
      ? await auditLogRetentionCutoff(sql, organizationId)
      : null;
  const result = await verifyAuditChain(sql, organizationId, {
    maxEntries: SCHEDULED_PAGE,
    ...(resume?.lastVerifiedTs != null
      ? { fromTimestamp: resume.lastVerifiedTs }
      : {}),
    ...(resume?.lastVerifiedId != null
      ? { afterId: resume.lastVerifiedId }
      : {}),
    ...(resume?.lastVerifiedSeq != null
      ? { afterSeq: resume.lastVerifiedSeq }
      : {}),
    ...(resume?.lastVerifiedHash != null
      ? { previousExpectedHash: resume.lastVerifiedHash }
      : {}),
    ...(reapedBefore !== null ? { reapedBefore } : {}),
  });
  const reanchorFlag = result.reanchored === true ? { reanchored: true } : {};
  if (result.reanchored === true) {
    console.warn(
      `[audit-integrity] org ${organizationId}: resume anchor ${resume?.lastVerifiedId ?? '?'} was reaped by retention — re-anchored on the first surviving row`,
    );
  }

  const now = Date.now();
  if (!result.valid && result.firstBrokenAt !== undefined) {
    const fingerprint = `${result.firstBrokenAt.logId}:${result.firstBrokenAt.actual}`;
    await sql`
      INSERT INTO app.audit_integrity_progress (
        org_id, head_reached, updated_at_ms, last_alerted_fingerprint,
        last_alerted_at_ms
      ) VALUES (${organizationId}, false, ${now}, ${fingerprint}, ${now})
      ON CONFLICT (org_id) DO UPDATE SET
        head_reached = false, updated_at_ms = ${now},
        last_alerted_fingerprint = ${fingerprint},
        last_alerted_at_ms = CASE
          WHEN app.audit_integrity_progress.last_alerted_fingerprint
               IS DISTINCT FROM ${fingerprint}
          THEN ${now}
          ELSE app.audit_integrity_progress.last_alerted_at_ms
        END
    `;
    // Re-assert the bell on EVERY broken run. The dedupe key makes a bell
    // that is already there a no-op, so this costs one idempotent INSERT
    // per run — and a bell whose write failed last time lands now. Gating
    // it on the stamped fingerprint is what silently lost the alarm: the
    // stamp landed, the bell did not, and every later run believed the
    // admins had already been told.
    let alerted = false;
    try {
      const brokenLogId = result.firstBrokenAt.logId;
      await sql.begin((tx) =>
        writeNotificationForOrgs(tx, {
          organizationIds: [organizationId],
          category: 'security',
          severity: 'critical',
          titleKey: 'auditIntegrityFailed',
          bodyKey: 'auditIntegrityFailedDetails',
          params: {
            reason: `hash chain broken at log ${brokenLogId}`,
          },
          link: { kind: 'audit-logs', logId: brokenLogId },
          dedupeKey: `audit-integrity:${fingerprint}`,
        }),
      );
      alerted = true;
    } catch (error) {
      console.error(
        `[audit-integrity] alert bell failed for org ${organizationId} — re-asserted on the next run:`,
        error,
      );
    }
    return {
      verified: result.verifiedCount,
      broken: true,
      alerted,
      awaitingSeal: result.awaitingSeal,
      ...reanchorFlag,
    };
  }

  await sql`
    INSERT INTO app.audit_integrity_progress (
      org_id, last_verified_ts, last_verified_id, last_verified_hash,
      last_verified_seq, head_reached, updated_at_ms,
      last_alerted_fingerprint, last_alerted_at_ms
    ) VALUES (
      ${organizationId},
      ${result.lastVerifiedTimestamp ?? null},
      ${result.lastVerifiedId ?? null},
      ${result.lastVerifiedHash ?? null},
      ${result.lastVerifiedSeq ?? null}::bigint,
      ${!result.truncated}, ${now}, NULL, NULL
    )
    ON CONFLICT (org_id) DO UPDATE SET
      last_verified_ts = COALESCE(
        EXCLUDED.last_verified_ts, app.audit_integrity_progress.last_verified_ts
      ),
      last_verified_id = COALESCE(
        EXCLUDED.last_verified_id, app.audit_integrity_progress.last_verified_id
      ),
      last_verified_hash = COALESCE(
        EXCLUDED.last_verified_hash,
        app.audit_integrity_progress.last_verified_hash
      ),
      last_verified_seq = COALESCE(
        EXCLUDED.last_verified_seq,
        app.audit_integrity_progress.last_verified_seq
      ),
      head_reached = EXCLUDED.head_reached,
      updated_at_ms = ${now},
      last_alerted_fingerprint = NULL,
      last_alerted_at_ms = NULL
  `;
  return {
    verified: result.verifiedCount,
    broken: false,
    awaitingSeal: result.awaitingSeal,
    ...reanchorFlag,
  };
}

/** Every org with at least one audit row — the scheduled job's fleet. */
export async function listAuditedOrgIds(sql: Sql): Promise<string[]> {
  const rows = await sql<{ orgId: string }[]>`
    SELECT DISTINCT org_id AS "orgId" FROM app.audit_logs
  `;
  return rows.map((row) => row.orgId);
}
