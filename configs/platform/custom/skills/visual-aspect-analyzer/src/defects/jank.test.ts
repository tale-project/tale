import { describe, expect, test } from 'bun:test';

import { rect, sample } from '../test-fixtures';
import type { GeometrySample } from '../types';
import { scoreJank } from './jank';
import type { Interval } from './transitions';

// scoreJank reads only the samples; the kind flags are irrelevant here.
function interval(samples: GeometrySample[]): Interval {
  return {
    samples,
    hadMove: true,
    hadResize: false,
    hadFade: false,
    hadColor: false,
  };
}

// A box whose only motion is along the x-axis (left edge), so originDelta == |Δleft|.
const at = (t: number, frame: number, left: number): GeometrySample =>
  sample({ t, frame, screen: rect(0, left + 100, 50, left) });

const BUDGET = 10; // dropped-frame threshold is 1.5× → 15ms

describe('scoreJank', () => {
  test('a single-sample interval is smooth, with no NaN', () => {
    const s = scoreJank(interval([at(0, 0, 0)]), BUDGET, 1);
    expect(s.severity).toBe(0);
    expect(s.jankFrames).toBe(0);
    expect(s.droppedFrames).toBe(0);
    expect(s.maxJumpPx).toBe(0);
    expect(Number.isNaN(s.severity)).toBe(false);
    expect(Number.isNaN(s.jankRatio)).toBe(false);
  });

  test('steady motion within budget has no janky or dropped frames', () => {
    const s = scoreJank(
      interval([at(0, 0, 0), at(10, 1, 10), at(20, 2, 20)]),
      BUDGET,
      1,
    );
    expect(s.jankFrames).toBe(0);
    expect(s.droppedFrames).toBe(0);
    // Severity carries only a tiny baseline from the (smooth) step magnitude.
    expect(s.severity).toBeLessThan(0.05);
  });

  test('a frame at exactly 1.5× budget is not dropped; just over it is', () => {
    // Same position both frames, so only the frame-time matters.
    const still = (t: number, frame: number) => at(t, frame, 0);
    const boundary = scoreJank(
      interval([still(0, 0), still(15, 1)]),
      BUDGET,
      1,
    );
    expect(boundary.droppedFrames).toBe(0); // 15ms == 1.5× budget, strict >
    const over = scoreJank(interval([still(0, 0), still(16, 1)]), BUDGET, 1);
    expect(over.droppedFrames).toBe(1);
  });

  test('a teleport against a small median step is flagged', () => {
    // Three small 10px steps then a 180px jump: median stays ~10 so the jump
    // clears both the px floor (8) and 3× median (30).
    const s = scoreJank(
      interval([at(0, 0, 0), at(10, 1, 10), at(20, 2, 20), at(30, 3, 200)]),
      BUDGET,
      1,
    );
    expect(s.maxJumpPx).toBe(180);
    expect(s.jankFrames).toBe(1);
    expect(s.droppedFrames).toBe(0);
    expect(s.severity).toBeGreaterThan(0);
  });

  test('a zero threshold on steady samples does not over-flag or divide by zero', () => {
    const s = scoreJank(
      interval([at(0, 0, 0), at(10, 1, 0), at(20, 2, 0)]),
      BUDGET,
      0,
    );
    expect(s.severity).toBe(0);
    expect(s.jankFrames).toBe(0);
  });
});
