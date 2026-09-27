'use client';

import { Alert } from '@tale/ui/alert';
import { ChartCard } from '@tale/ui/chart-card';
import { ChartLegend } from '@tale/ui/chart-legend';
import { CHART_COLORS, getChartSeriesColor } from '@tale/ui/chart-theme';
import { Grid, Stack } from '@tale/ui/layout';
import {
  seriesToLegend,
  TrendAreaChart,
  TrendBarChart,
  TrendLineChart,
  type ChartSeries,
} from '@tale/ui/metrics/charts';
import { MetricsLayout } from '@tale/ui/metrics/metrics-layout';
import {
  parseMetricsPeriodDays,
  type MetricsPeriodDays,
} from '@tale/ui/metrics/metrics-period';
import { MetricsPeriodSelect } from '@tale/ui/metrics/metrics-period-select';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Sparkline } from '@tale/ui/sparkline';
import { StatCard, StatCardGrid } from '@tale/ui/stat-card-grid';
import { Text } from '@tale/ui/text';
import { TrendIndicator } from '@tale/ui/trend-indicator';
import { AlertTriangle, BarChart3 } from 'lucide-react';
import type { ReactNode } from 'react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import type { ReturnsOf } from '@/app/lib/backend/contract';
import { useT } from '@/lib/i18n/client';

type ProjectMetricsDay =
  ReturnsOf<'tasks/queries:getProjectTaskMetrics'>['daily'][number];

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

/** Any task open at that day's end — the cumulative flow has a band. */
function hasFlow(day: ProjectMetricsDay): boolean {
  const counts = day.statusCountsEod;
  return (
    counts.backlog + counts.todo + counts.in_progress + counts.in_review > 0
  );
}

interface ProjectMetricsPageProps {
  organizationId: string;
  projectId: string;
  periodDays: MetricsPeriodDays;
  onChangePeriod: (period: MetricsPeriodDays) => void;
  /** The host's scope picker (the project select on Settings → Metrics →
   *  Projects), rendered in the toolbar ahead of the period filter. A host
   *  already scoped by its route passes nothing. */
  scopeControl?: ReactNode;
}

/**
 * The project's dedicated metrics page:
 * period switcher, paired-KPI stat cards honoring the KPI pairing contract
 * with period-over-period deltas, and the task charts — cumulative flow,
 * created-vs-completed throughput, the cycle-time trend, agent-vs-human
 * completions, and daily spend. Reads the window's day rows from
 * `tasks/queries:getProjectTaskMetrics` — the backend folds them at read
 * time from the project's live task, run, review and ask rows, so the
 * figures move with the board (no rollup to wait for). The window always
 * comes back complete (one row per day), so each chart judges its OWN
 * emptiness from its series — a board with open tasks but no moves this
 * period still has a flow band and an empty throughput. All charts share
 * the chart-theme tokens (theme-aware in dark mode). Padding-agnostic like
 * every metrics page — the host route owns the outer container and any
 * surrounding chrome (back link, picker).
 */
export function ProjectMetricsPage({
  organizationId,
  projectId,
  periodDays,
  onChangePeriod,
  scopeControl,
}: ProjectMetricsPageProps) {
  const { t } = useT('tasks');
  const { formatCostCents } = useFormatNumber();

  const { data, isLoading } = useBackendQuery(
    'tasks/queries:getProjectTaskMetrics',
    { organizationId, projectId, periodDays },
    { enabled: organizationId !== '' && projectId !== '' },
  );
  const daily: ProjectMetricsDay[] = data?.daily ?? [];
  const previousDaily: ProjectMetricsDay[] = data?.previousDaily ?? [];

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

  const noFlow = !daily.some(hasFlow);
  const noThroughput = totals.created === 0 && totals.completed === 0;
  const noCycleTimes = !daily.some((day) => day.cycleTimeCount > 0);
  const noCompletions = totals.completed === 0;
  const noCost = totals.runs === 0 && totals.cost === 0;
  const emptyTitle = t('metrics.noData');

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
    <Skeletonize loading={isLoading} label={t('metrics.title')}>
      <MetricsLayout
        as="h3"
        title={t('metrics.title')}
        description={t('metrics.description')}
        toolbar={
          <>
            {scopeControl}
            <MetricsPeriodSelect
              value={String(periodDays)}
              onValueChange={(v) => onChangePeriod(parseMetricsPeriodDays(v))}
            />
          </>
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
              {totals.completed > 0 && daily.length > 1 ? (
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
            value={cycleHours !== undefined ? `${cycleHours.toFixed(1)}h` : '—'}
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
          isEmpty={noFlow}
          emptyIcon={BarChart3}
          emptyTitle={emptyTitle}
          emptyDescription={t('metrics.noFlowDescription')}
          legend={<ChartLegend items={seriesToLegend(flowSeries)} />}
        >
          <TrendAreaChart
            data={flowData}
            series={flowSeries}
            xKey="dateKey"
            xTickFormatter={shortDay}
          />
        </ChartCard>

        {/* Two charts side by side once the page column is 42rem wide —
            the column, not the viewport: the Home panel sits beside it. */}
        <div className="@container">
          <Grid className="@2xl:grid-cols-2">
            <ChartCard
              title={t('metrics.throughput')}
              bodyClassName="h-44"
              loading={isLoading}
              isEmpty={noThroughput}
              emptyIcon={BarChart3}
              emptyTitle={emptyTitle}
              emptyDescription={t('metrics.noThroughputDescription')}
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
              emptyDescription={t('metrics.noCycleTimeDescription')}
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
        </div>

        {/* Two charts side by side once the page column is 42rem wide —
            the column, not the viewport: the Home panel sits beside it. */}
        <div className="@container">
          <Grid className="@2xl:grid-cols-2">
            <ChartCard
              title={t('metrics.agentVsHuman')}
              bodyClassName="h-44"
              loading={isLoading}
              isEmpty={noCompletions}
              emptyIcon={BarChart3}
              emptyTitle={emptyTitle}
              emptyDescription={t('metrics.noCompletionsDescription')}
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
              isEmpty={noCost}
              emptyIcon={BarChart3}
              emptyTitle={emptyTitle}
              emptyDescription={t('metrics.noCostDescription')}
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
        </div>
      </MetricsLayout>
    </Skeletonize>
  );
}
