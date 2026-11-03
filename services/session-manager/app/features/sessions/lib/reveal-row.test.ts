import { afterEach, describe, expect, it, vi } from 'vitest';

import { revealRow } from './reveal-row';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

interface Edges {
  top: number;
  bottom: number;
}

function rect({ top, bottom }: Edges): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 100,
    x: 0,
    y: top,
    width: 100,
    height: bottom - top,
    toJSON: () => ({}),
  };
}

/**
 * A scroller 600 px high with one row in it. jsdom lays nothing out, so the
 * boxes are told: `row` is where the row stands on the screen now.
 */
function arrange(
  row: Edges,
  { scrolled = 0, padding = 0 }: { scrolled?: number; padding?: number } = {},
) {
  const scroller = document.createElement('div');
  const item = document.createElement('a');
  scroller.append(item);
  document.body.append(scroller);
  scroller.style.paddingTop = `${padding}px`;
  scroller.style.paddingBottom = `${padding}px`;
  scroller.scrollTop = scrolled;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: Element) {
      return this === scroller ? rect({ top: 100, bottom: 700 }) : rect(row);
    },
  );
  return { scroller, item };
}

describe('revealRow', () => {
  it('leaves a row alone that is in view already', () => {
    const { scroller, item } = arrange(
      { top: 300, bottom: 348 },
      { scrolled: 40 },
    );
    revealRow(scroller, item);
    expect(scroller.scrollTop).toBe(40);
  });

  it('scrolls down by just what hides the end of a row below the view', () => {
    const { scroller, item } = arrange({ top: 760, bottom: 808 });
    revealRow(scroller, item);
    // Its end was 108 px past the end of the scroller.
    expect(scroller.scrollTop).toBe(108);
  });

  it('scrolls up by just what hides the start of a row above the view', () => {
    const { scroller, item } = arrange(
      { top: 60, bottom: 108 },
      { scrolled: 300 },
    );
    revealRow(scroller, item);
    // Its start was 40 px above the start of the scroller.
    expect(scroller.scrollTop).toBe(260);
  });

  it('counts a row that touches the edge as in view', () => {
    const { scroller, item } = arrange({ top: 652, bottom: 700 });
    revealRow(scroller, item);
    expect(scroller.scrollTop).toBe(0);
  });

  // The padding of a scroller is room round its rows, not view: a row brought
  // in from below ends with that room under it, as one scrolled to by hand.
  it('keeps the padding of the scroller clear of the row it brings in', () => {
    const { scroller, item } = arrange(
      { top: 760, bottom: 808 },
      { padding: 10 },
    );
    revealRow(scroller, item);
    expect(scroller.scrollTop).toBe(118);
  });

  it('brings the padding above a row with it when the row is brought in from above', () => {
    const { scroller, item } = arrange(
      { top: 104, bottom: 152 },
      { scrolled: 300, padding: 10 },
    );
    // It is in view, but under the padding that is the first room of the scroller.
    revealRow(scroller, item);
    expect(scroller.scrollTop).toBe(294);
  });

  it('does not scroll the page: only the scroller moves', () => {
    const { scroller, item } = arrange({ top: 760, bottom: 808 });
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    scrollIntoView.mockClear();
    revealRow(scroller, item);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
