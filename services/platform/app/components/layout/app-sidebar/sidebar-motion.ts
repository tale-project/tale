import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * Shared motion vocabulary for the unified sidebar. Every transition — the
 * panel width, the per-row widths, the toggle's slide, the label fades — is a
 * CSS transition on the same 250ms `--ease-out-quint` clock, so the whole
 * panel folds as one surface: rows shrink to their 32px icon tile exactly
 * while the panel narrows to the 56px rail, and the toggle rides the moving
 * edge. One engine also means the pieces can never drift apart under load.
 */

/** Panel width — the master timing every other sidebar transition follows. */
export const PANEL_TRANSITION_CLASS =
  '[transition:width_250ms_var(--ease-out-quint)] motion-reduce:transition-none';

/**
 * The toggle's travel between the header's end (expanded) and the leading
 * icon column (collapsed). Same distance, duration, and curve as the panel
 * edge, so the button appears pinned to it.
 */
export const TOGGLE_SLIDE_CLASS =
  '[transition:transform_250ms_var(--ease-out-quint)] motion-reduce:transition-none';

/**
 * Row width per state: the full inner row (panel minus the 8px insets) ↔ one
 * 32px icon tile. Rows animate their own width (instead of relying on the
 * panel clip alone) so hover/active fills, focus rings, and hit areas are
 * exactly tile-sized in the rail state.
 */
export function rowWidthStyle(expanded: boolean): CSSProperties {
  return {
    width: expanded ? 'calc(var(--sidebar-width, 16rem) - 1rem)' : '2rem',
  };
}

/**
 * Width mirrors the panel tween; colors keep the app's 150ms hover timing.
 * One arbitrary `transition` shorthand because the two need different
 * durations.
 */
export const ROW_TRANSITION_CLASS =
  '[transition:width_250ms_var(--ease-out-quint),background-color_150ms,color_150ms,border-color_150ms] motion-reduce:transition-none';

/**
 * Group fade for labels and text-bearing regions: on expand the width leads
 * (75ms delay) so text surfaces into space that already exists; on collapse
 * the text yields first so the clip never crowds a visible label.
 */
export function labelFadeClass(expanded: boolean): string {
  return cn(
    'transition-opacity motion-reduce:transition-none',
    expanded ? 'opacity-100 delay-75 duration-150' : 'opacity-0 duration-100',
  );
}

/** Hover-tile chrome shared by the sidebar's icon-only buttons. */
export const TILE_CLASS =
  'flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none motion-reduce:transition-none';

/** Shortcut chip rendered inside hover tooltips (matches the old rail's). */
export const TOOLTIP_SHORTCUT_CLASS =
  'text-muted bg-muted-foreground/60 ml-3 rounded-sm px-1 py-0.5 text-xs';
