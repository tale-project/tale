'use client';

import { Badge } from '@tale/ui/badge';
import { Text } from '@tale/ui/text';
import { Bot } from 'lucide-react';

import { useFormatDate } from '@/app/hooks/use-format-date';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useTaskAgentRuns } from '../hooks/queries';

const STATUS_BADGE: Record<string, string> = {
  running: 'text-primary border-primary/40',
  completed: 'text-green-600 dark:text-green-400 border-green-500/40',
  failed: 'text-red-600 dark:text-red-400 border-red-500/40',
  timed_out: 'text-amber-600 dark:text-amber-400 border-amber-500/40',
};

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * "Agent activity" section of the task detail sheet: the run history this
 * task accumulated (assignment, mentions, revisions) with status, duration,
 * and accrued cost — the per-task lens onto `taskAgentRuns`.
 */
export function TaskAgentRuns({ taskId }: { taskId: Id<'tasks'> }) {
  const { t } = useT('tasks');
  const { runs } = useTaskAgentRuns(taskId);
  const { formatRelative } = useFormatDate();

  if (runs.length === 0) return null;

  const totalCostCents = runs.reduce((sum, run) => sum + run.costCents, 0);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Bot className="text-muted-foreground size-4" aria-hidden />
          <Text as="h3" variant="label">
            {t('agentRuns.title')}
          </Text>
        </div>
        {totalCostCents > 0 && (
          <Text as="span" variant="muted" className="text-xs tabular-nums">
            {t('agentRuns.totalCost', { amount: formatCents(totalCostCents) })}
          </Text>
        )}
      </div>
      <ul className="border-border divide-border divide-y overflow-hidden rounded-lg border">
        {runs.map((run) => (
          <li
            key={run.runId}
            className="flex items-center gap-2 px-2.5 py-2 text-sm"
          >
            <Badge
              variant="outline"
              className={cn('text-[10px]', STATUS_BADGE[run.status])}
            >
              {t(`agentRuns.status.${run.status}`)}
            </Badge>
            <span className="text-foreground min-w-0 flex-1 truncate">
              {run.agentSlug}
              <span className="text-muted-foreground">
                {' · '}
                {t(`agentRuns.trigger.${run.trigger}`)}
              </span>
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
    </section>
  );
}
