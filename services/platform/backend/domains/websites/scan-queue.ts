/**
 * What the job queue knows about website scans.
 *
 * A scan is a chain of `websites.scan` jobs, and a running one always has a
 * job queued or active: a link queues its successor before its own job ends.
 * The scheduler reads that here to tell a scan that is merely long from one
 * whose process went away under it (`core/websites/scan_scheduling.ts`).
 *
 * A site that was just added reads `scanning` before its first scan job
 * exists: its `websites.register` job registers the domain, reads the
 * homepage and only then queues the scan. That job stands for the scan
 * until it does.
 *
 * pg-boss keeps its jobs in this database (`pgboss.job`); the payloads are
 * the `websites.scan` and `websites.register` payloads of `jobs/tasks.ts`,
 * which both name the `domain`.
 */

import type { Sql } from 'postgres';

export interface ScanningRowWithoutJob {
  id: string;
  domain: string;
  organizationId: string;
  scanInterval: string;
  metadata: Record<string, unknown> | null;
}

/**
 * The rows that read `scanning` while no scan job for their domain is queued
 * or running, oldest first. Matched by domain alone: two organizations that
 * registered one domain share its scan, and a job for either counts. The
 * live jobs are read once, not once per row: the queue keeps its finished
 * jobs for days beside them.
 *
 * A queued or running `websites.register` job counts as the scan it is
 * about to queue. Without it a scheduler tick that fell between the row and
 * its first scan job took the new site for an interrupted scan, found no
 * claim and synced the row from the corpus: it read idle, or "not found in
 * crawler" when the registration had not landed yet, until the scan began.
 */
export async function listScanningRowsWithoutJob(
  sql: Sql,
  limit: number,
): Promise<ScanningRowWithoutJob[]> {
  return await sql<ScanningRowWithoutJob[]>`
    WITH live AS (
      SELECT DISTINCT data->>'domain' AS domain
      FROM pgboss.job
      WHERE name IN ('websites.scan', 'websites.register')
        AND state IN ('created', 'retry', 'active')
    )
    SELECT w.id, w.domain, w.org_id AS "organizationId",
           w.scan_interval AS "scanInterval", w.metadata
    FROM app.websites w
    WHERE w.status = 'scanning'
      AND NOT EXISTS (SELECT 1 FROM live WHERE live.domain = w.domain)
    ORDER BY w.updated_at_ms ASC, w.id ASC
    LIMIT ${limit}
  `;
}

/**
 * How the domain's most recent failed scan job came to its end, or null when
 * the queue holds none. A job that ran out its whole expiry (within a few
 * seconds) either timed out after its process was killed or belongs to a
 * link that is still working past it; one that failed sooner was cut short
 * — by its process on the way out, by the supervisor once its heartbeat
 * stopped, or by an error.
 */
export async function lastFailedScanJob(
  sql: Sql,
  domain: string,
): Promise<{ endedAt: number; ranOutItsExpiry: boolean } | null> {
  const rows = await sql<{ endedAt: number; ranOutItsExpiry: boolean }[]>`
    SELECT (EXTRACT(EPOCH FROM completed_on) * 1000)::float8 AS "endedAt",
           completed_on - started_on
             >= make_interval(secs => greatest(expire_seconds - 5, 0))
             AS "ranOutItsExpiry"
    FROM pgboss.job
    WHERE name = 'websites.scan' AND state = 'failed'
      AND data->>'domain' = ${domain}
      AND started_on IS NOT NULL AND completed_on IS NOT NULL
    ORDER BY completed_on DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Whether a scan job has ended while its link may still be running: its row
 * says it is no longer active — the supervisor failed it once its worker
 * stopped refreshing it, or it ran out its expiry. A job the queue no longer
 * holds counts as running: nothing says otherwise.
 */
export async function scanJobEnded(sql: Sql, jobId: string): Promise<boolean> {
  const rows = await sql<{ state: string }[]>`
    SELECT state::text AS state FROM pgboss.job
    WHERE name = 'websites.scan' AND id = ${jobId}::uuid
  `;
  const state = rows[0]?.state;
  return state !== undefined && state !== 'active';
}

/**
 * When the scan a domain is in began (epoch ms): the start of its first scan
 * job since `lastScannedAt`, the end of its last finished scan — or since
 * ever, for a site that never finished one. Null when the queue holds no
 * such job.
 */
export async function scanCycleStartedAt(
  sql: Sql,
  domain: string,
  lastScannedAt: number | null,
): Promise<number | null> {
  const rows = await sql<{ startedAt: number | null }[]>`
    SELECT (EXTRACT(EPOCH FROM min(started_on)) * 1000)::float8 AS "startedAt"
    FROM pgboss.job
    WHERE name = 'websites.scan'
      AND data->>'domain' = ${domain}
      AND started_on > to_timestamp(${(lastScannedAt ?? 0) / 1000}::float8)
  `;
  return rows[0]?.startedAt ?? null;
}

/**
 * Who the domain's latest scan job for this organization named as its
 * requester, other than `jobId` — the payload's raw value, null when it
 * named none or the queue holds no such job. A link that takes a scan over
 * carries on the scan that requester asked for.
 */
export async function previousScanRequester(
  sql: Sql,
  args: { domain: string; organizationId: string; jobId?: string },
): Promise<unknown> {
  const jobId = args.jobId ?? null;
  const rows = await sql<{ requestedBy: unknown }[]>`
    SELECT data->'requestedBy' AS "requestedBy"
    FROM pgboss.job
    WHERE name = 'websites.scan'
      AND data->>'domain' = ${args.domain}
      AND data->>'organizationId' = ${args.organizationId}
      AND (${jobId}::uuid IS NULL OR id <> ${jobId}::uuid)
    ORDER BY created_on DESC
    LIMIT 1
  `;
  return rows[0]?.requestedBy ?? null;
}
