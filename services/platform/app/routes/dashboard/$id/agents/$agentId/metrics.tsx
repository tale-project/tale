import { Badge } from '@tale/ui/badge';
import { ChartCard } from '@tale/ui/chart-card';
import { ChartLegend } from '@tale/ui/chart-legend';
import { CHART_COLORS } from '@tale/ui/chart-theme';
import { Stack } from '@tale/ui/layout';
import { StatCard, StatCardGrid } from '@tale/ui/stat-card-grid';
import { Text } from '@tale/ui/text';
import { TrendIndicator } from '@tale/ui/trend-indicator';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import { ContentArea } from '@/app/components/layout/content-area';
import {
  seriesToLegend,
  TrendBarChart,
  type ChartSeries,
} from '@/app/components/metrics/charts';
import { MetricSelect } from '@/app/components/metrics/metric-select';
import { MetricsLayout } from '@/app/components/metrics/metrics-layout';
import type { PeriodDays } from '@/app/features/agents/workforce/workforce-dashboard';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { seo } from '@/lib/utils/seo';

export const searchSchema = z.object({
  // Same coercion as the workforce dashboard route (`agents/metrics.tsx`): the
  // router parses a bare `?period=90` as the JSON number 90, so coerce to a
  // string before the enum and fall back to the default 30-day window for any
  // out-of-range value so a shared/bookmarked URL never renders the error page.
  period: z.coerce
    .string()
    .pipe(z.enum(['7', '30', '90']))
    .catch('30')
    .optional(),
});

export const Route = createFileRoute('/dashboard/$id/agents/$agentId/metrics')({
  head: () => ({
    meta: seo('agents'),
  }),
  validateSearch: searchSchema,
  component: AgentMetricsTab,
});

interface ScorecardDay {
  dateKey: string;
  runsStarted: number;
  runsCompleted: number;
  runsFailed: number;
  runDurationSumMs: number;
  runDurationCount: number;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  tasksCompleted: number;
  reviewsPassed: number;
  reviewsChangesRequested: number;
  escalations: number;
  staleEod: number;
}

interface ScorecardRun {
  runId: string;
  taskId: string;
  trigger: string;
  status: string;
  startedAt: number;
  durationMs?: number;
  costCents: number;
  error?: string;
}

interface ScorecardPayload {
  daily: ScorecardDay[];
  /** Same shape as `daily` for the immediately-preceding window (deltas). */
  previousDaily: ScorecardDay[];
  recentRuns: ScorecardRun[];
}

interface ScorecardTotals {
  runsStarted: number;
  runsFailed: number;
  durationSum: number;
  durationCount: number;
  costCents: number;
  tasksCompleted: number;
  reviewsPassed: number;
  reviewsChangesRequested: number;
  escalations: number;
}

function reduceDaily(days: ScorecardDay[]): ScorecardTotals {
  return days.reduce(
    (acc, day) => ({
      runsStarted: acc.runsStarted + day.runsStarted,
      runsFailed: acc.runsFailed + day.runsFailed,
      durationSum: acc.durationSum + day.runDurationSumMs,
      durationCount: acc.durationCount + day.runDurationCount,
      costCents: acc.costCents + day.costCents,
      tasksCompleted: acc.tasksCompleted + day.tasksCompleted,
      reviewsPassed: acc.reviewsPassed + day.reviewsPassed,
      reviewsChangesRequested:
        acc.reviewsChangesRequested + day.reviewsChangesRequested,
      escalations: acc.escalations + day.escalations,
    }),
    {
      runsStarted: 0,
      runsFailed: 0,
      durationSum: 0,
      durationCount: 0,
      costCents: 0,
      tasksCompleted: 0,
      reviewsPassed: 0,
      reviewsChangesRequested: 0,
      escalations: 0,
    },
  );
}

function passRateOf(t: ScorecardTotals): number | undefined {
  const reviews = t.reviewsPassed + t.reviewsChangesRequested;
  return reviews > 0
    ? Math.round((t.reviewsPassed / reviews) * 100)
    : undefined;
}

