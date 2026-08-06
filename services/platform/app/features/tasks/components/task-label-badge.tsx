'use client';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { cn } from '@/lib/utils/cn';

import type { TaskLabelRef } from '../lib/display';
import { asLabelColor, LABEL_DOT_CLASS, labelColor } from '../lib/labels';

/**
 * One task label as an outline chip with its colour dot. Prefer passing the
 * catalog `color`; without it the chip falls back to the name's default.
 * Labels are stored lowercase; `capitalize` presents them as "Bug" / "Feature".
 */
export function TaskLabelBadge({
  label,
  color,
  className,
  children,
}: {
  label: string;
  color?: string;
  className?: string;
  /** Optional trailing slot (e.g. the editor's remove button). */
  children?: React.ReactNode;
}) {
  const resolved = color ? asLabelColor(color) : labelColor(label);
  return (
    <span
      className={cn(
        'border-border bg-background text-foreground inline-flex items-center gap-1.5 overflow-hidden rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        className,
      )}
    >
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          LABEL_DOT_CLASS[resolved],
        )}
        aria-hidden="true"
      />
      <span className="truncate capitalize">{label}</span>
      {children}
    </span>
  );
}

/**
 * "+N" chip for labels that don't fit on a card/row; the tooltip names the
 * hidden ones.
 */
export function TaskLabelOverflow({
  labels,
  className,
}: {
  labels: Array<string | TaskLabelRef>;
  className?: string;
}) {
  if (labels.length === 0) return null;
  const names = labels.map((l) => (typeof l === 'string' ? l : l.name));
  return (
    <Tooltip content={<span className="capitalize">{names.join(', ')}</span>}>
      <span
        className={cn(
          'border-border bg-background text-foreground inline-flex items-center rounded-md border px-1.5 py-px text-[10px] font-medium',
          className,
        )}
      >
        +{labels.length}
      </span>
    </Tooltip>
  );
}
