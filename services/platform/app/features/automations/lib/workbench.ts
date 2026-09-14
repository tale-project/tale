/**
 * The editor's canvas + inspector row is the Editor tab's whole content, so it
 * fills the height the header and tab strip leave (`flex-1` in the page's
 * flex column) instead of computing a cap from the viewport.
 *
 * `grid-rows-[minmax(0,1fr)]` + `overflow-hidden` keep the inspector's content
 * from growing the canvas when a node is selected — extra inspector fields
 * scroll inside the panel — and the `24rem` floor lets a short window scroll
 * the page rather than crush the graph. Below `lg` the columns stack at their
 * natural height and the page scrolls.
 */
export const AUTOMATION_EDITOR_WORKBENCH_GRID =
  'grid min-h-[24rem] gap-4 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden';

/**
 * A run's canvas + inspector row sits above the run's effects, agent log and
 * input/output, so that page scrolls; the row is capped to the viewport
 * remainder (title row + tab strip + the run's heading row ≈ 15rem), not
 * `min-h` of it: a min-height-only grid grows with the inspector's content,
 * which would stretch the canvas when a node is selected.
 */
export const AUTOMATION_RUN_WORKBENCH_GRID =
  'grid min-h-[24rem] gap-4 lg:h-[max(24rem,calc(100dvh-15rem))] lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden';

/** The canvas column fills the workbench cell and never grows with the inspector.
 * `relative` hosts canvas chrome (last-run controls) as overlays so they
 * cannot steal the row's height. */
export const AUTOMATION_WORKBENCH_CANVAS_SLOT =
  'relative flex h-full min-h-0 flex-col overflow-hidden';
