import { Badge } from '@tale/ui/badge';
import { SectionHeader } from '@tale/ui/section-header';
import { Text } from '@tale/ui/text';
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
  recentRuns: ScorecardRun[];
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

  const totals = (scorecard?.daily ?? []).reduce(
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
  const reviews = totals.reviewsPassed + totals.reviewsChangesRequested;
  const passRate =
    reviews > 0
      ? Math.round((totals.reviewsPassed / reviews) * 100)
      : undefined;
  const avgRunSeconds =
    totals.durationCount > 0
      ? Math.round(totals.durationSum / totals.durationCount / 1000)
      : undefined;

  const stats: Array<{ label: string; value: string; detail?: string }> = [
    {
      label: t('scorecard.tasksCompleted'),
      value: String(totals.tasksCompleted),
      detail: t('kpi.runs', {
        started: totals.runsStarted,
        failed: totals.runsFailed,
      }),
    },
    {
      label: t('scorecard.reviewOutcome'),
      value: passRate !== undefined ? `${passRate}%` : '—',
      detail: t('scorecard.reviewDetail', {
        passed: totals.reviewsPassed,
        changes: totals.reviewsChangesRequested,
        escalations: totals.escalations,
      }),
    },
    {
      label: t('scorecard.avgRun'),
      value: avgRunSeconds !== undefined ? `${avgRunSeconds}s` : '—',
    },
    {
      label: t('scorecard.spend'),
      value: formatCents(totals.costCents),
      detail: t('kpi.costDetail', {
        perTask:
          totals.tasksCompleted > 0
            ? formatCents(totals.costCents / totals.tasksCompleted)
            : '0.00',
      }),
    },
  ];

  return (
    <ContentArea variant="narrow" gap={6}>
      <SectionHeader
        title={t('scorecard.title')}
        description={t('scorecard.subtitle')}
      />

      <section className="grid grid-cols-2 gap-3">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="border-border bg-card flex flex-col gap-1 rounded-lg border p-4"
          >
            <Text as="p" variant="muted" className="text-xs">
              {stat.label}
            </Text>
            <Text as="p" className="text-2xl font-semibold tabular-nums">
              {stat.value}
            </Text>
            {stat.detail && (
              <Text as="p" variant="muted" className="text-xs">
                {stat.detail}
              </Text>
            )}
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2">
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
      </section>
    </ContentArea>
  );
}
