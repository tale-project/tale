'use client';

import { Alert } from '@tale/ui/alert';
import { ChartCard } from '@tale/ui/chart-card';
import { ChartLegend } from '@tale/ui/chart-legend';
import { CHART_COLORS, getChartSeriesColor } from '@tale/ui/chart-theme';
import { Grid, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Sparkline } from '@tale/ui/sparkline';
import { StatCard, StatCardGrid } from '@tale/ui/stat-card-grid';
import { Text } from '@tale/ui/text';
import { TrendIndicator } from '@tale/ui/trend-indicator';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, BarChart3, ChevronLeft } from 'lucide-react';
import { useMemo } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import {
  seriesToLegend,
  TrendAreaChart,
  TrendBarChart,
  TrendLineChart,
  type ChartSeries,
} from '@/app/components/metrics/charts';
import { MetricSelect } from '@/app/components/metrics/metric-select';
import { MetricsLayout } from '@/app/components/metrics/metrics-layout';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { formatCostCents } from '@/lib/utils/format/number';

export type PeriodDays = 7 | 30 | 90;

interface ProjectMetricsDay {
  dateKey: string;
  tasksCreated: number;
  tasksCompleted: number;
  tasksCancelled: number;
  cycleTimeSumMs: number;
  cycleTimeCount: number;
  leadTimeSumMs: number;
  leadTimeCount: number;
  statusCountsEod: {
    backlog: number;
    todo: number;
    in_progress: number;
    in_review: number;
  };
  wipEod: number;
  overdueEod: number;
  staleEod: number;
  agentCompleted: number;
  humanCompleted: number;
  agentRunsStarted: number;
  agentRunsFailed: number;
  totalCostCents: number;
  reviewsPassed: number;
  reviewsChangesRequested: number;
  escalations: number;
  capped: boolean;
}

interface ProjectTotals {
  created: number;
  completed: number;
  agent: number;
  human: number;
  cycleSum: number;
  cycleCount: number;
  cost: number;
  runs: number;
  failed: number;
  changes: number;
  escalations: number;
  capped: boolean;
}

function reduceTotals(days: ProjectMetricsDay[]): ProjectTotals {
  return days.reduce<ProjectTotals>(
    (acc, day) => ({
      created: acc.created + day.tasksCreated,
      completed: acc.completed + day.tasksCompleted,
      agent: acc.agent + day.agentCompleted,
      human: acc.human + day.humanCompleted,
      cycleSum: acc.cycleSum + day.cycleTimeSumMs,
      cycleCount: acc.cycleCount + day.cycleTimeCount,
      cost: acc.cost + day.totalCostCents,
      runs: acc.runs + day.agentRunsStarted,
      failed: acc.failed + day.agentRunsFailed,
      changes: acc.changes + day.reviewsChangesRequested,
      escalations: acc.escalations + day.escalations,
      capped: acc.capped || day.capped,
    }),
    {
      created: 0,
      completed: 0,
      agent: 0,
      human: 0,
      cycleSum: 0,
      cycleCount: 0,
      cost: 0,
      runs: 0,
      failed: 0,
      changes: 0,
      escalations: 0,
      capped: false,
    },
  );
}

function avgCycleHours(t: ProjectTotals): number | undefined {
  return t.cycleCount > 0 ? t.cycleSum / t.cycleCount / 3_600_000 : undefined;
}

function interventionRateOf(t: ProjectTotals): number {
  return t.runs > 0
    ? Math.round(((t.changes + t.escalations) / t.runs) * 100)
    : 0;
}

function shortDay(dateKey: string): string {
  return dateKey.slice(5);
}

interface ProjectMetricsPageProps {
  organizationId: string;
  projectId: Id<'projects'>;
  periodDays: PeriodDays;
  onChangePeriod: (period: PeriodDays) => void;
}

/**
 * The project's dedicated metrics page (mirrors the automations metrics page):
 * period switcher, paired-KPI stat cards honoring the KPI pairing contract
 * with period-over-period deltas, and the task charts — cumulative flow,
 * created-vs-completed throughput, the cycle-time trend, agent-vs-human
 * completions, and daily spend. Reads only the per-project daily rollups; all
 * charts share the chart-theme tokens (theme-aware in dark mode).
 */
