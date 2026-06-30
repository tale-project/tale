// Dithering — high-frequency pixel noise in a STATIC, STABLE region. The driver
// samples `pixelNoise` only at keyframes (sparsely, `null` in between), so
// two-plus noisy readings on a still element — not a contiguous run — is the
// signal; a contiguous-run rule would miss live dithering entirely.

import { clamp01 } from '../geometry';
import type { GeometrySample, Rect, Window } from '../types';
import type { Interval } from './transitions';

// Per-pixel noise above this in a static region counts as dithering.
const NOISE_THRESHOLD = 0.05;
// Below this opacity delta the region is "steady" (matches the fade detector).
const OPACITY_EPSILON = 0.01;
// Box edges within this many px count as "not moved" (sub-pixel reflow is fine).
const MOVE_TOLERANCE = 1;

export type DitherCluster = {
  window: Window;
  noiseEnergy: number;
  frames: number;
  region: Rect;
  severity: number;
};

/**
 * A region only dithers if its DECLARED appearance holds across the window: same
 * computed colour, visibility, opacity, and box. Otherwise the screenshot delta
 * IS that change — a colour swap, a flicker, a fade, a move/resize — already
 * reported as its own defect or transition, not a separate dithering defect.
 * This is what the per-frame motion exemption alone misses: with sparse
 * keyframes an element can change BETWEEN two far-apart captures while looking
 * steady at each, so the diff reads as noise on a "static" element.
 */
function isStableRegion(
  samples: readonly GeometrySample[],
  ref: GeometrySample,
): boolean {
  return samples.every(
    (s) =>
      (s.colorKey ?? 0) === (ref.colorKey ?? 0) &&
      s.visible === ref.visible &&
      Math.abs(s.opacity - ref.opacity) <= OPACITY_EPSILON &&
      Math.abs(s.rectScreen.left - ref.rectScreen.left) <= MOVE_TOLERANCE &&
      Math.abs(s.rectScreen.top - ref.rectScreen.top) <= MOVE_TOLERANCE &&
      Math.abs(s.rectScreen.right - ref.rectScreen.right) <= MOVE_TOLERANCE &&
      Math.abs(s.rectScreen.bottom - ref.rectScreen.bottom) <= MOVE_TOLERANCE,
  );
}

/** Flag dithering on an element given its samples and its motion intervals. */
export function detectDithering(
  samples: readonly GeometrySample[],
  intervals: readonly Interval[],
): DitherCluster[] {
  // Frames that belong to a transition are "moving" and exempt from dithering.
  const moving = new Set<number>();
  for (const interval of intervals)
    for (const s of interval.samples) moving.add(s.frame);

  const noisy = samples.filter(
    (s) =>
      !moving.has(s.frame) &&
      s.pixelNoise !== null &&
      s.pixelNoise > NOISE_THRESHOLD,
  );
  if (noisy.length < 2) return [];

  const first = noisy[0];
  const last = noisy[noisy.length - 1];
  if (!first || !last) return [];

  // The region must be stable across the noise window; otherwise the noise is a
  // colour/visibility/opacity/geometry change, not dithering. Crucially, a
  // noisy sample's energy was measured against the PREVIOUS captured frame, so
  // extend the window back to that capture — otherwise a change that finishes
  // between two captures (e.g. a colour transition ending just before the
  // capture) is reflected in the noise but invisible to a same-instant check.
  const firstIdx = samples.indexOf(first);
  let startT = first.t;
  for (let i = firstIdx - 1; i >= 0; i--) {
    const s = samples[i];
    if (s && s.pixelNoise !== null) {
      startT = s.t;
      break;
    }
  }
  const inWindow = samples.filter((s) => s.t >= startT && s.t <= last.t);
  if (!isStableRegion(inWindow, first)) return [];

  const energies = noisy.map((s) => s.pixelNoise ?? 0);
  const noiseEnergy = energies.reduce((a, b) => a + b, 0) / energies.length;
  return [
    {
      window: [first.t, last.t],
      noiseEnergy,
      frames: noisy.length,
      region: first.rectScreen,
      severity: clamp01(noiseEnergy),
    },
  ];
}
