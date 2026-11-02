import { describe, expect, it } from 'vitest';

import { fitView } from './fit-view';

describe('fitView', () => {
  it('never enlarges a page that is smaller than its room', () => {
    expect(
      fitView({ w: 800, h: 600 }, { width: 2000, height: 1500 }),
    ).toMatchObject({ width: 800, height: 600, scale: 1 });
  });

  it('keeps the size of a page that fits exactly', () => {
    expect(fitView({ w: 800, h: 600 }, { width: 800, height: 600 })).toEqual({
      width: 800,
      height: 600,
      left: 0,
      top: 0,
      scale: 1,
    });
  });

  it('scales a wide page down to the width of the room', () => {
    expect(
      fitView({ w: 1920, h: 1080 }, { width: 960, height: 900 }),
    ).toMatchObject({ width: 960, height: 540, scale: 0.5 });
  });

  it('scales a tall room down to the height of the room', () => {
    expect(
      fitView({ w: 1920, h: 1080 }, { width: 1920, height: 270 }),
    ).toMatchObject({ width: 480, height: 270, scale: 0.25 });
  });

  it('keeps the proportions of the page', () => {
    const placement = fitView({ w: 1366, h: 768 }, { width: 700, height: 500 });
    expect(placement).not.toBeNull();
    expect(placement!.width / placement!.height).toBeCloseTo(1366 / 768, 1);
  });

  it('centres the picture in the room it does not fill', () => {
    expect(
      fitView({ w: 1000, h: 500 }, { width: 600, height: 600 }),
    ).toMatchObject({ width: 600, height: 300, left: 0, top: 150 });
    expect(
      fitView({ w: 400, h: 400 }, { width: 1001, height: 700 }),
    ).toMatchObject({ width: 400, height: 400, left: 300, top: 150 });
  });

  it('cuts the size down to whole pixels', () => {
    // 1366 x 768 at a scale of 0.7 is 956.2 x 537.6.
    expect(
      fitView({ w: 1366, h: 768 }, { width: 956.2, height: 900 }),
    ).toMatchObject({ width: 956, height: 537 });
  });

  it('puts the picture at whole pixels', () => {
    const placement = fitView({ w: 100, h: 100 }, { width: 301, height: 201 });
    expect(placement).toMatchObject({ left: 100, top: 50 });
  });

  it('draws at least one pixel in a room of a few pixels', () => {
    expect(
      fitView({ w: 1920, h: 1080 }, { width: 1, height: 1 }),
    ).toMatchObject({ width: 1, height: 1 });
  });

  it('has nothing to draw without room or without a page size', () => {
    expect(fitView({ w: 800, h: 600 }, { width: 0, height: 500 })).toBeNull();
    expect(fitView({ w: 800, h: 600 }, { width: 500, height: 0 })).toBeNull();
    expect(fitView({ w: 0, h: 600 }, { width: 500, height: 500 })).toBeNull();
    expect(fitView({ w: 800, h: 0 }, { width: 500, height: 500 })).toBeNull();
    expect(
      fitView({ w: Number.NaN, h: 600 }, { width: 500, height: 500 }),
    ).toBeNull();
    expect(
      fitView(
        { w: 800, h: 600 },
        { width: Number.POSITIVE_INFINITY, height: 5 },
      ),
    ).toBeNull();
  });
});
