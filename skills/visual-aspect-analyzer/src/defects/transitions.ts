// Transition intervals — the spans where a survivor's box or opacity is
// actually changing. Real motion is a whole-box TRANSLATION (so scrolling and
// pure resizes are not mistaken for it); each interval found here is later
// scored for smoothness (jank) and named by its kind.

import { height, originDelta, width } from '../geometry';
import type { GeometrySample, Rect, TransitionKind } from '../types';

// Below this opacity delta a change is treated as steady, not a fade.
const OPACITY_EPSILON = 0.01;
// Frame-to-frame opacity change below this re-anchors the fade baseline (opacity
// has settled). Tiny so a genuinely slow fade keeps accumulating drift.
const OPACITY_STEADY = 0.001;

export type Interval = {
  samples: GeometrySample[];
  hadMove: boolean;
  hadResize: boolean;
  hadFade: boolean;
  hadColor: boolean;
};

/** Name a transition by which kinds of change it contained. */
export function intervalKind(interval: Interval): TransitionKind {
  const { hadMove, hadResize, hadFade, hadColor } = interval;
  const kinds = [hadMove, hadResize, hadFade, hadColor].filter(Boolean).length;
  if (kinds > 1) return 'composite';
  if (hadMove) return 'move';
  if (hadResize) return 'resize';
  if (hadFade) return 'fade';
  if (hadColor) return 'color';
  // Unreachable for change-only intervals (kinds >= 1); a safe fallback.
  return 'composite';
}

/**
 * Translation component of a box change: the shift the two opposite edges of an
 * axis share in the SAME direction. A pure size change moves only one edge of a
 * pair (top-left- or bottom-right-anchored grow) or moves them in opposite
 * directions (symmetric grow), so its translation is zero. This is what keeps a
 * width/height change alone out of the motion detector — it is reported as a
 * `resized`, never as motion. Measuring per axis still lets a purely horizontal
 * or vertical move through.
 */
function translation(a: Rect, b: Rect, threshold: number): boolean {
  const sameX = Math.sign(b.left - a.left) === Math.sign(b.right - a.right);
  const sameY = Math.sign(b.top - a.top) === Math.sign(b.bottom - a.bottom);
  const dx = sameX
    ? Math.min(Math.abs(b.left - a.left), Math.abs(b.right - a.right))
    : 0;
  const dy = sameY
    ? Math.min(Math.abs(b.top - a.top), Math.abs(b.bottom - a.bottom))
    : 0;
  return dx > threshold || dy > threshold;
}

