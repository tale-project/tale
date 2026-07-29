// Jank — discontinuous motion or dropped frames inside a transition interval.
// A frame is janky if it took too long (dropped) or jumped too far (teleport),
// and severity blends how many frames were janky with the worst jump.

import { clamp01, median, originDelta } from '../geometry';
import type { Interval } from './transitions';

// A frame whose delta exceeds this multiple of the frame budget was dropped.
const DROPPED_FRAME_FACTOR = 1.5;
// A jump is a "teleport" if it exceeds this many px-thresholds...
const TELEPORT_PX_FACTOR = 8;
// ...or this multiple of the typical (median) per-frame step.
const TELEPORT_MEDIAN_FACTOR = 3;
// Jank severity blends the janky-frame ratio with the worst jump...
const JANK_RATIO_WEIGHT = 0.7;
const JANK_JUMP_WEIGHT = 0.3;
// ...where a jump of this many px counts as a full-severity contribution.
const JANK_JUMP_NORM_PX = 200;

export type JankScore = {
  jankFrames: number;
  droppedFrames: number;
  maxJumpPx: number;
  jankRatio: number;
  severity: number;
};

/**
 * Score one motion interval. A frame is janky if it dropped (its delta exceeds
 * 1.5x the frame budget) or teleported (it jumped far beyond the typical
 * per-frame step). Severity blends the janky-frame ratio with the worst jump.
 */
export function scoreJank(
  interval: Interval,
  frameBudgetMs: number,
  threshold: number,
): JankScore {
  const jumps: number[] = [];
  const dts: number[] = [];
  for (let i = 1; i < interval.samples.length; i++) {
    const prev = interval.samples[i - 1];
    const cur = interval.samples[i];
    if (!prev || !cur) continue;
    jumps.push(originDelta(prev.rectScreen, cur.rectScreen));
    dts.push(cur.t - prev.t);
  }
  const medianJump = median(jumps);
  const dropBudget = frameBudgetMs * DROPPED_FRAME_FACTOR;
  // A teleport is far above the typical step; the px floor avoids flagging
  // tiny, smooth motion where the median is near zero.
  const teleportFloor = Math.max(
    threshold * TELEPORT_PX_FACTOR,
    medianJump * TELEPORT_MEDIAN_FACTOR,
  );
  let jankFrames = 0;
  let droppedFrames = 0;
  let maxJumpPx = 0;
  for (let i = 0; i < jumps.length; i++) {
    const jump = jumps[i] ?? 0;
    const dt = dts[i] ?? 0;
    if (dt > dropBudget) droppedFrames++;
    // Jank is a VISIBLE discontinuity — a teleport relative to the typical step.
    // A long frame-time alone is NOT counted: the driver's own per-keyframe
    // screenshot stalls the main thread ~20-40ms, which would otherwise read as
    // a dropped frame on every concurrent compositor animation (false jank). A
    // real stutter still shows up here, because the catch-up jump IS a teleport.
    if (jump > teleportFloor) jankFrames++;
    if (jump > maxJumpPx) maxJumpPx = jump;
  }
  const jankRatio = jumps.length === 0 ? 0 : jankFrames / jumps.length;
  const severity = clamp01(
    jankRatio * JANK_RATIO_WEIGHT +
      clamp01(maxJumpPx / JANK_JUMP_NORM_PX) * JANK_JUMP_WEIGHT,
  );
  return { jankFrames, droppedFrames, maxJumpPx, jankRatio, severity };
}
