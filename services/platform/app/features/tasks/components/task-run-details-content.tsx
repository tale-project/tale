'use client';

import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import { useMemo } from 'react';

import { RunStepTimeline } from '@/app/features/automations/components/run-step-timeline';
import {
  useAutomation,
  useAutomationRun,
} from '@/app/features/automations/hooks/queries';
import { useCanUseAutomations } from '@/app/features/automations/hooks/use-can-use-automations';
import { readDocument } from '@/app/features/automations/lib/document';
import { buildGraph } from '@/app/features/automations/lib/graph';
import {
  cursorNodeStatus,
  projectRun,
  readRunCursorNode,
} from '@/app/features/automations/lib/run-view';
import { automationSlugToParam } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';

/**
 * The body of {@link TaskRunDetailsDialog}: the run's steps in execution
 * order. It orders them through the automation's graph, which parses every
 * expression of the document — so it loads with the dialog's first opening,
 * never with the task pages that offer it. No observers or document graph
 * exist for a closed details dialog.
 */
export function TaskRunDetailsContent({
  organizationId,
  projectId,
  automationSlug,
  runId,
}: {
  organizationId: string;
  projectId: string;
  automationSlug: string;
  runId: string;
}) {
  const runQuery = useAutomationRun(organizationId, runId);
  const run = runQuery.data ?? null;
  if (run === null) return null;
  return (
    <TaskRunTimeline
      organizationId={organizationId}
      projectId={projectId}
      automationSlug={automationSlug}
      runId={runId}
      run={run}
    />
  );
}

/** Wait for the run's version before reading its immutable document. */
function TaskRunTimeline({
  organizationId,
  projectId,
  automationSlug,
  runId,
  run,
}: {
  organizationId: string;
  projectId: string;
  automationSlug: string;
  runId: string;
  run: NonNullable<ReturnType<typeof useAutomationRun>['data']>;
}) {
  const { t } = useT('tasks');
  const canUseAutomations = useCanUseAutomations();
  const versionQuery = useAutomation(
    organizationId,
    automationSlug,
    run.version,
  );
  const automation = useMemo(
    () => readDocument(versionQuery.data?.document),
    [versionQuery.data?.document],
  );
  const graph = useMemo(() => buildGraph(automation), [automation]);
  const projection = useMemo(() => projectRun(run), [run]);
  // Where the run IS: the stepper's own cursor while it runs, else the last
  // step of the finished run's ordered trace. Never "the last key of the
  // checkpoint record" — those arrive alphabetically, which would point at
  // whichever skipped node happens to sort last.
  const currentNodeId =
    readRunCursorNode(run) ?? projection.trace.at(-1)?.node ?? null;

  return (
    <>
      <RunStepTimeline
        graph={graph}
        projection={projection}
        currentNodeId={currentNodeId}
        currentStatus={cursorNodeStatus(run)}
        waitingForRoom={run.waitingFor === 'room'}
        organizationId={organizationId}
        runId={runId}
      />
      {/* The dialog is the quick look; the run page is the audit — an
                automation page, so only for those who may use Automations. */}
      {canUseAutomations && (
        <Link
          to="/dashboard/$id/projects/$projectId/automations/$automationSlug/runs/$runId"
          params={{
            id: organizationId,
            projectId,
            automationSlug: automationSlugToParam(automationSlug),
            runId,
          }}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex w-fit items-center gap-1 rounded-sm text-xs focus-visible:ring-2 focus-visible:outline-none"
        >
          {t('run.openFull')}
          <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </>
  );
}
