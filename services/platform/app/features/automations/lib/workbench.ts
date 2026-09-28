/**
 * The editor's canvas + inspector row is the Editor tab's whole content, so it
 * fills the height the header and tab strip leave (`flex-1` in the page's
 * flex column) instead of computing a cap from the viewport.
 *
 * `grid-rows-[minmax(0,1fr)]` + `overflow-hidden` keep the inspector's content
 * from growing the canvas when a node is selected — extra inspector fields
 * scroll inside the panel — and the `24rem` floor lets a short window scroll
 * the page rather than crush the graph. The canvas fills this row at every
 * width, selected node or not: below `lg` there is no side panel to stack
 * against, so a picked node opens a sheet over the canvas instead (see
 * `AUTOMATION_WORKBENCH_COMPACT_QUERY`) rather than pushing the canvas up
 * and scrolling the page.
 *
 * No gap: the Editor tab is edge to edge, so the canvas meets the inspector
 * panel at its border instead of at a gutter.
 */
export const AUTOMATION_EDITOR_WORKBENCH_GRID =
  'grid min-h-[24rem] flex-1 lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden';

/**
 * A run's canvas + inspector row sits above the run's effects, agent log and
 * input/output, so that page scrolls; the row is capped to the viewport
 * remainder (title row + tab strip + the run's heading row ≈ 15rem), not
 * `min-h` of it: a min-height-only grid grows with the inspector's content,
 * which would stretch the canvas when a node is selected.
 */
export const AUTOMATION_RUN_WORKBENCH_GRID =
  'grid min-h-[24rem] gap-4 lg:h-[max(24rem,calc(100dvh-15rem))] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden';

/**
 * The inspector's column, added to either workbench while a node is picked.
 * With nothing picked there is no inspector and the canvas takes the width.
 */
export const AUTOMATION_WORKBENCH_INSPECTOR_COLUMNS =
  'lg:grid-cols-[minmax(0,1fr)_22rem]';

/**
 * The same `lg` breakpoint as `AUTOMATION_WORKBENCH_INSPECTOR_COLUMNS`, as a
 * media query: whether there is NO side panel to put a picked node's fields
 * in, so the Editor tab opens them in a sheet over the canvas instead (a
 * `ResponsiveDialog`'s own `md` split then decides drawer vs. centered dialog
 * within that). CSS alone can't gate the sheet's mount — Radix still portals
 * its overlay at the wrong width otherwise — so this is read in JS.
 *
 * Phrased as the COMPACT condition (`useMediaQuery` reads `false` before the
 * client can answer) so the un-hydrated default is "there is a side panel" —
 * the same desktop-first default `useIsMobile` documents — rather than
 * flashing a sheet shut behind the panel on first paint.
 */
export const AUTOMATION_WORKBENCH_COMPACT_QUERY = '(width < 64rem)';

/** The canvas column fills the workbench cell and never grows with the inspector.
 * `relative` hosts canvas chrome (last-run controls) as overlays so they
 * cannot steal the row's height. */
export const AUTOMATION_WORKBENCH_CANVAS_SLOT =
  'relative flex h-full min-h-0 flex-col overflow-hidden';
