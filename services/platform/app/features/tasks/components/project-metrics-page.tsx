'use client';

import { EmptyState } from '@tale/ui/empty-state';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { BarChart3, ChevronLeft } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ContentArea } from '@/app/components/layout/content-area';
import { PageHeader } from '@/app/components/layout/page-header';
import { Select } from '@/app/components/ui/forms/select';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

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

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function shortDay(dateKey: string): string {
  return dateKey.slice(5);
}

/**
 * One bordered chart card. The card chrome (title) always renders; the chart
 * slot masks itself while loading and falls back to an `EmptyState` when the
 * period has no data — the page never goes blank.
 */
function ChartCard({
  title,
  heightClassName,
  isLoading,
  isEmpty,
  emptyTitle,
  emptyDescription,
  children,
}: {
  title: string;
  heightClassName: string;
  isLoading: boolean;
  isEmpty: boolean;
  emptyTitle: string;
  emptyDescription: string;
  children: ReactNode;
}) {
  return (
    <section className="border-border bg-card rounded-lg border p-4">
      <Text as="h3" variant="label">
        {title}
      </Text>
      <div className={`mt-3 ${heightClassName}`}>
        {isLoading ? (
          <SkeletonBox fullWidth>
            <div className={`w-full ${heightClassName}`} />
          </SkeletonBox>
        ) : isEmpty ? (
          <EmptyState
            icon={BarChart3}
            title={emptyTitle}
            description={emptyDescription}
            className="h-full py-0"
          />
        ) : (
          children
        )}
      </div>
    </section>
  );
}

interface ProjectMetricsPageProps {
  organizationId: string;
  projectId: Id<'projects'>;
  periodDays: PeriodDays;
  onChangePeriod: (period: PeriodDays) => void;
}

