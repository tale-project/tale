'use client';

import { Badge } from '@tale/ui/badge';
import { EmptyState } from '@tale/ui/empty-state';
import { Grid, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Link, useNavigate } from '@tanstack/react-router';
import type { ColumnDef, Row } from '@tanstack/react-table';
import {
  AlertTriangle,
  BarChart3,
  Eye,
  Hourglass,
  PauseCircle,
  Power,
} from 'lucide-react';
import { useCallback, useMemo, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Switch } from '@/app/components/ui/forms/switch';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { formatNumber } from '@/lib/utils/format/number';

import {
  useNeedsAttention,
  useSetTaskAutomation,
  useWorkforceHealth,
  useWorkforceMetrics,
  type WorkforceLeaderboardRow,
} from './hooks';

export type PeriodDays = 7 | 30 | 90;

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatHours(ms: number): string {
  return (ms / (60 * 60 * 1000)).toFixed(1);
}

function shortDay(dateKey: string): string {
  return dateKey.slice(5);
}

/**
 * One bordered chart card — same chrome as the project metrics page: the
 * title always renders; the chart slot masks itself while loading and falls
 * back to an `EmptyState` when the period has no data.
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

/**
 * The workforce dashboard (mirrors the automations / project metrics pages):
 * master automation toggle, operational health strip, paired KPI stat cards
 * (outcome + intervention + cost — never cost alone), the activity trend
 * chart, the agent leaderboard, and the needs-attention queues with task
 * deep links.
 */
