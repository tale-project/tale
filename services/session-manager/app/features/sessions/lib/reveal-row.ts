/** A padding or margin as the computed style has it ("10px"), in pixels; none when it is not a length. */
function edge(value: string): number {
  return Number.parseFloat(value) || 0;
}

/**
 * Scrolls a list's own scroller by the least that brings one of its rows into
 * view, as `row.scrollIntoView({ block: 'nearest' })` does, without calling it:
 * that also makes the row the place the Tab key goes on from, so the first Tab
 * of a page lands on the row's own buttons ("Start …") and skips the skip link,
 * the rail and the head of the list that come before it. The platform's docs
 * rail met the same and scrolls its container the same way
 * (`packages/ui/src/components/docs/docs-nav-rail.tsx`).
 *
 * The padding of the scroller is room round its rows, not view: a row brought
 * in from below ends with that room under it, and the first row brings the
 * room above it along.
 */
export function revealRow(scroller: HTMLElement, row: HTMLElement): void {
  const style = getComputedStyle(scroller);
  const view = scroller.getBoundingClientRect();
  const top = view.top + edge(style.paddingTop);
  const bottom = view.bottom - edge(style.paddingBottom);
  const box = row.getBoundingClientRect();
  if (box.bottom > bottom) scroller.scrollTop += box.bottom - bottom;
  else if (box.top < top) scroller.scrollTop -= top - box.top;
}
