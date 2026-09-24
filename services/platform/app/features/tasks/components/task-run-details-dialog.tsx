'use client';

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import { useMemo } from 'react';

import { RunStepTimeline } from '@/app/features/automations/components/run-step-timeline';
import {
  useAutomation,
  useAutomationRun,
} from '@/app/features/automations/hooks/queries';
import { readDocument } from '@/app/features/automations/lib/document';
import { buildGraph } from '@/app/features/automations/lib/graph';
import {
  projectRun,
  readRunCursorNode,
} from '@/app/features/automations/lib/run-view';
import { automationSlugToParam } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';

/**
 * An automation run's steps, inspected WITHOUT leaving the task — live while
 * it runs, preserved after it finished.
 *
 * One vertical step timeline, every step compact until unfolded — the
 * {@link RunStepTimeline} owns the reading. The dialog itself only resolves
 * the run and the document version it executed, and offers the full run page
 * as the way out for a deeper audit. Nothing is fetched until it opens. The
 * subject panel opens it on the live run; the property panel's Run row opens
 * it on the latest run in any state.
 */
export function TaskRunDetailsDialog({
  organizationId,
  projectId,
  automationSlug,
  runId,
  name,
  live,
  open,
  onOpenChange,
}: {
  organizationId: string;
  projectId: string;
  automationSlug: string;
  runId: string;
  name: string;
  /** Whether the run is still moving — picks the title's tense ("progress"
   * only while there is progress to watch) and the header's spinner. */
  live: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('tasks');
  const runQuery = useAutomationRun(organizationId, open ? runId : undefined);
  const run = runQuery.data ?? null;
  const versionQuery = useAutomation(
    organizationId,
    automationSlug,
    open ? run?.version : undefined,
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
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto md:max-w-3xl">
        <ResponsiveDialogTitle className="flex items-center gap-2 text-base font-semibold">
          {live
            ? t('run.detailsTitleLive', { name })
            : t('run.detailsTitle', { name })}
          {live && (
            <Loader2
              className="text-muted-foreground size-4 shrink-0 animate-spin"
              aria-hidden
            />
          )}
        </ResponsiveDialogTitle>
        {run !== null && (
          <>
            <RunStepTimeline
              graph={graph}
              projection={projection}
              currentNodeId={currentNodeId}
              organizationId={organizationId}
              runId={runId}
            />
            {/* The dialog is the quick look; the run page is the audit. */}
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
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
