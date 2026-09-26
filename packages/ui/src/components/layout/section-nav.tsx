'use client';

/**
 * The section panel for sections whose navigation is a fixed set of pages —
 * in the platform, Settings and Knowledge. The same frame as the Home panel (full height beside
 * the page, the section's name in an `h-13` header), with icon rows and one
 * highlight that glides to the open page the way the rail's does. A section
 * brings its rows; the frame, the row anatomy and the motion are shared, so
 * every section's panel reads and moves the same.
 */

import { useAccentColor } from '@tale/ui/accent-color';
import { cn } from '@tale/ui/cn';
import { SubPanel, SubPanelHeader } from '@tale/ui/sub-panel';
import { SUB_PANEL_ROW_CLASS } from '@tale/ui/sub-panel-list';
import { useSlidingIndicator } from '@tale/ui/use-sliding-indicator';
import { Link } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export const SECTION_NAV_ROW_CLASS = cn(
  SUB_PANEL_ROW_CLASS,
  'relative z-10 w-full gap-2.5 rounded-lg duration-150',
);

/** Text treatment of a row: the highlight behind it is drawn once, by the
 * panel, so the row itself only changes colour. */
export function sectionNavRowTone(active: boolean): string {
  return active
    ? 'text-foreground font-medium'
    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground';
}

export function SectionNavRow({
  href,
  label,
  icon: Icon,
  active,
  indent = false,
}: {
  href: string;
  label: string;
  icon?: LucideIcon;
  active: boolean;
  /** A sub-page under a disclosure row: aligned under its parent's label. */
  indent?: boolean;
}) {
  const accentColor = useAccentColor();
  return (
    <li>
      <Link
        to={href}
        data-indicator-key={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          SECTION_NAV_ROW_CLASS,
          indent && 'pl-9',
          sectionNavRowTone(active),
        )}
        {...(active && accentColor ? { style: { color: accentColor } } : {})}
      >
        {Icon && <Icon aria-hidden className="size-4 shrink-0" />}
        <span className="truncate">{label}</span>
      </Link>
    </li>
  );
}

export function SectionNavPanel({
  title,
  ariaLabel,
  activeKey,
  layoutVersion,
  children,
}: {
  title: string;
  ariaLabel: string;
  /** The `data-indicator-key` of the row the highlight rests on. */
  activeKey: string | null;
  /** Anything that moves rows without changing the active key (a group
   * opening above it). */
  layoutVersion?: string | number;
  children: ReactNode;
}) {
  const accentColor = useAccentColor();
  const indicator = useSlidingIndicator<HTMLDivElement>(
    activeKey,
    layoutVersion ?? null,
  );
  return (
    <SubPanel as="nav" width="list" ariaLabel={ariaLabel}>
      <SubPanelHeader title={title} />
      <div
        ref={indicator.containerRef}
        className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto px-2.5 pt-2.5 pb-4"
      >
        <span
          aria-hidden
          style={
            accentColor
              ? { ...indicator.style, backgroundColor: `${accentColor}26` }
              : indicator.style
          }
          className={cn(
            'pointer-events-none absolute top-0 left-0 rounded-lg',
            !accentColor && 'bg-muted',
            indicator.animated &&
              '[transition:transform_280ms_var(--ease-out-quint),height_280ms_var(--ease-out-quint),opacity_150ms] motion-reduce:transition-none',
          )}
        />
        {children}
      </div>
    </SubPanel>
  );
}
