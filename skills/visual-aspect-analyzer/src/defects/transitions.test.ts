import { describe, expect, test } from 'bun:test';

import { must, rect, sample } from '../test-fixtures';
import type { GeometrySample } from '../types';
import {
  type Interval,
  intervalKind,
  transitionIntervals,
} from './transitions';

const THRESHOLD = 1;
const box = rect(0, 100, 50, 0);

// A sample with its optional colorKey omitted, to exercise the `?? 0` path.
function withoutColorKey(s: GeometrySample): GeometrySample {
  const copy: GeometrySample = { ...s };
  delete copy.colorKey;
  return copy;
}

describe('transitionIntervals', () => {
  test('a single sample yields no intervals', () => {
    expect(
      transitionIntervals([sample({ t: 0, frame: 0, screen: box })], THRESHOLD),
    ).toEqual([]);
  });

  test('an unchanging element yields no intervals', () => {
    const samples = [0, 1, 2].map((f) =>
      sample({ t: f * 16, frame: f, screen: box }),
    );
    expect(transitionIntervals(samples, THRESHOLD)).toEqual([]);
  });

  test('pure scrolling is not a transition', () => {
    // The box moves in screen space but is fixed in page space — that is a
    // scroll, not motion, and must not open an interval.
    const samples = [0, 1, 2].map((f) =>
      sample({
        t: f * 16,
        frame: f,
        screen: rect(200 - 100 * f, 300, 250 - 100 * f, 0),
        page: rect(200, 300, 250, 0),
      }),
    );
    expect(transitionIntervals(samples, THRESHOLD)).toEqual([]);
  });

  test('a whole-box translation in both spaces is a move', () => {
    const samples = [
      sample({ t: 0, frame: 0, screen: box, page: box }),
      sample({
        t: 16,
        frame: 1,
        screen: rect(0, 120, 50, 20),
        page: rect(0, 120, 50, 20),
      }),
    ];
    const intervals = transitionIntervals(samples, THRESHOLD);
    expect(intervals.length).toBe(1);
    expect(intervals[0]?.hadMove).toBe(true);
    expect(intervals[0]?.hadResize).toBe(false);
    expect(intervalKind(must(intervals[0], 'interval'))).toBe('move');
  });

  test('a size-only change is a resize, never a move', () => {
    const samples = [
      sample({ t: 0, frame: 0, screen: box }),
      sample({ t: 16, frame: 1, screen: rect(0, 160, 50, 0) }),
    ];
    const intervals = transitionIntervals(samples, THRESHOLD);
    expect(intervals[0]?.hadMove).toBe(false);
    expect(intervals[0]?.hadResize).toBe(true);
    expect(intervalKind(must(intervals[0], 'interval'))).toBe('resize');
  });

  test('a slow sub-threshold-per-frame resize accumulates instead of being dropped (round 8 regression)', () => {
    // The height grows ~0.6px/frame: above STEADY (threshold/2 = 0.5) so the size
    // anchor holds, but below threshold (1) so the OLD per-frame delta dropped it
    // ENTIRELY — no interval ever opened, a slow panel-open read as score 100. The
    // cumulative size anchor accumulates the drift, exactly as the motion anchor
    // does for a slow crawl `move`. Bottom edge fixed → one-edge change → resize,
    // never a phantom move.
    const samples = Array.from({ length: 12 }, (_, i) =>
      sample({ t: i * 16, frame: i, screen: rect(0, 100 + i * 0.6, 50, 0) }),
    );
    const intervals = transitionIntervals(samples, THRESHOLD);
    expect(intervals.length).toBe(1);
    expect(intervals[0]?.hadResize).toBe(true);
    expect(intervals[0]?.hadMove).toBe(false);
    expect(intervalKind(must(intervals[0], 'interval'))).toBe('resize');
  });

  test('opposite-direction edges (centre/corner-origin scale, rotation) are a resize, never a move (regression)', () => {
    // gBCR reflects CSS transforms, so a `transform: scale` about a centre
    // origin — or a 2D `rotate` whose axis-aligned bbox grows then shrinks —
    // moves the two edges of each axis in OPPOSITE directions. translation()
    // takes the shared-direction component (`sign(dLeft)===sign(dRight)` else 0),
    // so a symmetric grow has zero translation: it must read as a pure resize,
    // never a phantom move. (Round 6 transform-3d corpus, pinned here durably.)
    const samples = [
      sample({ t: 0, frame: 0, screen: box }),
      // All four edges expand away from the centre: left 0→-20, right 100→120,
      // top 0→-10, bottom 50→60. Each axis's edges diverge → translation 0.
      sample({ t: 16, frame: 1, screen: rect(-10, 120, 60, -20) }),
    ];
    const intervals = transitionIntervals(samples, THRESHOLD);
    expect(intervals[0]?.hadMove).toBe(false);
    expect(intervals[0]?.hadResize).toBe(true);
    expect(intervalKind(must(intervals[0], 'interval'))).toBe('resize');
  });

  test('a slow crawl with lurches stays ONE interval, not split singletons (regression)', () => {
    // 1px/frame crawl (sub-threshold per frame) with two ~60px lurches. The
    // per-frame test alone would split each lurch into its own 2-sample interval,
    // defeating jank's median floor; the cumulative motion anchor keeps the whole
    // stutter in one interval so jank can see both teleports.
    let x = 0;
    const samples: GeometrySample[] = [];
    for (let i = 0; i < 16; i++) {
      if (i > 0) x += i === 5 || i === 11 ? 60 : 1;
      samples.push(
        sample({ t: i * 16, frame: i, screen: rect(0, 20 + x, 10, x) }),
      );
    }
    const intervals = transitionIntervals(samples, THRESHOLD);
    expect(intervals.length).toBe(1);
    expect(intervals[0]?.samples.length).toBeGreaterThan(10);
  });

  test('a pure slow fade (sub-epsilon/frame, no other change) opens a fade interval (regression)', () => {
    // Opacity drifts 0.005/frame on a static box — per-frame is under epsilon, but
    // the accumulated drift from the settled baseline opens a fade interval.
    const samples = [0, 1, 2, 3, 4, 5, 6].map((i) =>
      sample({ t: i * 16, frame: i, screen: box, opacity: 1 - i * 0.005 }),
    );
    const intervals = transitionIntervals(samples, THRESHOLD);
    expect(intervals.length).toBeGreaterThanOrEqual(1);
    expect(intervals.some((iv) => iv.hadFade)).toBe(true);
  });

  test('a slow sub-epsilon-per-frame fade during a resize is detected (regression)', () => {
    // The right edge grows 6px/frame (a resize) while opacity drifts 0.005/frame.
    // Each opacity step is below OPACITY_EPSILON, so the per-frame test never sees
    // the fade — only the whole-interval range does. Without it this is a plain
    // `resize` and the fade is silently dropped.
    const samples = [0, 1, 2, 3, 4, 5, 6].map((i) =>
      sample({
        t: i * 16,
        frame: i,
        screen: rect(0, 100 + i * 6, 50, 0),
        opacity: 1 - i * 0.005,
      }),
    );
    const intervals = transitionIntervals(samples, THRESHOLD);
    expect(intervals.length).toBe(1);
    expect(intervals[0]?.hadResize).toBe(true);
    expect(intervals[0]?.hadFade).toBe(true);
    expect(intervalKind(must(intervals[0], 'interval'))).toBe('composite');
  });

  test('a slow fade split across a still gap is recovered on both move intervals (round 5 composite-11)', () => {
    // Phase A: move (5px/frame) + fade 1→0.992 (range 0.008 < epsilon). A still gap
    // (no move, opacity holds) closes the interval. Phase B: move + fade 0.992→0.984
    // (another 0.008). Each interval's own range is sub-epsilon, but the whole-
    // session range (0.016) is a genuine fade — both move intervals must compose it,
    // not read as plain moves.
    const samples: GeometrySample[] = [];
    let x = 0;
    let f = 0;
    const push = (op: number): void => {
      samples.push(
        sample({
          t: f * 16,
          frame: f,
          screen: rect(x, 100, x + 50, 0),
          opacity: op,
        }),
      );
      f++;
    };
    push(1); // baseline
    for (let i = 0; i < 5; i++) {
      x += 5;
      push(1 - 0.008 * ((i + 1) / 5)); // phase A: move + fade
    }
    for (let i = 0; i < 4; i++) push(1 - 0.008); // still gap (x, opacity hold)
    for (let i = 0; i < 5; i++) {
      x += 5;
      push(1 - 0.008 - 0.008 * ((i + 1) / 5)); // phase B: move + fade
    }
    const intervals = transitionIntervals(samples, THRESHOLD);
    const moves = intervals.filter((iv) => iv.hadMove);
    expect(moves.length).toBeGreaterThanOrEqual(2); // split by the gap
    expect(moves.every((iv) => iv.hadFade)).toBe(true); // both compose the fade
  });

  test('a colour change on a static box is a colour transition', () => {
    const samples = [
      sample({ t: 0, frame: 0, screen: box, colorKey: 0 }),
      sample({ t: 16, frame: 1, screen: box, colorKey: 7 }),
    ];
    const intervals = transitionIntervals(samples, THRESHOLD);
    expect(intervals[0]?.hadColor).toBe(true);
    expect(intervalKind(must(intervals[0], 'interval'))).toBe('color');
  });

  test('an absent colorKey is treated as 0, not a spurious change', () => {
    const samples = [
      withoutColorKey(sample({ t: 0, frame: 0, screen: box })),
      withoutColorKey(sample({ t: 16, frame: 1, screen: box })),
    ];
    expect(transitionIntervals(samples, THRESHOLD)).toEqual([]);
  });
});

describe('intervalKind', () => {
  test('an interval with no change flags falls back to composite', () => {
    // kinds === 0, so none of the named branches fire and the function returns
    // its safety fallback (the unreachable-for-change-intervals last return).
    const flagless: Interval = {
      samples: [],
      hadMove: false,
      hadResize: false,
      hadFade: false,
      hadColor: false,
    };
    expect(intervalKind(flagless)).toBe('composite');
  });

  test('a single-flag interval is still named precisely', () => {
    const fadeOnly: Interval = {
      samples: [],
      hadMove: false,
      hadResize: false,
      hadFade: true,
      hadColor: false,
    };
    expect(intervalKind(fadeOnly)).toBe('fade');
  });
});
