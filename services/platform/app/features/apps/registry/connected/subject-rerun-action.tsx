'use client';

/**
 * Per-row action cell for a subject whose latest run FAILED: renders the shared
 * `RerunButton` so a crashed automation can be retried in place, next to where a
 * not-yet-started row shows its "Start" action. Renders nothing for any other
 * run state, so the actions column only gains a button on the rows that need it.
 *
 * Reads the same tiny per-row indicator query the status chip uses (Convex
 * dedupes the identical subscription), so this adds no extra server load — and
 * the failed run's id comes straight from it, so the re-run targets exactly the
 * run the "Failed" badge reflects. Platform code reading org-RLS-gated execution
 * data directly (like `SubjectRun`), so it needs no app allowlist.
 */
import { RerunButton } from '@/app/features/operator/components/rerun-button';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

import { useAppRuntime } from '../../runtime/app-runtime';

export function SubjectRerunAction({
  subjectType,
  subjectId,
}: {
  subjectType: string;
  subjectId: string;
}) {
  const { organizationId } = useAppRuntime();
  const { data } = useConvexQuery(
    api.workflow_executions.queries.getSubjectRunIndicator,
    { organizationId, subjectType, subjectId },
  );
  if (data?.state !== 'failed' || !data.failedExecutionId) return null;
  return <RerunButton executionId={data.failedExecutionId} />;
}