export function WorkforceDashboard({
  organizationId,
  canToggle,
  periodDays,
}: {
  organizationId: string;
  canToggle: boolean;
  periodDays: PeriodDays;
}) {
  const { t } = useT('workforce');
  const { formatRelative } = useFormatDate();
  const navigate = useNavigate();
  const { metrics, isLoading } = useWorkforceMetrics(
    organizationId,
    periodDays,
  );
  const { health } = useWorkforceHealth(organizationId);
  const { attention } = useNeedsAttention(organizationId);
  const setAutomation = useSetTaskAutomation();

  const totals = metrics?.totals;
  const interventionEvents =
    (totals?.reviewsChangesRequested ?? 0) + (totals?.escalations ?? 0);
  const interventionRate =
    totals && totals.agentRunsStarted > 0
      ? Math.round((interventionEvents / totals.agentRunsStarted) * 100)
      : 0;
  const reviewPassRate =
    totals && totals.reviewsPassed + totals.reviewsChangesRequested > 0
      ? Math.round(
          (totals.reviewsPassed /
            (totals.reviewsPassed + totals.reviewsChangesRequested)) *
            100,
        )
      : undefined;
  const avgCycleHours =
    totals && totals.cycleTimeCount > 0
      ? formatHours(totals.cycleTimeSumMs / totals.cycleTimeCount)
      : undefined;

  const stats = [
    {
      label: t('kpi.completed', { days: periodDays }),
      value: String(totals?.tasksCompleted ?? 0),
      detail: t('kpi.completedDetail', {
        agent: totals?.agentCompleted ?? 0,
        human: totals?.humanCompleted ?? 0,
      }),
    },
    {
      label: t('kpi.intervention'),
      value: `${interventionRate}%`,
      detail:
        reviewPassRate !== undefined
          ? t('kpi.reviewPassRate', { pct: reviewPassRate })
          : t('kpi.noReviews'),
    },
    {
      label: t('kpi.cycleTime'),
      value: avgCycleHours !== undefined ? `${avgCycleHours}h` : '—',
      detail: t('kpi.runs', {
        started: totals?.agentRunsStarted ?? 0,
        failed: totals?.agentRunsFailed ?? 0,
      }),
    },
    {
      label: t('kpi.cost', { days: periodDays }),
      value: formatCents(totals?.totalCostCents ?? 0),
      detail: t('kpi.costDetail', {
        perTask:
          totals && totals.tasksCompleted > 0
            ? formatCents(totals.totalCostCents / totals.tasksCompleted)
            : '0.00',
      }),
    },
  ];

  const trendData = (metrics?.trend ?? []).map((point) => ({
    label: shortDay(point.dateKey),
    tasksCompleted: point.tasksCompleted,
    agentRunsFailed: point.agentRunsFailed,
  }));

  const leaderboardRows = useMemo(
    () => (metrics?.leaderboard ?? []).slice(0, 10),
    [metrics],
  );

  const handleLeaderboardRowClick = useCallback(
    (row: Row<WorkforceLeaderboardRow>) => {
      void navigate({
        to: '/dashboard/$id/agents/$agentId',
        params: { id: organizationId, agentId: row.original.agentSlug },
      });
    },
    [navigate, organizationId],
  );

  const leaderboardColumns = useMemo<ColumnDef<WorkforceLeaderboardRow>[]>(
    () => [
      {
        id: 'agent',
        header: t('leaderboard.agent'),
        cell: ({ row }) => (
          <Link
            to="/dashboard/$id/agents/$agentId"
            params={{ id: organizationId, agentId: row.original.agentSlug }}
            className="text-foreground block max-w-[320px] truncate text-sm font-medium underline-offset-2 hover:underline focus-visible:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {row.original.agentSlug}
          </Link>
        ),
        size: 320,
      },
      {
        id: 'completed',
        header: () => (
          <div className="text-right">{t('leaderboard.completed')}</div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.tasksCompleted)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
      {
        id: 'runs',
        header: () => <div className="text-right">{t('leaderboard.runs')}</div>,
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.runsStarted)}
            {row.original.runsFailed > 0 && (
              <span className="text-red-600 dark:text-red-400">
                {' '}
                ({formatNumber(row.original.runsFailed)})
              </span>
            )}
          </div>
        ),
        meta: { align: 'right' as const },
      },
      {
        id: 'bounceRate',
        header: () => (
          <div className="text-right">{t('leaderboard.bounceRate')}</div>
        ),
        cell: ({ row }) => {
          const reviews =
            row.original.reviewsPassed + row.original.reviewsChangesRequested;
          const bounce =
            reviews > 0
              ? Math.round(
                  (row.original.reviewsChangesRequested / reviews) * 100,
                )
              : 0;
          return <div className="text-right font-mono text-xs">{bounce}%</div>;
        },
        meta: { align: 'right' as const },
      },
      {
        id: 'cost',
        header: () => <div className="text-right">{t('leaderboard.cost')}</div>,
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatCents(row.original.costCents)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
    ],
    [t, organizationId],
  );

  const onToggle = (enabled: boolean) => {
    setAutomation.mutate(
      { organizationId, enabled },
      {
        onError: (error) => {
          console.error('[workforce] automation toggle failed', error);
          toast({ title: t('toggle.error'), variant: 'destructive' });
        },
      },
    );
  };

  return (
    <Stack>
      {/* Master toggle + health strip */}
      <Stack
        as="section"
        gap={3}
        className="border-border bg-card rounded-lg border p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Power
              className={cn(
                'size-4',
                health?.automationEnabled
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-muted-foreground',
              )}
              aria-hidden
            />
            <div>
              <Text as="h3" variant="label">
                {t('toggle.title')}
              </Text>
              <Text as="p" variant="muted" className="text-sm">
                {health?.automationEnabled
                  ? t('toggle.onHint')
                  : t('toggle.offHint')}
              </Text>
            </div>
          </div>
          <Switch
            checked={health?.automationEnabled ?? true}
            disabled={!canToggle || setAutomation.isPending || !health}
            onCheckedChange={onToggle}
            aria-label={t('toggle.title')}
          />
        </div>
        {health && (
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span>{t('health.runs24h', { count: health.runsStarted24h })}</span>
            <span
              className={cn(
                health.runsFailed24h + health.runsTimedOut24h > 0 &&
                  'text-amber-600 dark:text-amber-400',
              )}
            >
              {t('health.failures24h', {
                count: health.runsFailed24h + health.runsTimedOut24h,
              })}
            </span>
            <span
              className={cn(
                health.packFailures24h > 0 && 'text-red-600 dark:text-red-400',
              )}
            >
              {t('health.packFailures24h', { count: health.packFailures24h })}
            </span>
            {health.oldestQueuedMs !== undefined && (
              <span>
                {t('health.oldestQueued', {
                  age: formatRelative(new Date(health.oldestQueuedMs)),
                })}
              </span>
            )}
          </div>
        )}
      </Stack>

      {!isLoading && totals?.capped ? (
        <div className="border-border bg-muted/40 rounded-md border px-3 py-2 text-xs">
          {t('cappedNotice')}
        </div>
      ) : null}

      <Skeletonize loading={isLoading} className="flex flex-col gap-4">
        {/* Paired KPI stat cards */}
        <Grid as="section" cols={2} lg={4} gap={3}>
          {stats.map((stat) => (
            <Stack
              key={stat.label}
              gap={1}
              className="border-border bg-card rounded-lg border p-3"
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
            </Stack>
          ))}
        </Grid>

        {/* Trend */}
        <ChartCard
          title={t('trend.title')}
          heightClassName="h-52"
          isLoading={isLoading}
          isEmpty={trendData.length === 0}
          emptyTitle={t('noData')}
          emptyDescription={t('noDataDescription')}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
              <XAxis dataKey="label" fontSize={11} />
              <YAxis allowDecimals={false} fontSize={11} width={28} />
              <Tooltip />
              <Bar
                dataKey="tasksCompleted"
                name={t('trend.completed')}
                fill="var(--color-chart-success, #10b981)"
                radius={[2, 2, 0, 0]}
              />
              <Bar
                dataKey="agentRunsFailed"
                name={t('trend.failedRuns')}
                fill="var(--color-chart-failure, #ef4444)"
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </Skeletonize>

      {/* Leaderboard */}
      <Stack gap={3}>
        <h2 className="text-base font-semibold">{t('leaderboard.title')}</h2>
        <DataTable
          caption={t('leaderboard.title')}
          columns={leaderboardColumns}
          data={leaderboardRows}
          getRowId={(row) => row.agentSlug}
          isLoading={isLoading}
          approxRowCount={isLoading ? 5 : leaderboardRows.length}
          onRowClick={handleLeaderboardRowClick}
          emptyState={{
            icon: BarChart3,
            title: t('noData'),
            description: t('noDataDescription'),
          }}
        />
      </Stack>

      {/* Needs attention */}
      {attention && (
        <section className="grid gap-3 lg:grid-cols-2">
          <AttentionList
            title={t('attention.pendingReviews')}
            icon={Eye}
            emptyLabel={t('attention.none')}
            items={attention.pendingReviews.map((review) => ({
              key: review.approvalId,
              label: review.taskTitle ?? review.taskId ?? review.approvalId,
              meta: review.agentSlug,
              taskId: review.taskId,
              projectId: review.projectId,
            }))}
            organizationId={organizationId}
          />
          <AttentionList
            title={t('attention.staleTasks')}
            icon={AlertTriangle}
            emptyLabel={t('attention.none')}
            items={attention.staleTasks.map((task) => ({
              key: task.taskId,
              label: task.title,
              meta: task.assigneeId,
              taskId: task.taskId,
              projectId: task.projectId,
            }))}
            organizationId={organizationId}
          />
          <AttentionList
            title={t('attention.queuedRuns')}
            icon={Hourglass}
            emptyLabel={t('attention.none')}
            items={attention.queuedRuns.map((run, index) => ({
              key: `${run.agentSlug}-${run.taskId ?? index}`,
              label: run.agentSlug,
              meta: formatRelative(new Date(run.queuedAt)),
              taskId: run.taskId,
            }))}
            organizationId={organizationId}
          />
          <AttentionList
            title={t('attention.trippedBreakers')}
            icon={PauseCircle}
            emptyLabel={t('attention.none')}
            items={attention.trippedBreakers.map((breaker, index) => ({
              key: `${breaker.agentSlug}-${breaker.taskId ?? index}`,
              label: breaker.agentSlug,
              meta: formatRelative(new Date(breaker.trippedAt)),
              taskId: breaker.taskId,
            }))}
            organizationId={organizationId}
          />
        </section>
      )}
    </Stack>
  );
}

