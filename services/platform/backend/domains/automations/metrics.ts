import type { Sql } from 'postgres';

import {
  DAY_MS,
  dailyKeys,
  utcDateKey,
} from '../../../lib/shared/metrics-window.ts';

/**
 * Org-wide run KPIs for the automation metrics page — the 0.4
 * `getOrgAutomationMetrics` fold verbatim over ONE bounded newest-first SQL
 * page (same `METRICS_MAX_SCAN` cap, same prior-window deltas, same
 * per-day series and top-N buckets).
 */
const METRICS_MAX_SCAN = 5000;
const METRICS_TOP_N = 10;

export interface OrgAutomationMetrics {
  summary: {
    total: number;
    success: number;
    failed: number;
    running: number;
    waiting: number;
    queued: number;
    cancelled: number;
    successRate: number;
    avgDurationSeconds: number;
    lastRun: number | null;
    capped: boolean;
  };
  previousSummary: {
    total: number;
    success: number;
    failed: number;
    successRate: number;
    avgDurationSeconds: number;
  };
  series: Array<{
    dateKey: string;
    success: number;
    failed: number;
    running: number;
  }>;
  topAutomations: Array<{
    name: string;
    total: number;
    success: number;
    failed: number;
    successRate: number;
    avgDurationSeconds: number;
    lastRun: number | null;
  }>;
}

interface MetricsBucket {
  name: string;
  total: number;
  success: number;
  failed: number;
  cancelled: number;
  durationSumMs: number;
  durationCount: number;
  lastRun: number;
}

/** Success over TERMINAL runs (success + failed + cancelled), in percent. */
function successRatePct(
  success: number,
  failed: number,
  cancelled: number,
): number {
  const terminal = success + failed + cancelled;
  return terminal > 0 ? (success / terminal) * 100 : 0;
}

export async function getOrgAutomationMetrics(
  sql: Sql,
  organizationId: string,
  args: { periodDays: 7 | 30 | 90; mode?: 'live' | 'mock' },
): Promise<OrgAutomationMetrics> {
  const mode = args.mode ?? 'live';
  const now = Date.now();
  const windowStart = now - args.periodDays * DAY_MS;
  const prevWindowStart = now - args.periodDays * 2 * DAY_MS;

  const rows = await sql<
    {
      name: string;
      status: string;
      mode: string;
      startedAt: number;
      finishedAt: number | null;
    }[]
  >`
    SELECT name, status, mode, started_at_ms::float8 AS "startedAt",
           finished_at_ms::float8 AS "finishedAt"
    FROM app.automation_runs
    WHERE org_id = ${organizationId}
      AND started_at_ms >= ${prevWindowStart}
    ORDER BY started_at_ms DESC
    LIMIT ${METRICS_MAX_SCAN + 1}
  `;
  const capped = rows.length > METRICS_MAX_SCAN;
  const walk = rows.slice(0, METRICS_MAX_SCAN);

  let total = 0;
  let success = 0;
  let failed = 0;
  let running = 0;
  let waiting = 0;
  let queued = 0;
  let cancelled = 0;
  let durationSumMs = 0;
  let durationCount = 0;
  let lastRun: number | null = null;

  let prevTotal = 0;
  let prevSuccess = 0;
  let prevFailed = 0;
  let prevCancelled = 0;
  let prevDurationSumMs = 0;
  let prevDurationCount = 0;

  const seriesMap = new Map(
    dailyKeys(args.periodDays, now).map((dateKey) => [
      dateKey,
      { dateKey, success: 0, failed: 0, running: 0 },
    ]),
  );
  const buckets = new Map<string, MetricsBucket>();

  for (const run of walk) {
    if (run.mode !== mode) continue;
    const durationMs =
      run.finishedAt !== null ? run.finishedAt - run.startedAt : null;

    if (run.startedAt < windowStart) {
      prevTotal++;
      if (run.status === 'success') prevSuccess++;
      else if (run.status === 'failed') prevFailed++;
      else if (run.status === 'cancelled') prevCancelled++;
      if (
        durationMs !== null &&
        (run.status === 'success' ||
          run.status === 'failed' ||
          run.status === 'cancelled')
      ) {
        prevDurationSumMs += durationMs;
        prevDurationCount++;
      }
      continue;
    }

    total++;
    if (lastRun === null || run.startedAt > lastRun) {
      lastRun = run.startedAt;
    }
    const seriesPoint = seriesMap.get(utcDateKey(run.startedAt));
    let bucket = buckets.get(run.name);
    if (!bucket) {
      bucket = {
        name: run.name,
        total: 0,
        success: 0,
        failed: 0,
        cancelled: 0,
        durationSumMs: 0,
        durationCount: 0,
        lastRun: 0,
      };
      buckets.set(run.name, bucket);
    }
    bucket.total++;
    if (run.startedAt > bucket.lastRun) {
      bucket.lastRun = run.startedAt;
    }

    switch (run.status) {
      case 'success':
        success++;
        bucket.success++;
        if (seriesPoint) seriesPoint.success++;
        break;
      case 'failed':
        failed++;
        bucket.failed++;
        if (seriesPoint) seriesPoint.failed++;
        break;
      case 'cancelled':
        cancelled++;
        bucket.cancelled++;
        break;
      case 'running':
        running++;
        if (seriesPoint) seriesPoint.running++;
        break;
      case 'waiting':
        waiting++;
        break;
      case 'queued':
        queued++;
        break;
      default:
        break;
    }
    if (
      durationMs !== null &&
      (run.status === 'success' ||
        run.status === 'failed' ||
        run.status === 'cancelled')
    ) {
      durationSumMs += durationMs;
      durationCount++;
      bucket.durationSumMs += durationMs;
      bucket.durationCount++;
    }
  }

  const topAutomations = [...buckets.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, METRICS_TOP_N)
    .map((bucket) => ({
      name: bucket.name,
      total: bucket.total,
      success: bucket.success,
      failed: bucket.failed,
      successRate: successRatePct(
        bucket.success,
        bucket.failed,
        bucket.cancelled,
      ),
      avgDurationSeconds:
        bucket.durationCount > 0
          ? Math.round(bucket.durationSumMs / bucket.durationCount / 1000)
          : 0,
      lastRun: bucket.lastRun > 0 ? bucket.lastRun : null,
    }));

  return {
    summary: {
      total,
      success,
      failed,
      running,
      waiting,
      queued,
      cancelled,
      successRate: successRatePct(success, failed, cancelled),
      avgDurationSeconds:
        durationCount > 0
          ? Math.round(durationSumMs / durationCount / 1000)
          : 0,
      lastRun,
      capped,
    },
    previousSummary: {
      total: prevTotal,
      success: prevSuccess,
      failed: prevFailed,
      successRate: successRatePct(prevSuccess, prevFailed, prevCancelled),
      avgDurationSeconds:
        prevDurationCount > 0
          ? Math.round(prevDurationSumMs / prevDurationCount / 1000)
          : 0,
    },
    series: [...seriesMap.values()],
    topAutomations,
  };
}
