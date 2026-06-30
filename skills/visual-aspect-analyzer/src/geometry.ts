// Pure geometry helpers shared by the impact, anchor, and defect engines. Each
// works on plain `Rect`s and numeric series so the higher-level modules never
// reach into a rect by a dynamic key or re-derive these primitives.

import type { Edge, Rect } from './types';
import { ALL_EDGES } from './types';

/**
 * Read one edge of a rect by name. A `switch` (rather than `rect[edge]`) keeps
 * the access typed without an index cast, which the no-`any` rule forbids.
 */
export function edgeOf(rect: Rect, edge: Edge): number {
  switch (edge) {
    case 'top':
      return rect.top;
    case 'right':
      return rect.right;
    case 'bottom':
      return rect.bottom;
    case 'left':
      return rect.left;
  }
}

/**
 * Peak-to-peak spread (max − min) of a series. An empty series has no
 * variation, so it is reported as perfectly constant (0) rather than failing.
 */
export function spread(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let min = values[0] ?? 0;
  let max = values[0] ?? 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min;
}

/**
 * The "constant" test that underpins anchoring: every value stays within
 * `threshold` of every other. `threshold` is the session's `pixelThreshold`.
 */
export function isConstant(
  values: readonly number[],
  threshold: number,
): boolean {
  return spread(values) <= threshold;
}

/**
 * The set of edges whose position holds constant within `threshold` across the
 * given rects — i.e. which edges are anchored in this coordinate space.
 */
export function constantEdges(
  rects: readonly Rect[],
  threshold: number,
): Edge[] {
  return ALL_EDGES.filter((edge) =>
    isConstant(
      rects.map((r) => edgeOf(r, edge)),
      threshold,
    ),
  );
}

/** Whether two rects differ on any edge by more than `threshold`. */
export function rectsDiffer(a: Rect, b: Rect, threshold: number): boolean {
  return ALL_EDGES.some(
    (edge) => Math.abs(edgeOf(a, edge) - edgeOf(b, edge)) > threshold,
  );
}

/**
 * Manhattan distance between the top-left corners of two rects — the per-frame
 * displacement used to measure motion and detect teleport jumps.
 */
export function originDelta(a: Rect, b: Rect): number {
  return Math.abs(a.top - b.top) + Math.abs(a.left - b.left);
}

/** Median of a numeric series (0 for an empty series). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  // Odd count has a single middle element; even count averages the two.
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Clamp `value` into `[lo, hi]`. */
export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** Clamp into the unit range `[0, 1]` (severities, quality scores). */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** Width of a rect (right − left). */
export function width(rect: Rect): number {
  return rect.right - rect.left;
}

/** Height of a rect (bottom − top). */
export function height(rect: Rect): number {
  return rect.bottom - rect.top;
}