function AttentionList({
  title,
  icon: Icon,
  items,
  emptyLabel,
  organizationId,
}: {
  title: string;
  icon: typeof Eye;
  items: Array<{
    key: string;
    label: string;
    meta?: string;
    taskId?: string;
    projectId?: string;
  }>;
  emptyLabel: string;
  organizationId: string;
}) {
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <div className="flex items-center gap-1.5">
        <Icon className="text-muted-foreground size-4" aria-hidden />
        <Text as="h3" variant="label">
          {title}
        </Text>
        <Badge variant="outline" className="ml-auto text-[10px]">
          {items.length}
        </Badge>
      </div>
      {items.length === 0 ? (
        <Text as="p" variant="muted" className="mt-2 text-sm italic">
          {emptyLabel}
        </Text>
      ) : (
        <Stack as="ul" gap={1} className="mt-2">
          {items.slice(0, 8).map((item) => (
            <li
              key={item.key}
              className="flex items-center justify-between gap-2 text-sm"
            >
              {item.taskId && item.projectId ? (
                <Link
                  to="/dashboard/$id/projects/$projectId/tasks"
                  params={{
                    id: organizationId,
                    projectId: item.projectId,
                  }}
                  search={{ task: item.taskId }}
                  className="min-w-0 truncate hover:underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span className="min-w-0 truncate">{item.label}</span>
              )}
              {item.meta && (
                <span className="text-muted-foreground shrink-0 text-xs">
                  {item.meta}
                </span>
              )}
            </li>
          ))}
        </Stack>
      )}
    </div>
  );
}
