// Approximate the motion curve of a transition — linear, ease-in (accelerate),
// ease-out (decelerate), or ease-in-out (the slow-fast-slow S-curve). We trace
// how far the element has progressed at the quarter and three-quarter marks of
// the interval and compare that to the straight diagonal a constant-speed move
// would trace: behind the diagonal means it is still accelerating, ahead means
// it is coasting to a stop. "Approximate" is the operative word — a coarse shape
// label read off a handful of keyframes, not a cubic-bezier fit.

import { height, width } from '../geometry';
import type { Easing, GeometrySample } from '../types';
import type { Interval } from './transitions';

// A curve needs enough samples to have a shape; below this the quarter marks are
// guesswork, so the motion is left unlabelled (null) rather than mislabelled.
// Five (4 moving frames past the anchor) keeps a near-instant move — whose exact
// sample count is sampling-flaky at the 3/4-frame boundary — reliably unlabelled.
const MIN_EASING_FRAMES = 5;

// How far a probe may sit from the diagonal before the move counts as eased
// rather than linear — ~10% of the distance. Comfortably below the ~19–33%
// deviation a real cubic ease traces, comfortably above keyframe-sampling noise.
const DIAGONAL_TOLERANCE = 0.1;

// A side counts toward the slow-fast-slow S only when it clearly deviates this
// far (half the linear tolerance). Detecting the S from the raw *sign* past this
// smaller bar — instead of from the tolerance-clamped Position — keeps a
// symmetric ease-in-out (which traces ~0.12 either side, right at the boundary)
// from being tipped into a one-sided directional label by sampling noise, while
// still not mistaking a one-sided ease (whose other probe merely flickers near
// zero) for an S.
const S_CURVE_MIN = DIAGONAL_TOLERANCE / 2;

// Below this the chosen scalar barely changed over the interval, so normalising
// it would amplify noise into a bogus curve. Opacity is unit-scaled; geometry
// uses the caller's pixel threshold.
const MIN_OPACITY_SPAN = 0.05;

// How far progress may stray past its [0,1] endpoints, or backtrack, before the
// motion is non-monotonic and matches no standard easing keyword.
const MONOTONIC_TOLERANCE = 0.15;

/** Signed distance travelled along the net start→end direction, page coords. */
function moveSeries(samples: readonly GeometrySample[]): number[] {
  const first = samples[0]?.rectPage;
  const last = samples[samples.length - 1]?.rectPage;
  if (!first || !last) return [];
  const dx = last.left - first.left;
  const dy = last.top - first.top;
  const len = Math.hypot(dx, dy);
  if (len === 0) return []; // moved out and back: no net path to trace a curve on
  const ux = dx / len;
  const uy = dy / len;
  return samples.map(
    (s) =>
      (s.rectPage.left - first.left) * ux + (s.rectPage.top - first.top) * uy,
  );
}

/** Box size (width + height) over time, page coords — for a resize. */
function sizeSeries(samples: readonly GeometrySample[]): number[] {
  return samples.map((s) => width(s.rectPage) + height(s.rectPage));
}

/** Linear-interpolate the progress series (sorted ascending by τ) at a τ in [0,1]. */
export function progressAt(
  taus: readonly number[],
  ps: readonly number[],
  target: number,
): number {
  for (let i = 1; i < taus.length; i++) {
    const t0 = taus[i - 1];
    const t1 = taus[i];
    if (t0 === undefined || t1 === undefined) continue;
    if (t1 >= target) {
      const p0 = ps[i - 1] ?? 0;
      const p1 = ps[i] ?? 0;
      const span = t1 - t0;
      if (span <= 0) return p1;
      return p0 + ((p1 - p0) * (target - t0)) / span;
    }
  }
  return ps[ps.length - 1] ?? 1;
}

type Position = 'ahead' | 'behind' | 'on';

/** Where a probe sits relative to the diagonal, within tolerance. */
function positionOf(deviation: number): Position {
  if (deviation > DIAGONAL_TOLERANCE) return 'ahead';
  if (deviation < -DIAGONAL_TOLERANCE) return 'behind';
  return 'on';
}

