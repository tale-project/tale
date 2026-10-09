import { describe, expect, it } from 'vitest';

import { visibleInkRegion } from './geometry';

describe('native action proof geometry', () => {
  it('records only the visible part of a native phone sheet', () => {
    expect(
      visibleInkRegion(
        { x: 0, y: 451, width: 390, height: 697 },
        { width: 390, height: 820 },
        { width: 390, height: 820 },
      ),
    ).toEqual({ left: 0, top: 451, width: 390, height: 369 });
  });

  it('intersects every edge before scaling native coordinates', () => {
    expect(
      visibleInkRegion(
        { x: -10, y: -20, width: 150, height: 240 },
        { width: 100, height: 200 },
        { width: 200, height: 400 },
      ),
    ).toEqual({ left: 0, top: 0, width: 200, height: 400 });
  });

  it('rejects results completely outside the native view', () => {
    expect(() =>
      visibleInkRegion(
        { x: 0, y: 820, width: 390, height: 20 },
        { width: 390, height: 820 },
        { width: 390, height: 820 },
      ),
    ).toThrow('outside the captured viewport');
  });
});
