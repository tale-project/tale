'use client';

/**
 * The day a stretch of a conversation happened, as a centred pill between
 * two hairlines. While the reader scrolls through that day, the pill stays
 * pinned near the top of the scroller; the hairlines stay where the day
 * begins.
 *
 * Put it first in the element that holds the day's entries (see
 * `groupByDay`): a sticky pill travels only as far as its parent reaches,
 * which is what hands it over to the next day's pill. Under a divider, show
 * clock times — it already names the day.
 */

import { SkeletonCircle } from '@tale/ui/skeleton';
import type { ReactNode, Ref } from 'react';

import { cn } from '../../lib/cn';

export interface ThreadDayDividerProps {
  /** The day, already formatted ("Today", "Monday, October 5"). */
  children: ReactNode;
  /** Pin the pill while its day scrolls by. @default true */
  sticky?: boolean;
  /** The pill row's element; a heading level when days structure the page.
   * @default 'div' */
  as?: 'div' | 'h2' | 'h3' | 'h4';
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

export function ThreadDayDivider({
  children,
  sticky = true,
  as: Tag = 'div',
  className,
  ref,
}: ThreadDayDividerProps) {
  return (
    <>
      {/* The hairline: in the flow where the day begins, centred behind the
          pill (half the pill's 22px height), so it scrolls away with the
          day's first entries while the pill stays pinned. */}
      <div
        aria-hidden
        data-slot="thread-day-rule"
        className="bg-border pointer-events-none mt-2 h-px translate-y-[11px]"
      />
      <Tag
        ref={ref}
        data-slot="thread-day-divider"
        className={cn(
          '-mt-px mb-4 flex justify-center',
          sticky && 'sticky top-2 z-10',
          className,
        )}
      >
        {/* The background band cuts the hairline 12px either side of the
            pill, and keeps text scrolling under a pinned pill out of it. */}
        <span className="bg-background flex rounded-full px-3">
          <SkeletonCircle asChild>
            <span className="border-border bg-background/95 text-muted-foreground rounded-full border px-2.5 py-0.5 text-xs leading-4 font-medium shadow-xs">
              {children}
            </span>
          </SkeletonCircle>
        </span>
      </Tag>
    </>
  );
}
