'use client';

/**
 * Ambient status cell for a subject's row. In place of the row's own status
 * badge it surfaces the *latest run's* state when that state would otherwise be
 * invisible or contradictory:
 *   - parked behind the org's sandbox capacity cap → orange "Queued for
 *     capacity" (the run view's queued step badge);
 *   - ended in failure → destructive "Failed" (the run view's errored step
 *     badge) — so a crashed automation reads as "Failed" instead of a
 *     misleading, frozen "in_progress";
 *   - parked awaiting an operator's answer → blue "Needs your input";
 *   - kicked off but not yet reflected in the task's own status (the window
 *     between Start and the workflow's ack step) → blue "Starting…" — so
 *     pressing Start visibly reacts instead of sitting on a stale "Backlog".
 * The subject's own lifecycle/kanban status is never changed — only the display
 * swaps, so a parked or failed row reads as one coherent state instead of a
 * contradictory pair. Owns the status cell via Collection's `rowAccessory`,
 * returning the supplied status badge whenever there is nothing to surface.
 *
 * Reads a tiny indicator query (not the full run summary) so each visible row's
 * subscription only pushes when the indicator flips, not on every ~4s poll of a
 * running execution. While the query is loading, and once it settles to "nothing
 * to surface", it renders the unchanged status badge.
 *
 * Like `SubjectRun`, this is platform code reading org-RLS-gated execution data
 * directly — not an automation-authored view binding — so it needs no automation allowlist.
 */
import { Badge } from '@tale/ui/badge';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { useAutomationRuntime } from '../../runtime/automation-runtime';

export function SubjectRunStatusChip({
  subjectType,
  subjectId,
  fallback,
}: {
  subjectType: string;
  subjectId: string;
  /** The default status badge, shown unless the latest run is parked or failed. */
  fallback: React.ReactNode;
}) {
  const { t } = useT('automations');
  const { organizationId } = useAutomationRuntime();
  const { data } = useConvexQuery(
    api.workflow_executions.queries.getSubjectRunIndicator,
    { organizationId, subjectType, subjectId },
  );
  if (data?.state === 'failed') {
    return (
      <Badge variant="destructive" dot title={t('runs.failedHint')}>
        {t('runs.failed')}
      </Badge>
    );
  }
  if (data?.state === 'parked') {
    return (
      <Badge variant="orange" dot title={t('runs.queuedForCapacityHint')}>
        {t('runs.queuedForCapacity')}
      </Badge>
    );
  }
  if (data?.state === 'awaiting_input') {
    return (
      <Badge variant="blue" dot title={t('runs.awaitingInputHint')}>
        {t('runs.awaitingInput')}
      </Badge>
    );
  }
  if (data?.state === 'starting') {
    return (
      <Badge variant="blue" dot title={t('runs.startingHint')}>
        {t('runs.starting')}
      </Badge>
    );
  }
  return fallback;
}
