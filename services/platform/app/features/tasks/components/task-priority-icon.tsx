import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { TaskPriority } from '../lib/display';

/**
 * Visual priority indicator — a dedicated icon rather than a text badge.
 *
 * `p1`/`p2`/`p3` render an ascending bar-chart glyph (Linear-style) with the
 * lower bars filled and the rest dimmed, so the level reads at a glance without
 * colour alone. `p0` (Urgent) is visually distinct: a filled rounded square with
 * an exclamation, in the destructive colour. Each priority also carries a
 * semantic colour. An `aria-label`/`title` exposes the localized label for
 * screen readers and hover.
 */

/** Number of filled bars for the bar-chart priorities. */
const PRIORITY_LEVEL: Record<Exclude<TaskPriority, 'p0'>, 1 | 2 | 3> = {
  p1: 3,
  p2: 2,
  p3: 1,
};

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  p0: 'text-destructive',
  p1: 'text-orange-500 dark:text-orange-400',
  p2: 'text-yellow-500 dark:text-yellow-400',
  p3: 'text-muted-foreground',
};

// Bottom-aligned bars in a 16×16 box: short → tall.
const BARS = [
  { x: 1, y: 9, h: 6 },
  { x: 6.25, y: 5, h: 10 },
  { x: 11.5, y: 1, h: 14 },
] as const;

export function TaskPriorityIcon({
  priority,
  showLabel = false,
  className,
}: {
  priority: TaskPriority;
  /** Render the localized label text next to the icon. */
  showLabel?: boolean;
  className?: string;
}) {
  const { t } = useT('tasks');
  const label = t(`priority.${priority}`);

  const glyph =
    priority === 'p0' ? (
      <svg
        viewBox="0 0 16 16"
        className={cn('size-3.5', PRIORITY_COLOR.p0)}
        aria-hidden="true"
      >
        <rect
          x="1.5"
          y="1.5"
          width="13"
          height="13"
          rx="3.5"
          fill="currentColor"
        />
        <rect
          x="7"
          y="4"
          width="2"
          height="5"
          rx="1"
          className="fill-background"
        />
        <rect
          x="7"
          y="10.5"
          width="2"
          height="2"
          rx="1"
          className="fill-background"
        />
      </svg>
    ) : (
      <svg
        viewBox="0 0 16 16"
        className={cn('size-3.5', PRIORITY_COLOR[priority])}
        aria-hidden="true"
      >
        {BARS.map((bar, i) => (
          <rect
            key={bar.x}
            x={bar.x}
            y={bar.y}
            width={3.5}
            height={bar.h}
            rx={1}
            fill="currentColor"
            className={i < PRIORITY_LEVEL[priority] ? undefined : 'opacity-25'}
          />
        ))}
      </svg>
    );

  if (showLabel) {
    return (
      <span className={cn('inline-flex items-center gap-1.5', className)}>
        {glyph}
        <span className="text-sm">{label}</span>
      </span>
    );
  }

  return (
    <span
      className={cn('inline-flex shrink-0', className)}
      aria-label={label}
      title={label}
    >
      {glyph}
    </span>
  );
}
