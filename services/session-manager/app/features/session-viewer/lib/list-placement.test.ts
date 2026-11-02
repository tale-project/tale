import { describe, expect, it } from 'vitest';

import { fitView } from './fit-view';
import { placeList } from './list-placement';

const view = { w: 1000, h: 800 };
const screen = { width: 600, height: 500 };
// The page of 1000 x 800 is shown at half size, 50 px from the left and the
// top of the screen.
const picture = {
  width: 500,
  height: 400,
  left: 50,
  top: 50,
  scale: 0.5,
};

describe('placeList', () => {
  it('opens the list under the select, as wide as the select is shown', () => {
    expect(
      placeList({
        anchor: { x: 200, y: 100, width: 400, height: 40 },
        view,
        picture,
        screen,
        list: { width: 220, height: 100 },
      }),
    ).toEqual({
      // 50 + 200 * 0.5
      left: 150,
      // 50 + (100 + 40) * 0.5 + 2
      top: 122,
      minWidth: 200,
      maxHeight: 320,
    });
  });

  it('never makes the list narrower than a readable minimum', () => {
    expect(
      placeList({
        anchor: { x: 0, y: 0, width: 40, height: 20 },
        view,
        picture,
        screen,
        list: { width: 130, height: 50 },
      }).minWidth,
    ).toBe(120);
  });

  it('keeps the list inside the screen on the right', () => {
    const placed = placeList({
      anchor: { x: 900, y: 100, width: 100, height: 40 },
      view,
      picture,
      screen,
      list: { width: 300, height: 100 },
    });
    // 600 - 300 - 8
    expect(placed.left).toBe(292);
  });

  it('keeps the list inside the screen on the left', () => {
    const placed = placeList({
      anchor: { x: -200, y: 100, width: 100, height: 40 },
      view,
      picture,
      screen,
      list: { width: 100, height: 100 },
    });
    expect(placed.left).toBe(8);
  });

  it('opens the list upwards when there is no room below and more above', () => {
    const placed = placeList({
      anchor: { x: 100, y: 700, width: 200, height: 40 },
      view,
      picture,
      screen,
      list: { width: 200, height: 160 },
    });
    // above = 50 + 700 * 0.5 = 400, minus the list (160) and the gap (2)
    expect(placed.top).toBe(238);
  });

  it('opens the list downwards when there is not room either way', () => {
    const placed = placeList({
      anchor: { x: 100, y: 20, width: 200, height: 40 },
      view,
      picture,
      screen,
      list: { width: 200, height: 460 },
    });
    // below = 50 + 60 * 0.5 + 2
    expect(placed.top).toBe(82);
  });

  it('does not put an upward list above the screen', () => {
    const placed = placeList({
      anchor: { x: 100, y: 700, width: 200, height: 40 },
      view,
      picture,
      screen: { width: 600, height: 420 },
      list: { width: 200, height: 450 },
    });
    expect(placed.top).toBeGreaterThanOrEqual(8);
  });

  it('takes the side that has more room, and scrolls there, when the list fits on neither', () => {
    // The select is in the middle of a short screen: 20 px of room below it,
    // 240 above it, and the list is 320 tall.
    const placed = placeList({
      anchor: { x: 100, y: 400, width: 200, height: 40 },
      view,
      picture,
      screen: { width: 600, height: 300 },
      list: { width: 200, height: 320 },
    });
    expect(placed.maxHeight).toBe(240);
    // It ends 2 px above the select and starts at the edge of the screen.
    expect(placed.top).toBe(8);
  });

  it('shows the whole list on the side where it fits', () => {
    const placed = placeList({
      anchor: { x: 100, y: 700, width: 200, height: 40 },
      view,
      picture,
      screen: { width: 600, height: 440 },
      list: { width: 200, height: 320 },
    });
    // 390 above the select and 10 below it: the list fits above.
    expect(placed).toMatchObject({ top: 78, maxHeight: 320 });
  });

  it('keeps a list of a few pixels of room readable', () => {
    const placed = placeList({
      anchor: { x: 0, y: 380, width: 100, height: 40 },
      view,
      picture: { ...picture, top: 0 },
      screen: { width: 600, height: 300 },
      list: { width: 100, height: 200 },
    });
    expect(placed.maxHeight).toBeGreaterThanOrEqual(96);
  });

  it('follows the picture of a real fit', () => {
    const room = { width: 1000, height: 400 };
    const fitted = fitView({ w: 1920, h: 1080 }, room);
    expect(fitted).not.toBeNull();
    const placed = placeList({
      anchor: { x: 960, y: 0, width: 192, height: 54 },
      view: { w: 1920, h: 1080 },
      picture: fitted!,
      screen: room,
      list: { width: 0, height: 0 },
    });
    // 400 / 1080 of the page is shown: the select is 192 * 0.37 px wide.
    expect(placed.minWidth).toBe(120);
    expect(placed.left).toBe(fitted!.left + 960 * (fitted!.width / 1920));
  });
});
