'use client';

/**
 * Actions-cell gate for a subject whose latest run parked awaiting operator
 * input. The config-driven cluster (e.g. a "Start" bound action) would re-run
 * the automation WITHOUT the answer it is waiting for, so on such rows the
 * actions cell simply goes quiet: the row expands like any other (chevron /
 * row click) to the question and the inline answer panel
 * (`SubjectInputPanel`), and the "Needs your input" chip carries the
 * guidance. Every other run state renders the cluster unchanged.
 *
 * Reads the same tiny per-row indicator query as the status chip and the
 * re-run action (Convex dedupes the identical subscription), so it adds no
 * server load. Platform code reading org-RLS-gated execution data directly
 * (like `SubjectRun`), so it needs no automation allowlist.
 */
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

import { useAutomationRuntime } from '../../runtime/automation-runtime';

export function SubjectAwaitingInputActions({
  subjectType,
  subjectId,
  cluster,
}: {
  subjectType: string;
  subjectId: string;
  /** The default actions cluster (config actions + injected row actions). */
  cluster: React.ReactNode;
}) {
  const { organizationId } = useAutomationRuntime();
  const { data } = useConvexQuery(
    api.workflow_executions.queries.getSubjectRunIndicator,
    { organizationId, subjectType, subjectId },
  );
  if (data?.state === 'awaiting_input') return null;
  return <>{cluster}</>;
}
