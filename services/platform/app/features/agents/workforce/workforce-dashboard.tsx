'use client';

import { Badge } from '@tale/ui/badge';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  Eye,
  Hourglass,
  PauseCircle,
  Power,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Switch } from '@/app/components/ui/forms/switch';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  useNeedsAttention,
  useSetTaskAutomation,
  useWorkforceHealth,
  useWorkforceMetrics,
} from './hooks';

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
 * The workforce dashboard: master automation toggle, operational health
 * strip, paired KPI cards (outcome + intervention + cost — never cost
 * alone), the activity trend, the agent leaderboard, and the
 * needs-attention queues with task deep links.
 */
export function WorkforceDashboard({
  organizationId,
  canToggle,
}: {
  organizationId: string;
  canToggle: boolean;
}) {
  const { t } = useT('workforce');
  const { formatRelative } = useFormatDate();
  const days = 30;
  const { metrics } = useWorkforceMetrics(organizationId, days);
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
    <div className="flex flex-col gap-4">
      {/* Master toggle + health strip */}
      <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
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
            {totals?.capped && (
              <span className="text-amber-600 dark:text-amber-400">
                {t('health.capped')}
              </span>
            )}
          </div>
        )}
      </section>

      {/* Paired KPI cards */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={CheckCircle2}
          label={t('kpi.completed', { days })}
          value={String(totals?.tasksCompleted ?? 0)}
          detail={t('kpi.completedDetail', {
            agent: totals?.agentCompleted ?? 0,
            human: totals?.humanCompleted ?? 0,
          })}
        />
        <KpiCard
          icon={Eye}
          label={t('kpi.intervention')}
          value={`${interventionRate}%`}
          detail={
            reviewPassRate !== undefined
              ? t('kpi.reviewPassRate', { pct: reviewPassRate })
              : t('kpi.noReviews')
          }
        />
        <KpiCard
          icon={Hourglass}
          label={t('kpi.cycleTime')}
          value={avgCycleHours !== undefined ? `${avgCycleHours}h` : '—'}
          detail={t('kpi.runs', {
            started: totals?.agentRunsStarted ?? 0,
            failed: totals?.agentRunsFailed ?? 0,
          })}
        />
        <KpiCard
          icon={CircleDollarSign}
          label={t('kpi.cost', { days })}
          value={formatCents(totals?.totalCostCents ?? 0)}
          detail={t('kpi.costDetail', {
            perTask:
              totals && totals.tasksCompleted > 0
                ? formatCents(totals.totalCostCents / totals.tasksCompleted)
                : '0.00',
          })}
        />
      </section>

      {/* Trend */}
      {metrics && metrics.trend.length > 0 && (
        <section className="border-border bg-card rounded-lg border p-4">
          <Text as="h3" variant="label">
            {t('trend.title')}
          </Text>
          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={metrics.trend.map((point) => ({
                  ...point,
                  label: shortDay(point.dateKey),
                }))}
              >
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
          </div>
        </section>
      )}

      {/* Leaderboard */}
      {metrics && metrics.leaderboard.length > 0 && (
        <section className="border-border bg-card rounded-lg border p-4">
          <Text as="h3" variant="label">
            {t('leaderboard.title')}
          </Text>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-border border-b text-left text-xs">
                <th className="py-1.5 pr-2 font-medium">
                  {t('leaderboard.agent')}
                </th>
                <th className="px-2 py-1.5 text-right font-medium">
                  {t('leaderboard.completed')}
                </th>
                <th className="px-2 py-1.5 text-right font-medium">
                  {t('leaderboard.runs')}
                </th>
                <th className="px-2 py-1.5 text-right font-medium">
                  {t('leaderboard.bounceRate')}
                </th>
                <th className="px-2 py-1.5 text-right font-medium">
                  {t('leaderboard.cost')}
                </th>
              </tr>
            </thead>
            <tbody>
              {metrics.leaderboard.slice(0, 10).map((row) => {
                const reviews = row.reviewsPassed + row.reviewsChangesRequested;
                const bounce =
                  reviews > 0
                    ? Math.round((row.reviewsChangesRequested / reviews) * 100)
                    : 0;
                return (
                  <tr
                    key={row.agentSlug}
                    className="border-border/50 border-b last:border-0"
                  >
                    <td className="py-1.5 pr-2">
                      <Link
                        to="/dashboard/$id/agents/$agentId"
                        params={{
                          id: organizationId,
                          agentId: row.agentSlug,
                        }}
                        className="hover:underline"
                      >
                        {row.agentSlug}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {row.tasksCompleted}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {row.runsStarted}
                      {row.runsFailed > 0 && (
                        <span className="text-red-600 dark:text-red-400">
                          {' '}
                          ({row.runsFailed})
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {bounce}%
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatCents(row.costCents)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

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
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="border-border bg-card flex flex-col gap-1 rounded-lg border p-4">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </div>
      <Text as="p" className="text-2xl font-semibold tabular-nums">
        {value}
      </Text>
      <Text as="p" variant="muted" className="text-xs">
        {detail}
      </Text>
    </div>
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
        <ul className="mt-2 flex flex-col gap-1">
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
        </ul>
      )}
    </div>
  );
}
