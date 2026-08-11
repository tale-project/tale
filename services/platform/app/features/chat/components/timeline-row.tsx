'use client';

/**
 * One line of the thinking strip — the header, a tool step, the ask row.
 *
 * All three used to be hand-rolled, and all three drifted: the header carried a
 * bare `size-3.5` icon with `gap-1.5` and `font-medium`, a step with a chevron
 * carried a `size-4` box with `gap-2` plus a `size-3` chevron, and a step
 * WITHOUT a chevron carried neither — three different places for the text to
 * start, so the strip's left edge came out ragged and the header read as a
 * different kind of thing than the rows under it.
 *
 * The disclosure slot is always the same width. When there is nothing to open
 * it holds an `aria-hidden` spacer instead of the chevron, which is what keeps
 * the text column flush — the alternative was dropping chevrons entirely and
 * making the whole row an invisible target, which loses an explicit
 * affordance for a cosmetic gain.
 */

import { ChevronRight } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

export interface TimelineRowProps {
  icon: ComponentType<{ className?: string }>;
  /** The line's text. Truncates — these rows are one line each, always. */
  label: ReactNode;
  /** Right-aligned extra: the header's live dots, the ask row's outcome. */
  trailing?: ReactNode;
  /**
   * Given when the row opens something. The row becomes a button carrying the
   * disclosure state; absent, the slot is a spacer and the row is inert.
   */
  onToggle?: () => void;
  expanded?: boolean;
  /** The element `onToggle` reveals, for `aria-controls`. */
  controls?: string;
  /** Overrides the icon while a step is running or failed. */
  iconClassName?: string;
  className?: string;
}

export function TimelineRow({
  icon: Icon,
  label,
  trailing,
  onToggle,
  expanded = false,
  controls,
  iconClassName,
  className,
}: TimelineRowProps) {
  const body = (
    <>
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        <Icon
          aria-hidden
          className={cn('text-muted-foreground size-3.5', iconClassName)}
        />
      </span>
      {onToggle ? (
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'mt-1 size-3 shrink-0 transition-transform',
            expanded && 'rotate-90',
          )}
        />
      ) : (
        // The spacer that flushes the column. Same width as the chevron, so a
        // row with nothing to open still starts its text where the others do.
        <span aria-hidden className="mt-1 size-3 shrink-0" />
      )}
      {/* The label takes only the width it needs and truncates when the row
          runs out — NOT `flex-1`. Stretching it pushed the trailing slot to
          the far right edge of the message column, which is where the
          person's own messages sit, so an outcome badge read as a reply
          rather than as part of this line. */}
      <span className="min-w-0 truncate text-left">{label}</span>
      {trailing !== undefined && <span className="shrink-0">{trailing}</span>}
    </>
  );

  const shared = cn(
    'text-muted-foreground flex w-full min-w-0 items-start gap-2 text-sm',
    className,
  );

  if (!onToggle) {
    return (
      <div data-testid="timeline-row" className={shared}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-testid="timeline-row"
      onClick={onToggle}
      aria-expanded={expanded}
      {...(expanded && controls !== undefined
        ? { 'aria-controls': controls }
        : {})}
      className={cn(
        shared,
        'hover:text-foreground cursor-pointer transition-colors',
      )}
    >
      {body}
    </button>
  );
}
