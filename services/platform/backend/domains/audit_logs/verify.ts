import type { Sql } from 'postgres';

import { computeAuditHash } from '../../core/lib/helpers/audit_hash.ts';
import { writeNotificationForOrgs } from '../notifications/service.ts';
import { rowToHashInput } from './hash-input.ts';
import type { AuditLogRow } from './types.ts';

/**
 * Hash-chain verification over `app.audit_logs` — the pg port of the 0.4
 * `verifyIntegrity` walk and the scheduled `auditIntegrityProgress` check.
 *
 * Anchoring: the walk trusts the FIRST REMAINING row's stored
 * `previous_hash` (retention deletes prefixes, so genesis is usually gone);
 * a resume passes the previous page's hash instead. Scrubbed rows (GDPR
 * Art 17) skip recompute — their content was intentionally blanked — but
 * still participate in linkage, and each one must be covered by an erasure
 * receipt; a scrubbed row with NO matching receipt counts into
 * `unsignedScrubCount` (the 0.5 stand-in for the 0.4 signed-checkpoint
 * mismatch: flag-without-receipt is exactly what a forgery would look like).
 */
export interface VerifyChainResult {
  valid: boolean;
  verifiedCount: number;
  checkpointsVerified: number;
  truncated: boolean;
  lastVerifiedTimestamp?: number;
  lastVerifiedId?: string;
  lastVerifiedHash?: string;
  unsignedScrubCount: number;
  firstBrokenAt?: {
    logId: string;
    timestamp: number;
    expected: string;
    actual: string;
  };
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
  pii_scrubbed AS "piiScrubbed"
`;

export async function verifyAuditChain(
  sql: Sql,
  organizationId: string,
  args: {
    maxEntries?: number;
    fromTimestamp?: number;
    afterId?: string;
    previousExpectedHash?: string;
  } = {},
): Promise<VerifyChainResult> {
  const maxEntries = Math.min(Math.max(1, args.maxEntries ?? 1000), 5000);
  const fromTs = args.fromTimestamp ?? null;
  const afterId = args.afterId ?? null;

  const rows = await sql<AuditLogRow[]>`
    SELECT ${sql.unsafe(VERIFY_COLUMNS)} FROM app.audit_logs
    WHERE org_id = ${organizationId}
      AND (${fromTs}::bigint IS NULL OR ts >= ${fromTs})
    ORDER BY ts ASC, id ASC
    LIMIT ${maxEntries + 50}
  `;
  // Exact resume: rows up to and INCLUDING afterId are skipped, so
  // same-timestamp siblings the `>=` re-returned still get verified.
  let startIndex = 0;
  if (afterId !== null) {
    const idx = rows.findIndex((row) => row.id === afterId);
    if (idx !== -1) startIndex = idx + 1;
  }
  const walk = rows.slice(startIndex, startIndex + maxEntries);
  const truncated = rows.length - startIndex > maxEntries;

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

  let previousHash = args.previousExpectedHash ?? walk[0]?.previousHash ?? null;
  let verifiedCount = 0;
  let unsignedScrubCount = 0;
  let lastVerified: AuditLogRow | undefined;

  for (const row of walk) {
    const expectedPrevious = previousHash ?? null;
    const storedPrevious = row.previousHash ?? null;
    if (storedPrevious !== expectedPrevious) {
      return {
        valid: false,
        verifiedCount,
        checkpointsVerified: 0,
        truncated,
        ...(lastVerified !== undefined
          ? {
              lastVerifiedTimestamp: lastVerified.timestamp,
              lastVerifiedId: lastVerified.id,
              lastVerifiedHash: lastVerified.integrityHash,
            }
          : {}),
        unsignedScrubCount,
        firstBrokenAt: {
          logId: row.id,
          timestamp: row.timestamp,
          expected: expectedPrevious ?? '',
          actual: storedPrevious ?? '',
        },
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
          ...(lastVerified !== undefined
            ? {
                lastVerifiedTimestamp: lastVerified.timestamp,
                lastVerifiedId: lastVerified.id,
                lastVerifiedHash: lastVerified.integrityHash,
              }
            : {}),
          unsignedScrubCount,
          firstBrokenAt: {
            logId: row.id,
            timestamp: row.timestamp,
            expected: recomputed,
            actual: row.integrityHash,
          },
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
    ...(lastVerified !== undefined
      ? {
          lastVerifiedTimestamp: lastVerified.timestamp,
          lastVerifiedId: lastVerified.id,
          lastVerifiedHash: lastVerified.integrityHash,
        }
      : {}),
    unsignedScrubCount,
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

/**
 * One org's scheduled incremental walk: resume from the progress row,
 * verify up to a page, stamp progress. A break stamps the alert
 * fingerprint and bells the org admins ONCE per fingerprint; a clean pass
 * that re-covers the previously-broken region clears the alert.
 */
export async function runScheduledIntegrityCheck(
  sql: Sql,
  organizationId: string,
): Promise<{ verified: number; broken: boolean }> {
  const progress = await sql<
    {
      lastVerifiedTs: number | null;
      lastVerifiedId: string | null;
      lastVerifiedHash: string | null;
      lastAlertedFingerprint: string | null;
    }[]
  >`
    SELECT last_verified_ts::float8 AS "lastVerifiedTs",
           last_verified_id AS "lastVerifiedId",
           last_verified_hash AS "lastVerifiedHash",
           last_alerted_fingerprint AS "lastAlertedFingerprint"
    FROM app.audit_integrity_progress WHERE org_id = ${organizationId}
  `;
  const resume = progress[0];
  const result = await verifyAuditChain(sql, organizationId, {
    maxEntries: SCHEDULED_PAGE,
    ...(resume?.lastVerifiedTs != null
      ? { fromTimestamp: resume.lastVerifiedTs }
      : {}),
    ...(resume?.lastVerifiedId != null
      ? { afterId: resume.lastVerifiedId }
      : {}),
    ...(resume?.lastVerifiedHash != null
      ? { previousExpectedHash: resume.lastVerifiedHash }
      : {}),
  });

  const now = Date.now();
  if (!result.valid && result.firstBrokenAt !== undefined) {
    const fingerprint = `${result.firstBrokenAt.logId}:${result.firstBrokenAt.actual}`;
    const alreadyAlerted = resume?.lastAlertedFingerprint === fingerprint;
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
    if (!alreadyAlerted) {
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
      } catch (error) {
        console.error(
          `[audit-integrity] alert bell failed for org ${organizationId}:`,
          error,
        );
      }
    }
    return { verified: result.verifiedCount, broken: true };
  }

  await sql`
    INSERT INTO app.audit_integrity_progress (
      org_id, last_verified_ts, last_verified_id, last_verified_hash,
      head_reached, updated_at_ms, last_alerted_fingerprint,
      last_alerted_at_ms
    ) VALUES (
      ${organizationId},
      ${result.lastVerifiedTimestamp ?? null},
      ${result.lastVerifiedId ?? null},
      ${result.lastVerifiedHash ?? null},
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
      head_reached = EXCLUDED.head_reached,
      updated_at_ms = ${now},
      last_alerted_fingerprint = NULL,
      last_alerted_at_ms = NULL
  `;
  return { verified: result.verifiedCount, broken: false };
}

/** Every org with at least one audit row — the scheduled job's fleet. */
export async function listAuditedOrgIds(sql: Sql): Promise<string[]> {
  const rows = await sql<{ orgId: string }[]>`
    SELECT DISTINCT org_id AS "orgId" FROM app.audit_logs
  `;
  return rows.map((row) => row.orgId);
}