function avgRunSecondsOf(t: ScorecardTotals): number | undefined {
  return t.durationCount > 0
    ? Math.round(t.durationSum / t.durationCount / 1000)
    : undefined;
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const STATUS_COLOR: Record<string, string> = {
  running: 'text-primary border-primary/40',
  completed: 'text-green-600 dark:text-green-400 border-green-500/40',
  failed: 'text-red-600 dark:text-red-400 border-red-500/40',
  timed_out: 'text-amber-600 dark:text-amber-400 border-amber-500/40',
};

/**
 * The agent scorecard (performance-review framing): 30-day outcome,
 * intervention, and cost totals derived from the daily rollups, plus the
 * most recent runs. KPI pairing contract applies — cost never stands alone.
 */
function AgentMetricsTab() {
  const { t } = useT('workforce');
  const { t: tTasks } = useT('tasks');
  const { id: organizationId, agentId } = Route.useParams();
  const { period } = Route.useSearch();
  const navigate = useNavigate();
  const { formatRelative } = useFormatDate();

  // Honor the shared metrics period (7/30/90) instead of a hard-pinned 30-day
  // window — the scorecard now carries the same selector as the workforce
  // dashboard, and the window drives both the query and the subtitle.
  const periodDays: PeriodDays = period === '7' ? 7 : period === '90' ? 90 : 30;

  const periodOptions = useMemo(
    () => [
      { value: '7', label: t('period.last7Days') },
      { value: '30', label: t('period.last30Days') },
      { value: '90', label: t('period.last90Days') },
    ],
    [t],
  );

  const handleChangePeriod = useCallback(
    (next: PeriodDays) => {
      const periodParam: '7' | '30' | '90' =
        next === 7 ? '7' : next === 90 ? '90' : '30';
      void navigate({
        to: '/dashboard/$id/agents/$agentId/metrics',
        params: { id: organizationId, agentId },
        search: { period: periodParam },
        replace: true,
      });
    },
    [navigate, organizationId, agentId],
  );

  const { data } = useConvexQuery(
    api.task_metrics.queries.getAgentScorecard,
    organizationId
      ? { organizationId, agentSlug: agentId, days: periodDays }
      : 'skip',
  );
  // The query returns v.any(); the payload shape is owned by getAgentScorecard.
  const scorecard: ScorecardPayload | undefined = data ?? undefined;

  const totals = reduceDaily(scorecard?.daily ?? []);
  const prev = reduceDaily(scorecard?.previousDaily ?? []);

  const passRate = passRateOf(totals);
  const prevPassRate = passRateOf(prev);
  const avgRunSeconds = avgRunSecondsOf(totals);
  const prevAvgRunSeconds = avgRunSecondsOf(prev);

  const activityData = (scorecard?.daily ?? []).map((day) => ({
    dateKey: day.dateKey,
    completed: day.runsCompleted,
    failed: day.runsFailed,
  }));
  const activitySeries: ChartSeries[] = [
    {
      key: 'completed',
      label: t('scorecard.runsCompleted'),
      color: CHART_COLORS.success,
      stackId: 'runs',
    },
    {
      key: 'failed',
      label: t('scorecard.runsFailed'),
      color: CHART_COLORS.failure,
      stackId: 'runs',
    },
  ];
  const noActivity = !(scorecard?.daily ?? []).some(
    (day) => day.runsCompleted + day.runsFailed > 0,
  );

  return (
    <ContentArea variant="narrow" gap={6}>
      <MetricsLayout
        title={t('scorecard.title')}
        description={t('scorecard.subtitle', { days: periodDays })}
        toolbar={
          <MetricSelect
            aria-label={t('period.label')}
            options={periodOptions}
            value={String(periodDays)}
            onValueChange={(v) => {
              const next = Number(v);
              if (next === 7 || next === 30 || next === 90)
                handleChangePeriod(next);
            }}
            widthClassName="w-44"
          />
        }
      >
        <StatCardGrid cols={2}>
          <StatCard
            label={t('scorecard.tasksCompleted')}
            value={String(totals.tasksCompleted)}
          >
            <Stack gap={1} className="mt-0.5">
              <TrendIndicator
                value={totals.tasksCompleted}
                previous={prev.tasksCompleted}
              />
              <Text as="p" variant="muted" className="text-xs">
                {t('kpi.runs', {
                  started: totals.runsStarted,
                  failed: totals.runsFailed,
                })}
              </Text>
            </Stack>
          </StatCard>

          <StatCard
            label={t('scorecard.reviewOutcome')}
            value={passRate !== undefined ? `${passRate}%` : '—'}
          >
            <Stack gap={1} className="mt-0.5">
              {passRate !== undefined ? (
                <TrendIndicator value={passRate} previous={prevPassRate} />
              ) : null}
              <Text as="p" variant="muted" className="text-xs">
                {t('scorecard.reviewDetail', {
                  passed: totals.reviewsPassed,
                  changes: totals.reviewsChangesRequested,
                  escalations: totals.escalations,
                })}
              </Text>
            </Stack>
          </StatCard>

          <StatCard
            label={t('scorecard.avgRun')}
            value={avgRunSeconds !== undefined ? `${avgRunSeconds}s` : '—'}
          >
            {avgRunSeconds !== undefined ? (
              <div className="mt-0.5">
                <TrendIndicator
                  value={avgRunSeconds}
                  previous={prevAvgRunSeconds}
                  inverted
                />
              </div>
            ) : null}
          </StatCard>

          <StatCard
            label={t('scorecard.spend')}
            value={formatCents(totals.costCents)}
          >
            <Stack gap={1} className="mt-0.5">
              <TrendIndicator
                value={totals.costCents}
                previous={prev.costCents}
                inverted
              />
              <Text as="p" variant="muted" className="text-xs">
                {t('kpi.costDetail', {
                  perTask:
                    totals.tasksCompleted > 0
                      ? formatCents(totals.costCents / totals.tasksCompleted)
                      : '0.00',
                })}
              </Text>
            </Stack>
          </StatCard>
        </StatCardGrid>

        {/* Only render the activity chart when there's activity — a zero-run
            agent is communicated by the "no runs" recent-runs empty state, so an
            empty chart placeholder would just duplicate that message. */}
        {noActivity ? null : (
          <ChartCard
            title={t('trend.title')}
            bodyClassName="h-44"
            legend={<ChartLegend items={seriesToLegend(activitySeries)} />}
          >
            <TrendBarChart
              data={activityData}
              series={activitySeries}
              xKey="dateKey"
              xTickFormatter={(key) => key.slice(5)}
            />
          </ChartCard>
        )}

        <Stack as="section" gap={2}>
          <Text as="h3" variant="label">
            {t('scorecard.recentRuns')}
          </Text>
          {(scorecard?.recentRuns.length ?? 0) === 0 ? (
            <Text as="p" variant="muted" className="text-sm italic">
              {t('scorecard.noRuns')}
            </Text>
          ) : (
            <ul className="border-border divide-border divide-y overflow-hidden rounded-lg border">
              {scorecard?.recentRuns.map((run) => (
                <li
                  key={run.runId}
                  className="flex items-center gap-2 px-2.5 py-2 text-sm"
                >
                  <Badge
                    variant="outline"
                    className={cn('text-[10px]', STATUS_COLOR[run.status])}
                  >
                    {tTasks(`agentRuns.status.${run.status}`)}
                  </Badge>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate">
                    {tTasks(`agentRuns.trigger.${run.trigger}`)}
                    {run.error ? ` · ${run.error}` : ''}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {run.durationMs !== undefined
                      ? `${Math.round(run.durationMs / 1000)}s · `
                      : ''}
                    {run.costCents > 0
                      ? `${formatCents(run.costCents)} · `
                      : ''}
                    {formatRelative(new Date(run.startedAt))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Stack>
      </MetricsLayout>
    </ContentArea>
  );
}
