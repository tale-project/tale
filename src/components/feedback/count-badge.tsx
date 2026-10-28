import { cn } from '../../lib/cn';

export interface CountBadgeProps {
  /** How many items wait. Nothing renders at zero or below. */
  count: number;
  /** Where the chip sits on its glyph, e.g. `absolute -top-1.5 -right-1.5`. */
  className?: string;
}

/** The largest count printed in full; anything above reads "99+". */
const MAX_SHOWN = 99;

/** The chip's look, for the rare caller whose chip holds a mark, not a number
 *  (the tab bar's `'!'`). Everything else renders `<CountBadge>`. */
export const COUNT_BADGE_CLASS =
  'ring-background inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] leading-none font-semibold text-white tabular-nums ring-2 dark:bg-red-500';

/**
 * The count chip on a navigation glyph — unread conversations on the Home
 * tile, unread notifications on the bell, the same tile on the phone tab bar.
 * One chip for all of them, so a count reads the same wherever it appears.
 *
 * The chip is decoration: it is `aria-hidden`, and the control it sits on must
 * carry the count's meaning in its own accessible name ("Home, 3 unread
 * conversations"), because a bare "3" says nothing to a screen reader. The
 * ring in the page colour cuts the chip out of the glyph beneath it, and a new
 * count pops the chip again (it is keyed on the number); reduced motion keeps
 * it still.
 */
export function CountBadge({ count, className }: CountBadgeProps) {
  if (count <= 0) return null;
  return (
    <span
      key={count}
      aria-hidden="true"
      data-slot="count-badge"
      className={cn(
        COUNT_BADGE_CLASS,
        'animate-in zoom-in-50 duration-300 motion-reduce:animate-none',
        className,
      )}
    >
      {count > MAX_SHOWN ? `${MAX_SHOWN}+` : count}
    </span>
  );
}
