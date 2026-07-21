'use client';

/**
 * Actions-cell gate for a subject whose latest run makes the config-driven
 * cluster wrong to offer:
 *   - parked awaiting operator input — a "Start" bound action would re-run
 *     the automation WITHOUT the answer it is waiting for; the row expands
 *     like any other (chevron / row click) to the question and the inline
 *     answer panel (`SubjectInputPanel`), and the "Needs your input" chip
 *     carries the guidance;
 *   - starting — the run was just kicked off but the subject's status hasn't
 *     flipped yet, so the cluster would still offer Start; a second click
 *     only bounces off the duplicate-run guard, and the "Starting…" chip
 *     already explains the state.
 * On such rows the actions cell simply goes quiet. Every other run state
 * renders the cluster unchanged.
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
  if (data?.state === 'awaiting_input' || data?.state === 'starting') {
    return null;
  }
  return <>{cluster}</>;
}
