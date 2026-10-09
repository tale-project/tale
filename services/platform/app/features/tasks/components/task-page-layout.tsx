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
import { Skeletonize } from '@tale/ui/skeleton-context';
import { ThreadHeader } from '@tale/ui/thread-header';
import { Tooltip } from '@tale/ui/tooltip';
import { useIsMobile } from '@tale/ui/use-is-mobile';
import { useMediaQuery } from '@tale/ui/use-media-query';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { HomeBackButton } from '@/app/features/home/components/home-back-button';
import { HomePanelToggle } from '@/app/features/home/components/home-panel-toggle';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useT } from '@/lib/i18n/client';

import { TaskThreadColumn } from './task-thread-column';

/** Tailwind's `xl`: where the details panel docks instead of opening as a
 *  sheet. Kept in step with the aside's `xl:block`. */
const DOCKED_DETAILS_QUERY = '(min-width: 1280px)';

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
  loading = false,
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
  /** The task is on its way: the slots hold masked stand-ins, and the frame
   *  itself stays mounted, so nothing moves when the task arrives. */
  loading?: boolean;
}) {
  const { t } = useT('tasks');
  const [detailsOpen, setDetailsOpen] = usePersistedState(
    'task-page-details-open',
    true,
  );
  // The panel docks beside the thread only where both fit: from xl the
  // conversation keeps ~600px next to the rail, the Home panel and these
  // 20rem. Narrower — a tablet, a half-screen window, a phone — the details
  // open as a sheet over the conversation instead (from the side, or from the
  // bottom on a phone); docked there, they left the thread a 200px column.
  const isMobile = useIsMobile();
  const canDock = useMediaQuery(DOCKED_DETAILS_QUERY);
  const [sheetOpen, setSheetOpen] = useState(false);
  const docked = canDock && detailsOpen;
  const showingDetails = canDock ? detailsOpen : sheetOpen;
  const toggleLabel = showingDetails
    ? t('detail.hideDetails')
    : t('detail.showDetails');

  return (
    <Skeletonize loading={loading} className="flex min-h-0 flex-1 flex-col">
      <ThreadHeader
        // The way back and the page's verbs never wait for the task: a slow
        // load must not trap anyone on the page.
        before={
          <Skeletonize loading={false} className="contents">
            <HomePanelToggle />
            <HomeBackButton organizationId={organizationId} />
          </Skeletonize>
        }
        leading={leading}
        title={title}
        meta={meta}
        actions={
          <Skeletonize loading={false} className="contents">
            {actions}
            <Tooltip content={toggleLabel} side="bottom">
              <Button
                size="icon"
                variant="ghost"
                onClick={() =>
                  canDock ? setDetailsOpen(!detailsOpen) : setSheetOpen(true)
                }
                aria-label={toggleLabel}
                aria-expanded={showingDetails}
                aria-haspopup={canDock ? undefined : 'dialog'}
                aria-controls={
                  canDock
                    ? 'task-details'
                    : sheetOpen
                      ? 'task-details-sheet'
                      : undefined
                }
                className="text-muted-foreground hover:text-foreground size-8"
              >
                {showingDetails ? (
                  <PanelRightClose className="size-4" />
                ) : (
                  <PanelRightOpen className="size-4" />
                )}
              </Button>
            </Tooltip>
          </Skeletonize>
        }
      />
      <div className="flex min-h-0 flex-1">
        <TaskThreadColumn
          className="mobile-nav-clearance mobile-nav-inset"
          brief={brief}
          conversation={conversation}
          composer={composer}
        />
        <aside
          id="task-details"
          aria-label={t('detail.details')}
          inert={!docked || undefined}
          className={cn(
            'border-border hidden shrink-0 overflow-hidden border-l [transition:width_260ms_var(--ease-out-quint)] motion-reduce:transition-none xl:block',
            detailsOpen ? 'w-80' : 'w-0 border-l-0',
          )}
        >
          {canDock && (
            <div className="scrollbar-thin flex h-full w-80 flex-col gap-4 overflow-y-auto px-5 py-5">
              <h2 className="sr-only">{t('detail.details')}</h2>
              {panel}
            </div>
          )}
        </aside>
      </div>
      <Sheet
        open={!canDock && sheetOpen}
        onOpenChange={setSheetOpen}
        side={isMobile ? 'bottom' : 'right'}
        title={t('detail.details')}
        className={
          isMobile
            ? 'h-auto! max-h-[80vh] overflow-y-auto rounded-t-2xl p-5'
            : 'w-80 overflow-y-auto p-5'
        }
      >
        <div id="task-details-sheet" className="flex flex-col gap-4 pt-2">
          {panel}
        </div>
      </Sheet>
    </Skeletonize>
  );
}
