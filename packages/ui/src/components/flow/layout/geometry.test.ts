import { describe, expect, it } from 'vitest';

import {
  boundsOf,
  cleanRoute,
  dropRedundant,
  isAxisAligned,
  joinSections,
  pointAlongRoute,
  rectsOverlap,
  roundedOrthogonalPath,
  sampleRoute,
  segmentCrossesRect,
  trimEnd,
} from './geometry';

describe('joinSections', () => {
  it('follows the sections of an edge in order, the junction once', () => {
    const points = joinSections([
      {
        id: 'b',
        startPoint: { x: 10, y: 50 },
        endPoint: { x: 10, y: 90 },
        incomingSections: ['a'],
      },
      {
        id: 'a',
        startPoint: { x: 0, y: 0 },
        bendPoints: [{ x: 0, y: 50 }],
        endPoint: { x: 10, y: 50 },
        outgoingSections: ['b'],
      },
    ]);
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 10, y: 50 },
      { x: 10, y: 90 },
    ]);
  });

  it('answers nothing for no sections', () => {
    expect(joinSections([])).toEqual([]);
  });
});

describe('cleanRoute', () => {
  it('straightens the hair-thin diagonals ELK answers', () => {
    const route = cleanRoute([
      { x: 100.2499, y: 0 },
      { x: 100.2501, y: 40 },
      { x: 180, y: 40.0001 },
      { x: 180, y: 90 },
    ]);
    expect(isAxisAligned(route)).toBe(true);
    expect(route).toEqual([
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 180, y: 40 },
      { x: 180, y: 90 },
    ]);
  });

  it('keeps the end point where ELK put it', () => {
    const route = cleanRoute([
      { x: 0, y: 0 },
      { x: 0, y: 30 },
      { x: 50.3, y: 30 },
      { x: 50.6, y: 60 },
    ]);
    expect(route.at(-1)).toEqual({ x: 50.5, y: 60 });
    expect(isAxisAligned(route)).toBe(true);
  });

  it('drops repeated and collinear points', () => {
    expect(
      dropRedundant([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 0, y: 20 },
        { x: 5, y: 20 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 20 },
      { x: 5, y: 20 },
    ]);
  });
});

describe('roundedOrthogonalPath', () => {
  it('rounds each corner with the radius it is given', () => {
    expect(
      roundedOrthogonalPath(
        [
          { x: 0, y: 0 },
          { x: 0, y: 40 },
          { x: 40, y: 40 },
        ],
        8,
      ),
    ).toBe('M0 0 L0 32 Q0 40 8 40 L40 40');
  });

  it('never rounds past half of a short segment', () => {
    expect(
      roundedOrthogonalPath(
        [
          { x: 0, y: 0 },
          { x: 0, y: 6 },
          { x: 40, y: 6 },
        ],
        8,
      ),
    ).toBe('M0 0 L0 3 Q0 6 3 6 L40 6');
  });

  it('draws a straight route as one line', () => {
    expect(
      roundedOrthogonalPath(
        [
          { x: 0, y: 0 },
          { x: 0, y: 40 },
        ],
        8,
      ),
    ).toBe('M0 0 L0 40');
  });
});

describe('trimEnd', () => {
  it('shortens the route by the arrow length, across a bend if needed', () => {
    expect(
      trimEnd(
        [
          { x: 0, y: 0 },
          { x: 0, y: 40 },
          { x: 4, y: 40 },
        ],
        8,
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 36 },
    ]);
  });
});

describe('segmentCrossesRect', () => {
  const box = { x: 10, y: 10, width: 20, height: 20 };

  it('sees a segment through a box', () => {
    expect(segmentCrossesRect({ x: 20, y: 0 }, { x: 20, y: 40 }, box)).toBe(
      true,
    );
  });

  it('lets a segment meet a box at its border', () => {
    expect(segmentCrossesRect({ x: 20, y: 0 }, { x: 20, y: 10 }, box)).toBe(
      false,
    );
    expect(segmentCrossesRect({ x: 10, y: 0 }, { x: 10, y: 40 }, box)).toBe(
      false,
    );
  });

  it('lets a segment pass beside a box', () => {
    expect(segmentCrossesRect({ x: 40, y: 0 }, { x: 40, y: 40 }, box)).toBe(
      false,
    );
  });
});

describe('rectangles', () => {
  it('overlap only when they share area', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectsOverlap(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(rectsOverlap(a, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it('bound every rectangle given', () => {
    expect(
      boundsOf([
        { x: 0, y: 5, width: 10, height: 10 },
        { x: -5, y: 0, width: 4, height: 4 },
      ]),
    ).toEqual({ x: -5, y: 0, width: 15, height: 15 });
  });
});

describe('sampleRoute', () => {
  it('walks the route at an even step, both ends included', () => {
    const samples = sampleRoute(
      [
        { x: 0, y: 0 },
        { x: 0, y: 16 },
        { x: 20, y: 16 },
      ],
      8,
    );
    expect(samples.map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [0, 8],
      [0, 16],
      [8, 16],
      [16, 16],
      [20, 16],
    ]);
    expect(samples.map((sample) => sample.offset)).toEqual([
      0,
      8 / 36,
      16 / 36,
      24 / 36,
      32 / 36,
      1,
    ]);
  });

  it('gives a point route its one point', () => {
    expect(sampleRoute([{ x: 3, y: 4 }], 8)).toEqual([
      { x: 3, y: 4, offset: 0 },
    ]);
    expect(sampleRoute([], 8)).toEqual([]);
  });
});

describe('pointAlongRoute', () => {
  it('finds a fraction of the way along a route by its length, bends included', () => {
    const route = [
      { x: 0, y: 0 },
      { x: 0, y: 30 },
      { x: 10, y: 30 },
    ];
    expect(pointAlongRoute(route, 0.5)).toEqual({ x: 0, y: 20 });
    expect(pointAlongRoute(route, 0.75)).toEqual({ x: 0, y: 30 });
    expect(pointAlongRoute(route, 0.9)).toEqual({ x: 6, y: 30 });
    expect(pointAlongRoute(route, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAlongRoute(route, 1)).toEqual({ x: 10, y: 30 });
  });

  it('answers the one point of a route without length, and nothing for none', () => {
    expect(pointAlongRoute([{ x: 4, y: 8 }], 0.5)).toEqual({ x: 4, y: 8 });
    expect(
      pointAlongRoute(
        [
          { x: 4, y: 8 },
          { x: 4, y: 8 },
        ],
        0.5,
      ),
    ).toEqual({ x: 4, y: 8 });
    expect(pointAlongRoute([], 0.5)).toBeNull();
  });
});
