import { describe, expect, test } from 'bun:test';

import { rect, sample } from '../test-fixtures';
import type { GeometrySample } from '../types';
import { classifyEasing, progressAt } from './easing';
import type { Interval } from './transitions';

// Build a move interval whose top-left page x follows `xs` over evenly-spaced
// frames (16ms apart), so progress at the quarter marks equals xs[1]/xs[2]'s
// fraction of the total. y is held constant, so motion is purely horizontal.
function moveInterval(xs: readonly number[]): Interval {
  const samples: GeometrySample[] = xs.map((x, f) =>
    sample({ t: f * 16, frame: f, screen: rect(0, x + 20, 10, x) }),
  );
  return {
    samples,
    hadMove: true,
    hadResize: false,
    hadFade: false,
    hadColor: false,
  };
}

// A fade interval whose opacity follows `os` over evenly-spaced frames.
function fadeInterval(os: readonly number[]): Interval {
  const samples: GeometrySample[] = os.map((o, f) =>
    sample({ t: f * 16, frame: f, screen: rect(0, 20, 10, 0), opacity: o }),
  );
  return {
    samples,
    hadMove: false,
    hadResize: false,
    hadFade: true,
    hadColor: false,
  };
}

// A resize interval whose box size (width + height) follows `sizes` over
// evenly-spaced frames (16ms apart). The box stays a top-left-anchored square:
// rect(top=0, right=s/2, bottom=s/2, left=0) → width=s/2, height=s/2, so
// width+height = s. There is no translation (only the right/bottom edges move),
// so this is a pure resize: hadMove stays false, hadResize true. Progress at the
// quarter marks therefore equals sizes' fraction of the total, exactly as the
// move fixtures encode displacement.
function resizeInterval(sizes: readonly number[]): Interval {
  const samples: GeometrySample[] = sizes.map((s, f) =>
    sample({ t: f * 16, frame: f, screen: rect(0, s / 2, s / 2, 0) }),
  );
  return {
    samples,
    hadMove: false,
    hadResize: true,
    hadFade: false,
    hadColor: false,
  };
}

describe('classifyEasing — move curves', () => {
  test('constant speed is linear', () => {
    expect(classifyEasing(moveInterval([0, 25, 50, 75, 100]), 1)).toBe(
      'linear',
    );
  });

  test('slow start then rush is ease-in (accelerate)', () => {
    // Behind the diagonal throughout: 5% done at 1/4, 60% at 3/4.
    expect(classifyEasing(moveInterval([0, 5, 25, 60, 100]), 1)).toBe(
      'ease-in',
    );
  });

  test('fast start then crawl is ease-out (decelerate)', () => {
    // Ahead of the diagonal throughout: 45% done at 1/4, 92% at 3/4.
    expect(classifyEasing(moveInterval([0, 45, 75, 92, 100]), 1)).toBe(
      'ease-out',
    );
  });

  test('slow-fast-slow is ease-in-out (S-curve)', () => {
    // Behind at 1/4 (10%), ahead at 3/4 (90%).
    expect(classifyEasing(moveInterval([0, 10, 50, 90, 100]), 1)).toBe(
      'ease-in-out',
    );
  });

  test('a symmetric ease-in-out at the tolerance boundary is the S, not a one-sided ease', () => {
    // Regression: a symmetric ease-in-out traces ~0.12 either side of the
    // diagonal — right at the linear tolerance — so sampling noise can tip ONE
    // probe under tolerance. The curve must still read as the S (behind→ahead),
    // never flip-flopping to a one-sided ease-out / ease-in by which probe slips.
    // p25=0.17 (only just behind, the would-be "on" side), p75=0.88 (ahead):
    expect(classifyEasing(moveInterval([0, 17, 50, 88, 100]), 1)).toBe(
      'ease-in-out',
    );
    // The mirror — p25=0.12 (behind), p75=0.83 (the would-be "on" side):
    expect(classifyEasing(moveInterval([0, 12, 50, 83, 100]), 1)).toBe(
      'ease-in-out',
    );
  });

  test('a fast-slow-fast curve matches no standard easing → null', () => {
    // Ahead at 1/4 (45%), behind at 3/4 (55%).
    expect(classifyEasing(moveInterval([0, 45, 50, 55, 100]), 1)).toBeNull();
  });

  test('an overshoot past the endpoint matches no standard easing → null (regression)', () => {
    // The box overshoots its net end (120 vs 100) then settles — progress exceeds
    // 1, so the motion is non-monotonic and not a directional ease.
    expect(classifyEasing(moveInterval([0, 30, 80, 120, 100]), 1)).toBeNull();
  });

  test('an anticipate before the start matches no standard easing → null (regression)', () => {
    // The box first pulls backward (−20) before moving forward — progress dips
    // below 0, non-monotonic, no standard ease.
    expect(classifyEasing(moveInterval([0, -20, 30, 80, 100]), 1)).toBeNull();
  });
});