/**
 * The project's dedicated metrics page (mirrors the automations metrics
 * page): period switcher, paired-KPI stat cards honoring the KPI pairing
 * contract, and the task charts — cumulative flow from the EOD status
 * snapshots, created-vs-completed throughput, the cycle-time trend,
 * agent-vs-human completions, and daily spend. Reads only the per-project
 * daily rollups.
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

  const periodOptions = useMemo(
    () => [
      { value: '7', label: t('metrics.period.last7Days') },
      { value: '30', label: t('metrics.period.last30Days') },
      { value: '90', label: t('metrics.period.last90Days') },
    ],
    [t],
  );

  const totals = daily.reduce(
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
  const avgCycleHours =
    totals.cycleCount > 0
      ? (totals.cycleSum / totals.cycleCount / 3_600_000).toFixed(1)
      : undefined;
  const interventionRate =
    totals.runs > 0
      ? Math.round(((totals.changes + totals.escalations) / totals.runs) * 100)
      : 0;

  const flowData = daily.map((day) => ({
    label: shortDay(day.dateKey),
    ...day.statusCountsEod,
  }));
  const throughputData = daily.map((day) => ({
    label: shortDay(day.dateKey),
    completed: day.tasksCompleted,
    created: day.tasksCreated,
  }));
  const cycleTimeData = daily.map((day) => ({
    label: shortDay(day.dateKey),
    hours:
      day.cycleTimeCount > 0
        ? Number(
            (day.cycleTimeSumMs / day.cycleTimeCount / 3_600_000).toFixed(1),
          )
        : null,
  }));
  const completionsData = daily.map((day) => ({
    label: shortDay(day.dateKey),
    agent: day.agentCompleted,
    human: day.humanCompleted,
  }));
  const costData = daily.map((day) => ({
    label: shortDay(day.dateKey),
    cost: Number((day.totalCostCents / 100).toFixed(2)),
  }));

  const noDays = daily.length === 0;
  const noCycleTimes = !daily.some((day) => day.cycleTimeCount > 0);
  const emptyTitle = t('metrics.noData');
  const emptyDescription = t('metrics.noDataDescription');

  const stats = [
    {
      label: t('metrics.completed', { days: periodDays }),
      value: String(totals.completed),
      detail: t('metrics.completedDetail', {
        agent: totals.agent,
        human: totals.human,
      }),
    },
    {
      label: t('metrics.cycleTime'),
      value: avgCycleHours !== undefined ? `${avgCycleHours}h` : '—',
      detail: t('metrics.created', { count: totals.created }),
    },
    {
      label: t('metrics.intervention'),
      value: `${interventionRate}%`,
      detail: t('metrics.interventionDetail', {
        changes: totals.changes,
        escalations: totals.escalations,
      }),
    },
    {
      label: t('metrics.cost', { days: periodDays }),
      value: formatCents(totals.cost),
      detail: t('metrics.costDetail', {
        runs: totals.runs,
        failed: totals.failed,
      }),
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
        <PageHeader
          title={t('metrics.title')}
          description={t('metrics.description')}
          action={
            <div className="w-44 shrink-0">
              <Select
                options={periodOptions}
                value={String(periodDays)}
                onValueChange={(v) => {
                  const next = Number(v);
                  if (next === 7 || next === 30 || next === 90)
                    onChangePeriod(next);
                }}
                size="sm"
              />
            </div>
          }
        />

        {!isLoading && totals.capped ? (
          <div className="border-border bg-muted/40 rounded-md border px-3 py-2 text-xs">
            {t('metrics.cappedNotice')}
          </div>
        ) : null}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="border-border bg-card flex flex-col gap-1 rounded-lg border p-3"
            >
              <Text as="p" variant="muted" className="text-xs">
                {stat.label}
              </Text>
              <SkeletonBox>
                <Text as="p" className="text-xl font-semibold tabular-nums">
                  {stat.value}
                </Text>
              </SkeletonBox>
              <SkeletonBox>
                <Text as="p" variant="muted" className="text-xs">
                  {stat.detail}
                </Text>
              </SkeletonBox>
            </div>
          ))}
        </section>

        <ChartCard
          title={t('metrics.cumulativeFlow')}
          heightClassName="h-52"
          isLoading={isLoading}
          isEmpty={noDays}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={flowData}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
              <XAxis dataKey="label" fontSize={11} />
              <YAxis allowDecimals={false} fontSize={11} width={28} />
              <Tooltip />
              <Area
                dataKey="backlog"
                stackId="flow"
                name={t('status.backlog')}
                fill="#94a3b8"
                stroke="#94a3b8"
              />
              <Area
                dataKey="todo"
                stackId="flow"
                name={t('status.todo')}
                fill="#60a5fa"
                stroke="#60a5fa"
              />
              <Area
                dataKey="in_progress"
                stackId="flow"
                name={t('status.in_progress')}
                fill="#f59e0b"
                stroke="#f59e0b"
              />
              <Area
                dataKey="in_review"
                stackId="flow"
                name={t('status.in_review')}
                fill="#a78bfa"
                stroke="#a78bfa"
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard
            title={t('metrics.throughput')}
            heightClassName="h-44"
            isLoading={isLoading}
            isEmpty={noDays}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={throughputData}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} width={28} />
                <Tooltip />
                <Bar
                  dataKey="created"
                  name={t('metrics.createdLabel')}
                  fill="#60a5fa"
                  radius={[2, 2, 0, 0]}
                />
                <Bar
                  dataKey="completed"
                  name={t('metrics.completedLabel')}
                  fill="var(--color-chart-success, #10b981)"
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title={t('metrics.cycleTimeTrend')}
            heightClassName="h-44"
            isLoading={isLoading}
            isEmpty={noCycleTimes}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cycleTimeData}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis fontSize={11} width={28} />
                <Tooltip />
                <Line
                  dataKey="hours"
                  name={t('metrics.cycleHoursLabel')}
                  stroke="#a78bfa"
                  dot={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard
            title={t('metrics.agentVsHuman')}
            heightClassName="h-44"
            isLoading={isLoading}
            isEmpty={noDays}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={completionsData}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} width={28} />
                <Tooltip />
                <Bar
                  dataKey="agent"
                  stackId="completions"
                  name={t('metrics.agentLabel')}
                  fill="var(--color-chart-success, #10b981)"
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="human"
                  stackId="completions"
                  name={t('metrics.humanLabel')}
                  fill="#60a5fa"
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title={t('metrics.costTrend')}
            heightClassName="h-44"
            isLoading={isLoading}
            isEmpty={noDays}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={costData}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis fontSize={11} width={36} />
                <Tooltip
                  formatter={(value) =>
                    typeof value === 'number' ? formatCents(value * 100) : ''
                  }
                />
                <Bar
                  dataKey="cost"
                  name={t('metrics.costLabel')}
                  fill="#f59e0b"
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </Skeletonize>
    </ContentArea>
  );
}
