'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * Bordered, rounded container that groups a stack of {@link SectionRow}s — the
 * collapsible "details" surface first designed for the connector panel and
 * now shared by the automation and skill detail panels so every catalog detail
 * view reads identically.
 */
export function SectionRowGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'border-border overflow-hidden rounded-lg border',
        className,
      )}
    >
      {children}
    </div>
  );
}

interface SectionRowProps {
  /** Row label — the section's heading. */
  label: string;
  /** Optional trailing element after the label (typically a count `Badge`). */
  badge?: ReactNode;
  /** Whether the row's content is expanded. */
  expanded: boolean;
  onToggle: () => void;
  /** Suppresses the trailing divider on the last row of a group. */
  isLast?: boolean;
  /** Expanded content — usually wrapped in {@link SectionRowBody}. */
  children?: ReactNode;
}

/**
 * One collapsible row inside a {@link SectionRowGroup}: a full-width toggle
 * (label + optional badge + chevron), its expanded content, and a hairline
 * divider unless it is the last row of the group.
 */
export function SectionRow({
  label,
  badge,
  expanded,
  onToggle,
  isLast,
  children,
}: SectionRowProps) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        // `min-h-12` pins every row to the height of its tallest possible
        // content (a `Badge`, taller than the label's line) — a badge-less row
        // (e.g. the automation panel's "Folder") must not render shorter than
        // its badge-carrying siblings.
        className="flex min-h-12 w-full cursor-pointer items-center gap-2 px-4 py-3"
      >
        <span className="text-foreground text-[13px] leading-tight font-medium tracking-[-0.078px]">
          {label}
        </span>
        {badge && <span className="inline-flex">{badge}</span>}
        <span className="text-muted-foreground ml-auto shrink-0">
          {expanded ? (
            <ChevronDown className="size-4" aria-hidden />
          ) : (
            <ChevronRight className="size-4" aria-hidden />
          )}
        </span>
      </button>
      {expanded && children}
      {!isLast && <div className="bg-border h-px w-full" />}
    </>
  );
}

/**
 * The standard expanded-content shell for a {@link SectionRow}: a muted panel
 * with side borders and consistent padding. Compose any layout inside it.
 */
export function SectionRowBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('border-border bg-muted border-x px-4 py-3', className)}>
      {children}
    </div>
  );
}