describe('classifyEasing — indeterminate cases', () => {
  test('too few frames to have a shape → null', () => {
    expect(classifyEasing(moveInterval([0, 50, 100]), 1)).toBeNull();
  });

  test('no net movement (out and back) → null', () => {
    expect(classifyEasing(moveInterval([0, 50, 80, 40, 0]), 1)).toBeNull();
  });

  test('net change below threshold → null', () => {
    expect(classifyEasing(moveInterval([0, 0.2, 0.4, 0.6, 0.8]), 1)).toBeNull();
  });

  test('a pure colour change has no curve → null', () => {
    const samples: GeometrySample[] = [0, 1, 2, 3].map((f) =>
      sample({ t: f * 16, frame: f, screen: rect(0, 20, 10, 0), colorKey: f }),
    );
    const interval: Interval = {
      samples,
      hadMove: false,
      hadResize: false,
      hadFade: false,
      hadColor: true,
    };
    expect(classifyEasing(interval, 1)).toBeNull();
  });
});

describe('classifyEasing — other scalars', () => {
  test('classifies a fade by its opacity curve', () => {
    // Opacity accelerates from rest: behind the diagonal throughout → ease-in.
    expect(classifyEasing(fadeInterval([0, 0.05, 0.25, 0.6, 1]), 1)).toBe(
      'ease-in',
    );
  });

  test('a composite (move + resize) follows the move component', () => {
    const interval = moveInterval([0, 45, 75, 92, 100]);
    expect(classifyEasing({ ...interval, hadResize: true }, 1)).toBe(
      'ease-out',
    );
  });
});

describe('classifyEasing — resize curves (sizeSeries branch)', () => {
  test('a fast-then-crawl grow is ease-out (decelerate)', () => {
    // Sizes 10→110 (span 100); ahead of the diagonal throughout:
    // 55% of the span done at 1/4, 92% at 3/4 → coasting to a stop.
    expect(classifyEasing(resizeInterval([10, 55, 85, 102, 110]), 1)).toBe(
      'ease-out',
    );
  });

  test('a slow-then-rush grow is ease-in (accelerate)', () => {
    // Sizes 10→110 (span 100); behind the diagonal throughout:
    // 5% done at 1/4, 60% at 3/4 → still accelerating.
    expect(classifyEasing(resizeInterval([10, 15, 35, 70, 110]), 1)).toBe(
      'ease-in',
    );
  });

  test('a constant-rate grow is linear', () => {
    expect(classifyEasing(resizeInterval([10, 35, 60, 85, 110]), 1)).toBe(
      'linear',
    );
  });

  test('a resize whose total size barely changes is unlabelled (null)', () => {
    // Net size change (0.8) is below the pixel threshold (1), so normalising it
    // would amplify keyframe noise into a bogus curve — left null.
    expect(
      classifyEasing(resizeInterval([10, 10.2, 10.4, 10.6, 10.8]), 1),
    ).toBeNull();
  });
});

describe('progressAt — target beyond the sampled τ range', () => {
  test('clamps to the final progress when no τ reaches the target', () => {
    // Every τ here sits below the target (0.75), so the scan never finds a
    // bracketing pair and falls through to the trailing-progress clamp,
    // returning the last progress value rather than interpolating.
    const taus = [0, 0.1, 0.2, 0.3] as const;
    const ps = [0, 0.3, 0.6, 0.9] as const;
    expect(progressAt(taus, ps, 0.75)).toBe(0.9);
  });

  test('falls back to 1 when the progress series is empty', () => {
    // No samples at all → the `?? 1` default stands in as full progress.
    expect(progressAt([], [], 0.75)).toBe(1);
  });
});