/**
 * Name the curve from where it sits at the quarter (`p25`) and three-quarter
 * (`p75`) marks: on the diagonal at both → linear; behind then ahead → the
 * slow-fast-slow S; net-behind → accelerating (ease-in); net-ahead →
 * decelerating (ease-out). A fast-slow-fast curve matches no standard easing.
 *
 * The S-curve is detected from the raw deviation *sign* past `S_CURVE_MIN`, not
 * from the tolerance-clamped Position, so a symmetric ease-in-out sitting at the
 * linear tolerance boundary is recognised as the S rather than flip-flopping to
 * a one-sided ease-in/ease-out as sampling noise tips one probe.
 */
function classifyShape(p25: number, p75: number): Easing | null {
  const devEarly = p25 - 0.25;
  const devLate = p75 - 0.75;
  const early = positionOf(devEarly);
  const late = positionOf(devLate);
  if (early === 'on' && late === 'on') return 'linear';
  // Behind early AND ahead late, both sides clearly past the S threshold → S.
  if (devEarly < -S_CURVE_MIN && devLate > S_CURVE_MIN) return 'ease-in-out';
  if (devEarly > S_CURVE_MIN && devLate < -S_CURVE_MIN) return null; // fast-slow-fast
  // No sign change: a one-sided curve, named by whichever side cleared tolerance.
  if (early === 'behind' || late === 'behind') return 'ease-in';
  if (early === 'ahead' || late === 'ahead') return 'ease-out';
  return null;
}

/**
 * Classify a transition interval's motion curve. Picks one scalar to follow —
 * net displacement for a move, box size for a resize, opacity for a fade (motion
 * first for a composite) — normalises it against time, and reads the shape off
 * the quarter marks. Returns `null` when the interval is too short, too still,
 * or a pure colour change (which has no ordinal magnitude to trace).
 */
export function classifyEasing(
  interval: Interval,
  threshold: number,
): Easing | null {
  const { samples } = interval;
  if (samples.length < MIN_EASING_FRAMES) return null;
  const t0 = samples[0]?.t;
  const tN = samples[samples.length - 1]?.t;
  if (t0 === undefined || tN === undefined || tN - t0 <= 0) return null;
  const duration = tN - t0;

  let values: number[];
  let minSpan: number;
  if (interval.hadMove) {
    values = moveSeries(samples);
    minSpan = threshold;
  } else if (interval.hadResize) {
    values = sizeSeries(samples);
    minSpan = threshold;
  } else if (interval.hadFade) {
    values = samples.map((s) => s.opacity);
    minSpan = MIN_OPACITY_SPAN;
  } else {
    return null; // a pure colour change has no magnitude to trace a curve on
  }
  if (values.length !== samples.length) return null;

  const start = values[0] ?? 0;
  const end = values[values.length - 1] ?? 0;
  const total = end - start;
  if (Math.abs(total) < minSpan) return null;

  const taus = samples.map((s) => (s.t - t0) / duration);
  const ps = values.map((v) => (v - start) / total);

  // A standard CSS easing has MONOTONIC progress from 0 to 1. A curve that
  // overshoots an endpoint (anticipate/overshoot beziers like
  // cubic-bezier(.68,-.55,.27,1.55)) or backtracks mid-flight matches no keyword,
  // so it must not be force-fit to a directional ease — null is the honest answer.
  let runningMax = -Infinity;
  let maxBacktrack = 0;
  for (const p of ps) {
    if (p < -MONOTONIC_TOLERANCE || p > 1 + MONOTONIC_TOLERANCE) return null;
    if (runningMax - p > maxBacktrack) maxBacktrack = runningMax - p;
    if (p > runningMax) runningMax = p;
  }
  if (maxBacktrack > MONOTONIC_TOLERANCE) return null;

  return classifyShape(progressAt(taus, ps, 0.25), progressAt(taus, ps, 0.75));
}
