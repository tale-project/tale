'use client';

/**
 * Ambient status cell: when the latest run about a subject is parked behind the
 * org's sandbox concurrency cap, this shows a "Queued for capacity" chip *in
 * place of* the task's status badge, so a parked row reads as one state instead
 * of a contradictory "in_progress + Queued for capacity" pair. The task's
 * lifecycle status is untouched — only the display swaps; the orange dot matches
 * the run view's queued step badge. Owns the status cell via Collection's
 * `rowAccessory`, returning the supplied status badge whenever it isn't parked.
 *
 * Reads a tiny boolean query (not the full run summary) so each visible row's
 * subscription only pushes when the parked state actually flips, not on every
 * ~4s poll of a running execution. While the query is loading, and once it
 * settles to "not parked", it renders the unchanged status badge.
 *
 * Like `SubjectRun`, this is platform code reading org-RLS-gated execution data
 * directly — not an app-authored view binding — so it needs no app allowlist.
 */
import { Badge } from '@tale/ui/badge';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { useAppRuntime } from '../../runtime/app-runtime';

export function SubjectCapacityChip({
  subjectType,
  subjectId,
  fallback,
}: {
  subjectType: string;
  subjectId: string;
  /** The default status badge, shown unless the run is parked on capacity. */
  fallback: React.ReactNode;
}) {
  const { t } = useT('apps');
  const { organizationId } = useAppRuntime();
  const { data } = useConvexQuery(
    api.workflow_executions.queries.getSubjectAwaitingCapacity,
    { organizationId, subjectType, subjectId },
  );
  if (data !== true) return fallback;
  return (
    <Badge variant="orange" dot title={t('runs.queuedForCapacityHint')}>
      {t('runs.queuedForCapacity')}
    </Badge>
  );
}
