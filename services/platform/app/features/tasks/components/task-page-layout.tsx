'use client';

/**
 * The frame of a task opened on its own page — the same frame a chat and a
 * customer conversation open in: the thread header (identity, title, one
 * line of context, actions), a centred reading column that starts at the
 * newest end, the composer pinned under it, and the task's details in a side
 * panel that can be folded away. A task differs from a chat only by that
 * panel of structure beside the conversation.
 */

import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { Sheet } from '@tale/ui/sheet';
import { ThreadHeader } from '@tale/ui/thread-header';
import { Tooltip } from '@tale/ui/tooltip';
import { useIsMobile } from '@tale/ui/use-is-mobile';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { HomeBackButton } from '@/app/features/home/components/home-back-button';
import { HomePanelToggle } from '@/app/features/home/components/home-panel-toggle';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useT } from '@/lib/i18n/client';

export function TaskPageLayout({
  organizationId,
  leading,
  title,
  meta,
  actions,
  brief,
  conversation,
  composer,
  panel,
}: {
  organizationId: string;
  leading: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  /** The page's own verbs (open the board), before the details toggle. */
  actions?: ReactNode;
  /** What the task is: description, files, subtasks — the thread's opening. */
  brief: ReactNode;
  conversation: ReactNode;
  composer?: ReactNode;
  /** Status, owner, dates and the rest of the task's structure. */
  panel: ReactNode;
}) {
  const { t } = useT('tasks');
  const [detailsOpen, setDetailsOpen] = usePersistedState(
    'task-page-details-open',
    true,
  );
  // On a phone the details open as a sheet over the conversation; the
  // docked panel would leave the thread no room.
  const isMobile = useIsMobile();
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const toggleLabel = detailsOpen
    ? t('detail.hideDetails')
    : t('detail.showDetails');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ThreadHeader
        before={
          <>
            <HomePanelToggle />
            <HomeBackButton organizationId={organizationId} />
          </>
        }
        leading={leading}
        title={title}
        meta={meta}
        actions={
          <>
            {actions}
            <Tooltip content={toggleLabel} side="bottom">
              <Button
                size="icon"
                variant="ghost"
                onClick={() =>
                  isMobile
                    ? setMobileDetailsOpen(true)
                    : setDetailsOpen(!detailsOpen)
                }
                aria-label={isMobile ? t('detail.showDetails') : toggleLabel}
                aria-expanded={isMobile ? mobileDetailsOpen : detailsOpen}
                aria-controls="task-details"
                className="text-muted-foreground hover:text-foreground size-8"
              >
                {detailsOpen ? (
                  <PanelRightClose className="size-4" />
                ) : (
                  <PanelRightOpen className="size-4" />
                )}
              </Button>
            </Tooltip>
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* column-reverse keeps the view anchored at the newest end: the
              page opens on the latest message, and a new one arriving at the
              foot stays in sight — the way a chat reads. */}
          <div className="scrollbar-thin flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
            {/* mb-auto: a short thread starts at the top instead of sinking
                to the foot of an otherwise empty column. */}
            <div className="mx-auto mb-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-6 pb-4">
              {/* The brief is the thread's opening: what the task is, what it
                  needs, what it splits into. */}
              <div className="border-border bg-card flex flex-col gap-5 rounded-2xl border p-5 shadow-xs">
                {brief}
              </div>
              {conversation}
            </div>
          </div>
          {composer !== undefined &&
            composer !== null &&
            composer !== false && (
              <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pb-4">
                {composer}
              </div>
            )}
        </div>
        <aside
          id="task-details"
          aria-label={t('detail.details')}
          inert={!detailsOpen || undefined}
          className={cn(
            'border-border hidden shrink-0 overflow-hidden border-l [transition:width_260ms_var(--ease-out-quint)] motion-reduce:transition-none md:block',
            detailsOpen ? 'w-80' : 'w-0 border-l-0',
          )}
        >
          <div className="scrollbar-thin flex h-full w-80 flex-col gap-4 overflow-y-auto px-5 py-5">
            {panel}
          </div>
        </aside>
      </div>
      <Sheet
        open={isMobile && mobileDetailsOpen}
        onOpenChange={setMobileDetailsOpen}
        side="bottom"
        title={t('detail.details')}
        className="h-auto! max-h-[80vh] overflow-y-auto rounded-t-2xl p-5"
      >
        <div className="flex flex-col gap-4 pt-2">{panel}</div>
      </Sheet>
    </div>
  );
}
