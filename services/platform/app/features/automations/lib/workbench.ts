/**
 * The canvas + inspector row is a viewport-height workbench. Versions and
 * runs stay under it; the page scrolls to them.
 *
 * The row is capped (`lg:h-` + `grid-rows-[minmax(0,1fr)]` + `overflow-hidden`),
 * not `min-h` of the viewport remainder. A min-height-only grid grows with the
 * inspector's content, which stretches the canvas when a node is selected.
 * Extra inspector fields scroll inside the panel. Below `lg` the columns stack
 * and the page scrolls.
 */
export const AUTOMATION_WORKBENCH_GRID =
  'grid min-h-[24rem] gap-4 lg:h-[max(24rem,calc(100dvh-12rem))] lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden';

/** The canvas column fills the workbench cell and never grows with the inspector.
 * `relative` hosts canvas chrome (last-run controls) as overlays so they
 * cannot steal the row's height. */
export const AUTOMATION_WORKBENCH_CANVAS_SLOT =
  'relative flex h-full min-h-0 flex-col overflow-hidden';
