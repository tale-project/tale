'use client';

import { lazyComponent } from '@tale/ui/lazy-component';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { Loader2 } from 'lucide-react';
import type { ComponentProps } from 'react';

import { useT } from '@/lib/i18n/client';

import type { TaskRunDetailsContent as TaskRunDetailsContentImpl } from './task-run-details-content';

/**
 * The dialog's body loads the first time a dialog opens: it orders the steps
 * through the automation's graph, and the graph brings the expression parser
 * — weight no task page should carry before anyone asks for a run.
 */
const TaskRunDetailsContent = lazyComponent<
  ComponentProps<typeof TaskRunDetailsContentImpl>
>(() =>
  import('./task-run-details-content').then((module) => ({
    default: module.TaskRunDetailsContent,
  })),
);

/**
 * An automation run's steps, inspected WITHOUT leaving the task — live while
 * it runs, preserved after it finished.
 *
 * One vertical step timeline, every step compact until unfolded — the
 * {@link RunStepTimeline} owns the reading. The dialog itself only resolves
 * the run and the document version it executed, and offers the full run page
 * as the way out for a deeper audit to those who may use Automations.
 * Nothing is fetched until it opens. The subject panel opens it on the live
 * run; the property panel's Run row opens it on the latest run in any state.
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
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto md:max-w-3xl">
        {/* `pr-8` keeps a long title clear of the corner Close. */}
        <ResponsiveDialogTitle className="flex items-center gap-2 pr-8 text-base font-semibold">
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
        {open && (
          <TaskRunDetailsContent
            organizationId={organizationId}
            projectId={projectId}
            automationSlug={automationSlug}
            runId={runId}
          />
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
