'use client';

/**
 * Ambient per-row chip: shows "Queued for capacity" when the latest run about a
 * subject is parked behind the org's sandbox concurrency cap. Injected into the
 * generic `DataTable` row (via Collection's `rowAccessory`) so a collapsed task
 * row reflects the parked state WITHOUT flipping the task's lifecycle status —
 * the orange dot matches the run view's queued step badge.
 *
 * Reads a tiny boolean query (not the full run summary) so each visible row's
 * subscription only pushes when the parked state actually flips, not on every
 * ~4s poll of a running execution. Renders nothing when not parked, so it's
 * invisible for the overwhelmingly common case.
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
}: {
  subjectType: string;
  subjectId: string;
}) {
  const { t } = useT('apps');
  const { organizationId } = useAppRuntime();
  const { data } = useConvexQuery(
    api.workflow_executions.queries.getSubjectAwaitingCapacity,
    { organizationId, subjectType, subjectId },
  );
  if (data !== true) return null;
  return (
    <Badge variant="orange" dot title={t('runs.queuedForCapacityHint')}>
      {t('runs.queuedForCapacity')}
    </Badge>
  );
}
