import { describe, expect, test } from 'bun:test';

import {
  clamp,
  clamp01,
  constantEdges,
  edgeOf,
  height,
  isConstant,
  median,
  originDelta,
  rectsDiffer,
  spread,
  width,
} from './geometry';
import { rect } from './test-fixtures';

describe('edgeOf', () => {
  test('reads each named edge', () => {
    const r = rect(1, 2, 3, 4);
    expect(edgeOf(r, 'top')).toBe(1);
    expect(edgeOf(r, 'right')).toBe(2);
    expect(edgeOf(r, 'bottom')).toBe(3);
    expect(edgeOf(r, 'left')).toBe(4);
  });
});

describe('spread', () => {
  test('is the max minus min', () => {
    expect(spread([3, 1, 9, 4])).toBe(8);
  });
  test('treats an empty series as constant (0)', () => {
    expect(spread([])).toBe(0);
  });
  test('is 0 for a single value', () => {
    expect(spread([7])).toBe(0);
  });
});

describe('isConstant', () => {
  test('true within threshold, false beyond it', () => {
    expect(isConstant([10, 10.5, 11], 1)).toBe(true);
    expect(isConstant([10, 12], 1)).toBe(false);
  });
  test('uses an inclusive bound', () => {
    expect(isConstant([10, 11], 1)).toBe(true);
  });
});

describe('constantEdges', () => {
  test('reports only the edges that hold still', () => {
    const rects = [rect(0, 100, 50, 0), rect(0, 100, 80, 0)];
    expect([...constantEdges(rects, 1)].sort()).toEqual([
      'left',
      'right',
      'top',
    ]);
  });
  test('all edges constant when nothing moves', () => {
    const rects = [rect(0, 10, 10, 0), rect(0, 10, 10, 0)];
    expect(constantEdges(rects, 1).length).toBe(4);
  });
});

describe('rectsDiffer', () => {
  test('false within threshold on every edge', () => {
    expect(rectsDiffer(rect(0, 10, 10, 0), rect(1, 11, 11, 1), 1)).toBe(false);
  });
  test('true when any edge exceeds threshold', () => {
    expect(rectsDiffer(rect(0, 10, 10, 0), rect(0, 10, 30, 0), 1)).toBe(true);
  });
});

describe('originDelta', () => {
  test('is the Manhattan distance of the top-left corners', () => {
    expect(originDelta(rect(0, 10, 10, 0), rect(3, 14, 14, 4))).toBe(7);
  });
});

describe('median', () => {
  test('middle of an odd-length series', () => {
    expect(median([5, 1, 3])).toBe(3);
  });
  test('average of the two middles for even length', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  test('0 for an empty series', () => {
    expect(median([])).toBe(0);
  });
});

describe('clamp', () => {
  test('passes a value already inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  test('pins to the nearest bound when outside', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });
  test('inverted bounds collapse to the lower argument', () => {
    // clamp does not guard lo <= hi; every caller passes ordered bounds, so this
    // documents the degenerate behaviour rather than endorsing it.
    expect(clamp(5, 10, 0)).toBe(10);
  });
});

describe('clamp01', () => {
  test('keeps a value within the unit range', () => {
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
  });
});

describe('width and height', () => {
  test('are right−left and bottom−top', () => {
    expect(width(rect(0, 100, 50, 20))).toBe(80);
    expect(height(rect(10, 100, 60, 0))).toBe(50);
  });
  test('go negative for an inverted rect', () => {
    expect(width(rect(0, 0, 10, 10))).toBe(-10);
  });
});
