import { describe, expect, it } from 'vitest';

import {
  clickCount,
  historyAction,
  mouseButtonName,
  pagePoint,
} from './pointer';

const view = { w: 1920, h: 1080 };

describe('pagePoint', () => {
  it('maps a position in the picture to the pixels of the page', () => {
    // The picture is shown at half size, 100 px from the left, 50 from the top.
    const rect = { left: 100, top: 50, width: 960, height: 540 };
    expect(pagePoint({ clientX: 100, clientY: 50 }, rect, view)).toEqual({
      x: 0,
      y: 0,
    });
    expect(pagePoint({ clientX: 580, clientY: 320 }, rect, view)).toEqual({
      x: 960,
      y: 540,
    });
    expect(pagePoint({ clientX: 1060, clientY: 590 }, rect, view)).toEqual({
      x: 1920,
      y: 1080,
    });
  });

  it('takes the position as it is when the picture is shown in full size', () => {
    const rect = { left: 10, top: 20, width: 1920, height: 1080 };
    expect(pagePoint({ clientX: 110, clientY: 220 }, rect, view)).toEqual({
      x: 100,
      y: 200,
    });
  });

  it('rounds to a tenth of a pixel', () => {
    const rect = { left: 0, top: 0, width: 1000, height: 1000 };
    // 333 / 1000 * 1920 = 639.36
    expect(
      pagePoint({ clientX: 333, clientY: 1 }, rect, { w: 1920, h: 1080 }),
    ).toEqual({ x: 639.4, y: 1.1 });
  });

  it('keeps a position outside the picture outside, for a drag that leaves it', () => {
    const rect = { left: 100, top: 100, width: 960, height: 540 };
    expect(pagePoint({ clientX: 50, clientY: 700 }, rect, view)).toEqual({
      x: -100,
      y: 1200,
    });
  });

  it('answers the origin while the picture has no size yet', () => {
    expect(
      pagePoint(
        { clientX: 500, clientY: 500 },
        { left: 0, top: 0, width: 0, height: 0 },
        view,
      ),
    ).toEqual({ x: 0, y: 0 });
  });
});

describe('mouseButtonName', () => {
  it('names the three buttons of the page', () => {
    expect(mouseButtonName(0)).toBe('left');
    expect(mouseButtonName(1)).toBe('middle');
    expect(mouseButtonName(2)).toBe('right');
  });

  it('has no name for the side buttons or for what is no button', () => {
    expect(mouseButtonName(3)).toBeNull();
    expect(mouseButtonName(4)).toBeNull();
    expect(mouseButtonName(-1)).toBeNull();
    expect(mouseButtonName(Number.NaN)).toBeNull();
  });
});

describe('clickCount', () => {
  it('counts a click as one and a double click as two', () => {
    expect(clickCount(1)).toBe(1);
    expect(clickCount(2)).toBe(2);
    expect(clickCount(3)).toBe(3);
  });

  it('counts three at most', () => {
    expect(clickCount(4)).toBe(3);
    expect(clickCount(9)).toBe(3);
  });

  it('counts a press that no click made as one', () => {
    expect(clickCount(0)).toBe(1);
    expect(clickCount(Number.NaN)).toBe(1);
    expect(clickCount(-2)).toBe(1);
  });
});

describe('historyAction', () => {
  it('turns the side buttons into back and forward', () => {
    expect(historyAction(3)).toBe('back');
    expect(historyAction(4)).toBe('forward');
  });

  it('leaves the other buttons to the page', () => {
    expect(historyAction(0)).toBeNull();
    expect(historyAction(1)).toBeNull();
    expect(historyAction(2)).toBeNull();
  });
});
