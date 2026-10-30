'use client';

import { cn } from '@tale/ui/cn';
import { Tooltip } from '@tale/ui/tooltip';
import { useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';

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
 * hidden ones. Renders nothing when every label fits, so a card pays for the
 * chip's translation only when it shows one.
 */
export function TaskLabelOverflow({
  labels,
  className,
}: {
  labels: Array<string | TaskLabelRef>;
  className?: string;
}) {
  return labels.length === 0 ? null : (
    <TaskLabelOverflowChip labels={labels} className={className} />
  );
}

/**
 * A button, so the keyboard reaches the tooltip as the pointer does (#4910):
 * its name lists the hidden labels for a screen reader, and the tooltip shows
 * them on focus as on hover, and on a tap.
 */
function TaskLabelOverflowChip({
  labels,
  className,
}: {
  labels: Array<string | TaskLabelRef>;
  className?: string;
}) {
  const { t } = useT('tasks');
  const [open, setOpen] = useState(false);
  // A tap never hovers, so a tap toggles the tooltip itself: whether the
  // press under way is one, and whether the tooltip was open as it began.
  const tap = useRef({ touch: false, wasOpen: false });
  const names = labels
    .map((l) => (typeof l === 'string' ? l : l.name))
    .join(', ');
  return (
    <Tooltip
      content={<span className="capitalize">{names}</span>}
      open={open}
      onOpenChange={setOpen}
    >
      <button
        type="button"
        aria-label={t('labels.overflow', {
          count: labels.length,
          labels: names,
        })}
        onPointerDown={(event) => {
          tap.current = {
            touch: event.pointerType === 'touch',
            wasOpen: open,
          };
        }}
        onClick={(event) => {
          // A press shows the labels, not the task: it stops before the
          // row's open handler.
          event.stopPropagation();
          if (tap.current.touch && !tap.current.wasOpen) {
            // Radix closes a tooltip on a click; this one the tap opens.
            event.preventDefault();
            setOpen(true);
          }
          tap.current = { touch: false, wasOpen: false };
        }}
        className={cn(
          // `relative z-10` lifts it above a card's stretched title, which
          // would otherwise take its hover.
          'border-border bg-background text-foreground focus-visible:ring-ring relative z-10 inline-flex cursor-default items-center rounded-md border px-1.5 py-px text-[10px] font-medium focus-visible:ring-2 focus-visible:outline-none',
          className,
        )}
      >
        +{labels.length}
      </button>
    </Tooltip>
  );
}