export function ProjectMetricsPage({
  organizationId,
  projectId,
  periodDays,
  onChangePeriod,
}: ProjectMetricsPageProps) {
  const { t } = useT('tasks');

  const { data, isLoading } = useConvexQuery(
    api.task_metrics.queries.getProjectTaskMetrics,
    { projectId, days: periodDays },
  );
  // The query returns v.any(); the shape is owned by getProjectTaskMetrics.
  const daily: ProjectMetricsDay[] = data?.daily ?? [];
  const previousDaily: ProjectMetricsDay[] = data?.previousDaily ?? [];

  const periodOptions = useMemo(
    () => [
      { value: '7', label: t('metrics.period.last7Days') },
      { value: '30', label: t('metrics.period.last30Days') },
      { value: '90', label: t('metrics.period.last90Days') },
    ],
    [t],
  );

  const totals = reduceTotals(daily);
  const prev = reduceTotals(previousDaily);

  const cycleHours = avgCycleHours(totals);
  const prevCycleHours = avgCycleHours(prev);
  const interventionRate = interventionRateOf(totals);
  const prevInterventionRate = interventionRateOf(prev);

  const flowData = daily.map((day) => ({
    dateKey: day.dateKey,
    ...day.statusCountsEod,
  }));
  const throughputData = daily.map((day) => ({
    dateKey: day.dateKey,
    completed: day.tasksCompleted,
    created: day.tasksCreated,
  }));
  const cycleTimeData = daily.map((day) => ({
    dateKey: day.dateKey,
    hours:
      day.cycleTimeCount > 0
        ? Number(
            (day.cycleTimeSumMs / day.cycleTimeCount / 3_600_000).toFixed(1),
          )
        : null,
  }));
  const completionsData = daily.map((day) => ({
    dateKey: day.dateKey,
    agent: day.agentCompleted,
    human: day.humanCompleted,
  }));
  const costData = daily.map((day) => ({
    dateKey: day.dateKey,
    cost: Number((day.totalCostCents / 100).toFixed(2)),
  }));

  const noDays = daily.length === 0;
  const noCycleTimes = !daily.some((day) => day.cycleTimeCount > 0);
  const emptyTitle = t('metrics.noData');
  const emptyDescription = t('metrics.noDataDescription');

  const flowSeries: ChartSeries[] = [
    {
      key: 'backlog',
      label: t('status.backlog'),
      color: getChartSeriesColor(0),
    },
    { key: 'todo', label: t('status.todo'), color: getChartSeriesColor(1) },
    {
      key: 'in_progress',
      label: t('status.in_progress'),
      color: getChartSeriesColor(2),
    },
    {
      key: 'in_review',
      label: t('status.in_review'),
      color: getChartSeriesColor(3),
    },
  ];
  const throughputSeries: ChartSeries[] = [
    {
      key: 'created',
      label: t('metrics.createdLabel'),
      color: CHART_COLORS.primary,
    },
    {
      key: 'completed',
      label: t('metrics.completedLabel'),
      color: CHART_COLORS.success,
    },
  ];
  const completionsSeries: ChartSeries[] = [
    {
      key: 'agent',
      label: t('metrics.agentLabel'),
      color: CHART_COLORS.success,
      stackId: 'completions',
    },
    {
      key: 'human',
      label: t('metrics.humanLabel'),
      color: CHART_COLORS.primary,
      stackId: 'completions',
    },
  ];

  return (
    <ContentArea gap={6} className="py-4">
      <Skeletonize loading={isLoading} className="flex flex-col gap-4">
        {/* Metrics is a sub-view of Tasks (no tab of its own), so lead with a
            back link to the tasks list — otherwise there's no way back. */}
        <Link
          to="/dashboard/$id/projects/$projectId/tasks"
          params={{ id: organizationId, projectId }}
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {t('title')}
        </Link>
        <MetricsLayout
          title={t('metrics.title')}
          description={t('metrics.description')}
          toolbar={
            <MetricSelect
              aria-label={t('metrics.period.label')}
              options={periodOptions}
              value={String(periodDays)}
              onValueChange={(v) => {
                const next = Number(v);
                if (next === 7 || next === 30 || next === 90)
                  onChangePeriod(next);
              }}
            />
          }
          notice={
            !isLoading && totals.capped ? (
              <Alert
                variant="warning"
                icon={AlertTriangle}
                title={t('metrics.cappedNotice')}
              />
            ) : undefined
          }
        >
          <StatCardGrid cols={4}>
            <StatCard
              label={t('metrics.completed', { days: periodDays })}
              value={String(totals.completed)}
            >
              <Stack gap={1} className="mt-0.5">
                <TrendIndicator
                  value={totals.completed}
                  previous={prev.completed}
                />
                <SkeletonBox>
                  <Text as="p" variant="muted" className="text-xs">
                    {t('metrics.completedDetail', {
                      agent: totals.agent,
                      human: totals.human,
                    })}
                  </Text>
                </SkeletonBox>
                {daily.length > 1 ? (
                  <Sparkline
                    data={daily.map((day) => day.tasksCompleted)}
                    filled
                    color="var(--color-chart-success)"
                    className="mt-1"
                  />
                ) : null}
              </Stack>
            </StatCard>

            <StatCard
              label={t('metrics.cycleTime')}
              value={
                cycleHours !== undefined ? `${cycleHours.toFixed(1)}h` : '—'
              }
            >
              <Stack gap={1} className="mt-0.5">
                {cycleHours !== undefined ? (
                  <TrendIndicator
                    value={cycleHours}
                    previous={prevCycleHours}
                    inverted
                  />
                ) : null}
                <SkeletonBox>
                  <Text as="p" variant="muted" className="text-xs">
                    {t('metrics.created', { count: totals.created })}
                  </Text>
                </SkeletonBox>
              </Stack>
            </StatCard>

            <StatCard
              label={t('metrics.intervention')}
              value={`${interventionRate}%`}
            >
              <Stack gap={1} className="mt-0.5">
                <TrendIndicator
                  value={interventionRate}
                  previous={prevInterventionRate}
                  inverted
                />
                <SkeletonBox>
                  <Text as="p" variant="muted" className="text-xs">
                    {t('metrics.interventionDetail', {
                      changes: totals.changes,
                      escalations: totals.escalations,
                    })}
                  </Text>
                </SkeletonBox>
              </Stack>
            </StatCard>

            <StatCard
              label={t('metrics.cost', { days: periodDays })}
              value={formatCostCents(totals.cost)}
            >
              <Stack gap={1} className="mt-0.5">
                <TrendIndicator
                  value={totals.cost}
                  previous={prev.cost}
                  inverted
                />
                <SkeletonBox>
                  <Text as="p" variant="muted" className="text-xs">
                    {t('metrics.costDetail', {
                      runs: totals.runs,
                      failed: totals.failed,
                    })}
                  </Text>
                </SkeletonBox>
              </Stack>
            </StatCard>
          </StatCardGrid>

          <ChartCard
            title={t('metrics.cumulativeFlow')}
            bodyClassName="h-52"
            loading={isLoading}
            isEmpty={noDays}
            emptyIcon={BarChart3}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
            legend={<ChartLegend items={seriesToLegend(flowSeries)} />}
          >
            <TrendAreaChart
              data={flowData}
              series={flowSeries}
              xKey="dateKey"
              xTickFormatter={shortDay}
            />
          </ChartCard>

          <Grid lg={2}>
            <ChartCard
              title={t('metrics.throughput')}
              bodyClassName="h-44"
              loading={isLoading}
              isEmpty={noDays}
              emptyIcon={BarChart3}
              emptyTitle={emptyTitle}
              emptyDescription={emptyDescription}
              legend={<ChartLegend items={seriesToLegend(throughputSeries)} />}
            >
              <TrendBarChart
                data={throughputData}
                series={throughputSeries}
                xKey="dateKey"
                xTickFormatter={shortDay}
              />
            </ChartCard>

            <ChartCard
              title={t('metrics.cycleTimeTrend')}
              bodyClassName="h-44"
              loading={isLoading}
              isEmpty={noCycleTimes}
              emptyIcon={BarChart3}
              emptyTitle={emptyTitle}
              emptyDescription={emptyDescription}
            >
              <TrendLineChart
                data={cycleTimeData}
                series={[
                  {
                    key: 'hours',
                    label: t('metrics.cycleHoursLabel'),
                    color: getChartSeriesColor(3),
                  },
                ]}
                xKey="dateKey"
                xTickFormatter={shortDay}
                valueFormatter={(v) => `${v.toFixed(1)}h`}
              />
            </ChartCard>
          </Grid>

          <Grid lg={2}>
            <ChartCard
              title={t('metrics.agentVsHuman')}
              bodyClassName="h-44"
              loading={isLoading}
              isEmpty={noDays}
              emptyIcon={BarChart3}
              emptyTitle={emptyTitle}
              emptyDescription={emptyDescription}
              legend={<ChartLegend items={seriesToLegend(completionsSeries)} />}
            >
              <TrendBarChart
                data={completionsData}
                series={completionsSeries}
                xKey="dateKey"
                xTickFormatter={shortDay}
              />
            </ChartCard>

            <ChartCard
              title={t('metrics.costTrend')}
              bodyClassName="h-44"
              loading={isLoading}
              isEmpty={noDays}
              emptyIcon={BarChart3}
              emptyTitle={emptyTitle}
              emptyDescription={emptyDescription}
            >
              <TrendBarChart
                data={costData}
                series={[
                  {
                    key: 'cost',
                    label: t('metrics.costLabel'),
                    color: CHART_COLORS.warning,
                  },
                ]}
                xKey="dateKey"
                xTickFormatter={shortDay}
                allowDecimals
                valueFormatter={(v) => formatCostCents(v * 100)}
              />
            </ChartCard>
          </Grid>
        </MetricsLayout>
      </Skeletonize>
    </ContentArea>
  );
}
