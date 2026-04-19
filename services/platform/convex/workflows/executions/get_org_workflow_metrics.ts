import type { QueryCtx } from '../../_generated/server';

export type PeriodDays = 7 | 30 | 90;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SCAN = 5000;

export type GetOrgWorkflowMetricsArgs = {
  organizationId: string;
  periodDays: PeriodDays;
};

export type OrgWorkflowSummary = {
  total: number;
  completed: number;
  failed: number;
  running: number;
  successRate: number;
  avgExecutionTimeSeconds: number;
  lastExecution: number | null;
  capped: boolean;
};

export type OrgWorkflowSeriesPoint = {
  dateKey: string;
  completed: number;
  failed: number;
  running: number;
};

export type OrgWorkflowTopItem = {
  wfDefinitionId: string | null;
  workflowSlug: string | null;
  total: number;
  completed: number;
  failed: number;
  successRate: number;
  avgExecutionTimeSeconds: number;
  lastExecution: number | null;
};

export type OrgWorkflowMetrics = {
  summary: OrgWorkflowSummary;
  series: OrgWorkflowSeriesPoint[];
  topWorkflows: OrgWorkflowTopItem[];
};

interface WorkflowBucket {
  wfDefinitionId: string | null;
  workflowSlug: string | null;
  total: number;
  completed: number;
  failed: number;
  durationSumMs: number;
  durationCount: number;
  lastExecution: number;
}

function utcDateKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function utcDayStart(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export async function getOrgWorkflowMetrics(
  ctx: QueryCtx,
  args: GetOrgWorkflowMetricsArgs,
): Promise<OrgWorkflowMetrics> {
  const now = Date.now();
  const windowStart = now - args.periodDays * DAY_MS;

  let total = 0;
  let completed = 0;
  let failed = 0;
  let running = 0;
  let durationSumMs = 0;
  let durationCount = 0;
  let lastExecution: number | null = null;

  const seriesMap = new Map<string, OrgWorkflowSeriesPoint>();
  const todayStart = utcDayStart(now);
  for (let i = args.periodDays - 1; i >= 0; i--) {
    const dayTs = todayStart - i * DAY_MS;
    const key = utcDateKey(dayTs);
    seriesMap.set(key, { dateKey: key, completed: 0, failed: 0, running: 0 });
  }

  const buckets = new Map<string, WorkflowBucket>();

  let scanned = 0;
  let capped = false;
  for await (const e of ctx.db
    .query('wfExecutions')
    .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
    .order('desc')) {
    scanned++;
    if (scanned > MAX_SCAN) {
      capped = true;
      break;
    }
    if (e.startedAt < windowStart) continue;

    total++;
    if (lastExecution === null || e.startedAt > lastExecution) {
      lastExecution = e.startedAt;
    }

    const dayKey = utcDateKey(e.startedAt);
    const seriesPoint = seriesMap.get(dayKey);

    const bucketKey =
      (typeof e.wfDefinitionId === 'string' ? e.wfDefinitionId : null) ??
      e.workflowSlug ??
      'unknown';
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        wfDefinitionId:
          typeof e.wfDefinitionId === 'string' ? e.wfDefinitionId : null,
        workflowSlug: e.workflowSlug ?? null,
        total: 0,
        completed: 0,
        failed: 0,
        durationSumMs: 0,
        durationCount: 0,
        lastExecution: 0,
      };
      buckets.set(bucketKey, bucket);
    }
    bucket.total++;
    if (e.startedAt > bucket.lastExecution) {
      bucket.lastExecution = e.startedAt;
    }

    switch (e.status) {
      case 'completed': {
        completed++;
        bucket.completed++;
        if (seriesPoint) seriesPoint.completed++;
        if (e.completedAt) {
          const durMs = e.completedAt - e.startedAt;
          durationSumMs += durMs;
          durationCount++;
          bucket.durationSumMs += durMs;
          bucket.durationCount++;
        }
        break;
      }
      case 'failed':
        failed++;
        bucket.failed++;
        if (seriesPoint) seriesPoint.failed++;
        break;
      case 'running':
        running++;
        if (seriesPoint) seriesPoint.running++;
        break;
    }
  }

  const avgExecutionTimeSeconds =
    durationCount > 0 ? Math.round(durationSumMs / durationCount / 1000) : 0;
  const successRate = total > 0 ? (completed / total) * 100 : 0;

  const topWorkflows: OrgWorkflowTopItem[] = [...buckets.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map((b) => ({
      wfDefinitionId: b.wfDefinitionId,
      workflowSlug: b.workflowSlug,
      total: b.total,
      completed: b.completed,
      failed: b.failed,
      successRate: b.total > 0 ? (b.completed / b.total) * 100 : 0,
      avgExecutionTimeSeconds:
        b.durationCount > 0
          ? Math.round(b.durationSumMs / b.durationCount / 1000)
          : 0,
      lastExecution: b.lastExecution || null,
    }));

  return {
    summary: {
      total,
      completed,
      failed,
      running,
      successRate,
      avgExecutionTimeSeconds,
      lastExecution,
      capped,
    },
    series: [...seriesMap.values()],
    topWorkflows,
  };
}