/** Maximal runs of consecutive frames where geometry or opacity is changing. */
export function transitionIntervals(
  samples: readonly GeometrySample[],
  threshold: number,
): Interval[] {
  const intervals: Interval[] = [];
  let current: Interval | null = null;
  const firstScreen = samples[0]?.rectScreen;
  const firstPage = samples[0]?.rectPage;
  if (!firstScreen || !firstPage) return intervals; // <2 samples: nothing changes
  // Motion anchor: the box where it last sat still. A slow crawl drifts
  // sub-threshold PER FRAME yet is real continuous motion (a freeze-then-lurch
  // stutter, an anti-easing slow middle), so the per-frame test alone splits it
  // into singleton intervals — which then defeats jank's median floor and makes
  // the easing classifier label fragments. Instead a frame counts as moving when
  // the box has TRANSLATED past threshold from this anchor (cumulatively). The
  // anchor is re-set whenever the box is momentarily settled in PAGE space, so
  // neither a stale anchor nor scrolling ever accumulates as motion.
  const STEADY = threshold / 2;
  let anchorScreen = firstScreen;
  let anchorPage = firstPage;
  // Size anchor: the box where its SIZE last settled. Mirrors the motion anchor
  // so a slow grow/shrink (sub-threshold per frame) accumulates instead of being
  // dropped frame-by-frame (see `resized` below).
  let anchorSize = firstScreen;
  // Opacity baseline for accumulated-fade detection (see `faded` below).
  let fadeBase = samples[0]?.opacity ?? 1;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    if (!prev || !cur) continue;
    // Is the box still THIS frame? Measured on the page origin, so scrolling and
    // a fixed element (which don't move the box in page space) count as still.
    const stillNow = originDelta(prev.rectPage, cur.rectPage) <= STEADY;
    // Re-anchor at a genuinely-still frame, so a stopped stretch ends the run and
    // a stale anchor never lingers; a continuous crawl never settles, so its
    // anchor holds and the drift below accumulates across the whole motion.
    if (stillNow) {
      anchorScreen = cur.rectScreen;
      anchorPage = cur.rectPage;
    }
    // Real visual motion is a TRANSLATION of the whole box, in BOTH coordinate
    // spaces, measured cumulatively from the settled anchor (so a slow
    // sub-threshold-per-frame crawl still registers) — but only on a frame the
    // box actually moved (`!stillNow`), so trailing still frames never pad a short
    // move past MIN_EASING_FRAMES. Requiring both spaces strips out scrolling;
    // the shared-direction edge shift strips out size changes, so a resize is
    // never a move, and so never jank.
    const moved =
      !stillNow &&
      translation(anchorScreen, cur.rectScreen, threshold) &&
      translation(anchorPage, cur.rectPage, threshold);
    // Resize uses the SAME settled-anchor trick as `moved`: a slow grow/shrink
    // drifts sub-threshold PER FRAME (a panel easing open over ~1s) yet is a real
    // size change in aggregate. The old per-frame delta dropped it entirely (no
    // interval ever opened). Accumulate the size delta from where the box last
    // settled in size, re-anchoring on a size-steady frame so a stopped stretch
    // ends the run. This is a SUPERSET of the per-frame test — a frame whose own
    // delta already clears threshold also clears it from the (≤prev) anchor.
    const sizeDeltaNow =
      Math.abs(width(cur.rectScreen) - width(prev.rectScreen)) +
      Math.abs(height(cur.rectScreen) - height(prev.rectScreen));
    const sizeStillNow = sizeDeltaNow <= STEADY;
    if (sizeStillNow) anchorSize = cur.rectScreen;
    const resized =
      !sizeStillNow &&
      Math.abs(width(cur.rectScreen) - width(anchorSize)) +
        Math.abs(height(cur.rectScreen) - height(anchorSize)) >
        threshold;
    // Detect a fade from a SETTLED baseline, not just frame-to-frame: a slow fade
    // drifts sub-epsilon per frame yet is a real fade in aggregate (a pure 1->0.1
    // over many frames would otherwise open no interval at all). Re-anchor the
    // baseline whenever opacity is momentarily flat, so a settled-at-a-new-level
    // opacity never latches `faded` on.
    const opacityFlat = Math.abs(cur.opacity - prev.opacity) <= OPACITY_STEADY;
    if (opacityFlat) fadeBase = prev.opacity;
    const faded =
      !opacityFlat && Math.abs(cur.opacity - fadeBase) > OPACITY_EPSILON;
    // A change in computed text/background colour (instruments that sample it).
    const coloured = (prev.colorKey ?? 0) !== (cur.colorKey ?? 0);
    if (moved || resized || faded || coloured) {
      // Open a new interval on the first changing frame; `prev` is its anchor.
      if (!current) {
        current = {
          samples: [prev],
          hadMove: false,
          hadResize: false,
          hadFade: false,
          hadColor: false,
        };
        intervals.push(current);
      }
      current.samples.push(cur);
      current.hadMove ||= moved;
      current.hadResize ||= resized;
      current.hadFade ||= faded;
      current.hadColor ||= coloured;
    } else {
      // A steady frame closes the run.
      current = null;
    }
  }
  // A slow-but-large fade drifts sub-epsilon PER FRAME, so the per-frame test
  // above never sets `hadFade` and a real resize+fade is mislabelled a plain
  // `resize`. Recover it from each interval's opacity RANGE: if opacity moved
  // more than one epsilon across the whole interval, it faded. (Opacity is read
  // exactly from computed style — no sampling noise — so a range past epsilon is
  // always a genuine fade, never jitter.) Interval boundaries are unchanged.
  //
  // A continuous slow fade can ALSO be split across a still gap into two intervals
  // that each see only PART of the range (sub-epsilon each) though the whole-
  // session range clears epsilon. So when the element's TOTAL opacity range is a
  // genuine fade, credit every interval that itself drifted (past the steady
  // floor) — each carried a piece of that one fade, not unrelated jitter.
  let globalMin = Infinity;
  let globalMax = -Infinity;
  for (const s of samples) {
    if (s.opacity < globalMin) globalMin = s.opacity;
    if (s.opacity > globalMax) globalMax = s.opacity;
  }
  const globalFade = globalMax - globalMin > OPACITY_EPSILON;
  for (const interval of intervals) {
    if (interval.hadFade) continue;
    let minOpacity = Infinity;
    let maxOpacity = -Infinity;
    for (const s of interval.samples) {
      if (s.opacity < minOpacity) minOpacity = s.opacity;
      if (s.opacity > maxOpacity) maxOpacity = s.opacity;
    }
    const range = maxOpacity - minOpacity;
    if (range > OPACITY_EPSILON || (globalFade && range > OPACITY_STEADY))
      interval.hadFade = true;
  }
  return intervals;
}
