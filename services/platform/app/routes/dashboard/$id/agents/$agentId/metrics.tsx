import { Badge } from '@tale/ui/badge';
import { Stack } from '@tale/ui/layout';
import { SectionHeader } from '@tale/ui/section-header';
import { StatCard, StatCardGrid } from '@tale/ui/stat-card-grid';
import { Text } from '@tale/ui/text';
import { TrendIndicator } from '@tale/ui/trend-indicator';
import { createFileRoute } from '@tanstack/react-router';

import { ContentArea } from '@/app/components/layout/content-area';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/agents/$agentId/metrics')({
  head: () => ({
    meta: seo('agents'),
  }),
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
  const { formatRelative } = useFormatDate();

  const { data } = useConvexQuery(
    api.task_metrics.queries.getAgentScorecard,
    organizationId ? { organizationId, agentSlug: agentId, days: 30 } : 'skip',
  );
  // The query returns v.any(); the payload shape is owned by getAgentScorecard.
  const scorecard: ScorecardPayload | undefined = data ?? undefined;

  const totals = reduceDaily(scorecard?.daily ?? []);
  const prev = reduceDaily(scorecard?.previousDaily ?? []);

  const passRate = passRateOf(totals);
  const prevPassRate = passRateOf(prev);
  const avgRunSeconds = avgRunSecondsOf(totals);
  const prevAvgRunSeconds = avgRunSecondsOf(prev);

  return (
    <ContentArea variant="narrow" gap={6}>
      <SectionHeader
        title={t('scorecard.title')}
        description={t('scorecard.subtitle')}
      />

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
                  {run.costCents > 0 ? `${formatCents(run.costCents)} · ` : ''}
                  {formatRelative(new Date(run.startedAt))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Stack>
    </ContentArea>
  );
}
