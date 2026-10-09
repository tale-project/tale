'use client';

/**
 * A task's reading column — the same on its page and in the board's dialog:
 * the brief card that opens the thread (what the task is, what it needs, what
 * it splits into), the conversation under it, and the composer pinned at the
 * foot where a reply goes.
 *
 * The column scrolls on its own and starts at the newest end, the way a chat
 * reads: a long task opens on its latest exchange with the composer under
 * it, the brief one scroll up; a short one shows everything from the top.
 * A host can hand the scrolling to an ancestor through `scrollerClassName`
 * — the phone's drawer scrolls the whole dialog as one column.
 */

import { cn } from '@tale/ui/cn';
import type { ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

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
  return (
    <div className={cn('flex min-w-0 flex-1 flex-col', className)}>
      {/* column-reverse keeps the view anchored at the newest end: the thread
          opens on the latest message, and a new one arriving at the foot
          stays in sight — the way a chat reads. */}
      <div
        className={cn(
          'scrollbar-thin flex min-h-0 flex-1 flex-col-reverse overflow-y-auto',
          scrollerClassName,
        )}
        onWheel={(event) => {
          const scroller = event.currentTarget;
          if (
            event.deltaY === 0 ||
            scroller.scrollHeight <= scroller.clientHeight
          ) {
            return;
          }
          // In a column-reverse scrollport the newest end is scrollTop 0 and
          // the history lives at negative offsets. Chromium can interpret
          // that 0 boundary as the top of the scrollport and swallow the
          // first upward wheel gesture. Apply the wheel delta in the reverse
          // coordinate system so the reader can always leave the newest end.
          const minimum = scroller.clientHeight - scroller.scrollHeight;
          const next = Math.max(
            minimum,
            Math.min(0, scroller.scrollTop + event.deltaY),
          );
          if (next === scroller.scrollTop) return;
          event.preventDefault();
          scroller.scrollTop = next;
        }}
      >
        {/* mb-auto: a short thread starts at the top instead of sinking to the
            foot of an otherwise empty column. */}
        <div
          className={cn(
            'mx-auto mb-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-6 pb-4',
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
