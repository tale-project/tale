'use client';

/**
 * A task's reading column — the same on its page and in the board's dialog:
 * the brief that opens the thread (what the task is, what it needs, what it
 * splits into), the conversation under it, and the composer pinned at the
 * foot where a reply goes.
 *
 * The column scrolls on its own and starts at the newest end, the way a chat
 * reads: a long task opens on its latest exchange with the composer under
 * it, the brief one scroll up; a short one shows everything from the top.
 * Its scrollport is an ordinary one, held on the newest end by
 * `useThreadScroll` — the board's dialog locks the page's scroll, and the
 * lock only lets a wheel or a touch scroll up where `scrollTop` is above 0.
 * A host can hand the scrolling to an ancestor through `scrollerClassName`
 * — the phone's drawer scrolls the whole dialog as one column.
 */

import { cn } from '@tale/ui/cn';
import type { ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

import { useThreadScroll } from '../hooks/use-thread-scroll';

export function TaskThreadColumn({
  brief,
  conversation,
  composer,
  className,
  scrollerClassName,
  contentClassName,
  composerClassName,
}: {
  brief: ReactNode;
  conversation: ReactNode;
  composer?: ReactNode;
  className?: string;
  /** The scrollport: its padding sits inside it, so the scrollbar keeps to
   *  the column's edge. */
  scrollerClassName?: string;
  /** The brief and the conversation's own column inside the scrollport. */
  contentClassName?: string;
  composerClassName?: string;
}) {
  const { t } = useT('tasks');
  const { scrollerRef, contentRef } = useThreadScroll();
  return (
    <div className={cn('flex min-w-0 flex-1 flex-col', className)}>
      {/* The thread opens on the latest message, and a new one arriving at the
          foot stays in sight — the way a chat reads. */}
      <div
        ref={scrollerRef}
        data-testid="task-thread-scrollport"
        className={cn(
          'scrollbar-thin min-h-0 flex-1 overflow-y-auto',
          scrollerClassName,
        )}
      >
        <div
          ref={contentRef}
          className={cn(
            'mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-6 pb-4',
            contentClassName,
          )}
        >
          <section className="flex flex-col gap-5">
            <h2 className="sr-only">{t('detail.overview')}</h2>
            {brief}
          </section>
          <section>
            <h2 className="sr-only">{t('detail.conversation')}</h2>
            {conversation}
          </section>
        </div>
      </div>
      {composer !== undefined && composer !== null && composer !== false && (
        <div
          className={cn(
            'mx-auto w-full max-w-3xl shrink-0 px-6 pb-4',
            composerClassName,
          )}
        >
          {composer}
        </div>
      )}
    </div>
  );
}
