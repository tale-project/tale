import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * Shared row vocabulary for the sidebar rail and its satellites. The rail
 * itself is a fixed 52px icon column now, but `UserButton` still renders in
 * both shapes (a 36px tile inside the rail, a full labelled row elsewhere),
 * so the width/fade helpers stay the single source of that geometry.
 */

/**
 * Row width per state: the full inner row (panel minus the 6px insets) ↔ one
 * 36px icon tile.
 */
export function rowWidthStyle(expanded: boolean): CSSProperties {
  return {
    width: expanded ? 'calc(var(--sidebar-width, 14rem) - 0.75rem)' : '2.25rem',
  };
}

/**
 * Width mirrors the panel tween; colors keep the app's 150ms hover timing.
 * One arbitrary `transition` shorthand because the two need different
 * durations.
 */
export const ROW_TRANSITION_CLASS =
  '[transition:width_250ms_var(--ease-out-quint),background-color_150ms,color_150ms,border-color_150ms] motion-reduce:transition-none';

/** Group fade for labels and text-bearing regions. */
export function labelFadeClass(expanded: boolean): string {
  return cn(
    'transition-opacity motion-reduce:transition-none',
    expanded ? 'opacity-100 delay-75 duration-150' : 'opacity-0 duration-100',
  );
}

/** Shortcut chip rendered inside hover tooltips. */
export const TOOLTIP_SHORTCUT_CLASS =
  'text-muted bg-muted-foreground/60 ml-3 rounded-sm px-1 py-0.5 text-xs';
