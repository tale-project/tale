// Question 2 — find transitions, then judge their smoothness, and emit both the
// transition timeline and the defects annotating it.
//
// This orchestrator runs each detector on the signal it can see: layout-shift
// from the recording's PerformanceObserver entries, and — per survivor —
// `flicker` (opacity/visibility timeline), `dithering` (sub-rect pixel noise),
// and `jank` (per-frame geometry + frame timing) inside each transition
// interval. Every transition is then linked to the defects within its window.

import { clamp01, height, width } from '../geometry';
import type {
  Defect,
  DefectMetrics,
  ElementTrack,
  Rect,
  Recording,
  Transition,
  Window,
} from '../types';
import { detectDithering } from './dithering';
import { classifyEasing } from './easing';
import { detectFlicker, FLICKER_WINDOW_MS } from './flicker';
import { scoreJank } from './jank';
import { intervalKind, transitionIntervals } from './transitions';

/** A survivor element paired with the identity it carries into the report. */
export type Survivor = {
  track: ElementTrack;
  testid: string | null;
  selector: string;
};

export type DefectAnalysis = { transitions: Transition[]; defects: Defect[] };

// An unattributed (null-source) layout shift is reported at page level only when
// at least this perceptible, to avoid surfacing sub-threshold reflow noise.
const PAGE_SHIFT_MIN = 0.01;

// Jank is SUSTAINED stutter — at least this many discontinuous frames. A single
// jump is a one-off shift, not jank, and one is exactly what the driver's own
// per-keyframe screenshot can inject into a fast compositor animation (a
// proportional jump across the sampling gap is indistinguishable from a real
// teleport). Requiring two keeps genuine jank (which stutters repeatedly).
const MIN_JANK_FRAMES = 2;

// Only REPLACED MEDIA can dither — its bitmap churns independently of CSS. A
// regular element's pixels change only via CSS (a colour/transform/filter/…
// transition), which is reported as a transition, never as dithering. Gating on
// the tag avoids false dithering on every animated property without having to
// enumerate them.
const MEDIA_TAGS = new Set(['CANVAS', 'VIDEO', 'IMG', 'SVG', 'PICTURE']);

/** Whether two time windows touch. */
function overlaps(a: Window, b: Window): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

/** Flatten a rect into prefixed metric fields (metrics are primitive only). */
function rectMetrics(prefix: string, rect: Rect): DefectMetrics {
  return {
    [`${prefix}Top`]: rect.top,
    [`${prefix}Left`]: rect.left,
    [`${prefix}Width`]: width(rect),
    [`${prefix}Height`]: height(rect),
  };
}

/**
 * Score every survivor's transitions and collect all defects. Layout-shift
 * defects come from the recording's entries; flicker, dithering, and jank are
 * derived from each survivor's own timeline. Each transition is then linked to
 * the defects that fall inside its window.
 */
export function analyzeDefects(
  survivors: readonly Survivor[],
  recording: Recording,
): DefectAnalysis {
  const defects: Defect[] = [];
  const transitions: Transition[] = [];
  let nextId = 1;
  const id = (): string => `d${nextId++}`;

  const survivorByKey = new Map(survivors.map((s) => [s.track.key, s]));

  // Layout-shift defects come straight from the platform (CLS is never
  // recomputed). User-initiated (`hadRecentInput`) shifts are skipped.
  // Sub-threshold unattributed shifts are summed per segment (emitted below).
  const unattributedBelowFloor = new Map<
    number,
    { sum: number; count: number; start: number; end: number }
  >();
  for (const entry of recording.layoutShifts) {
    if (entry.hadRecentInput) continue;
    const window: Window = [entry.t, entry.t + recording.frameBudgetMs];
    let attributed = false;
    for (const src of entry.sources) {
      if (src.key === null) continue;
      const survivor = survivorByKey.get(src.key);
      if (!survivor) continue;
      attributed = true;
      defects.push({
        id: id(),
        type: 'layout-shift',
        testid: survivor.testid,
        selector: survivor.selector,
        segment: entry.segment,
        severity: clamp01(entry.value),
        window,
        metrics: {
          score: entry.value,
          hadRecentInput: entry.hadRecentInput,
          ...rectMetrics('prev', src.previousRect),
          ...rectMetrics('cur', src.currentRect),
        },
        detail: `Layout shift of ${entry.value.toFixed(3)} moved the element.`,
      });
    }
    // A real shift the platform could not attribute to an element (null source
    // node — common for text reflow and content insertion). Surface a perceptible
    // one at page level directly; accumulate the sub-threshold ones per segment so
    // a death-by-a-thousand-cuts drift (each below the floor, the sum well above
    // it) is not silently dropped.
    if (!attributed) {
      if (entry.value >= PAGE_SHIFT_MIN) {
        defects.push({
          id: id(),
          type: 'layout-shift',
          testid: null,
          selector: '(page)',
          segment: entry.segment,
          severity: clamp01(entry.value),
          window,
          metrics: { score: entry.value, unattributed: true },
          detail: `Layout shift of ${entry.value.toFixed(3)} (no element attribution).`,
        });
      } else if (entry.value > 0) {
        const acc = unattributedBelowFloor.get(entry.segment);
        if (acc) {
          acc.sum += entry.value;
          acc.count++;
          acc.start = Math.min(acc.start, entry.t);
          acc.end = Math.max(acc.end, window[1]);
        } else {
          unattributedBelowFloor.set(entry.segment, {
            sum: entry.value,
            count: 1,
            start: entry.t,
            end: window[1],
          });
        }
      }
    }
  }

  // One cumulative page-level shift per segment whose sub-threshold unattributed
  // shifts SUM to a perceptible amount — CLS is additive, so many tiny reflows
  // are a real shift even when each is individually below the floor.
  for (const [segment, acc] of unattributedBelowFloor) {
    if (acc.sum < PAGE_SHIFT_MIN) continue;
    defects.push({
      id: id(),
      type: 'layout-shift',
      testid: null,
      selector: '(page)',
      segment,
      severity: clamp01(acc.sum),
      window: [acc.start, acc.end],
      metrics: {
        score: acc.sum,
        unattributed: true,
        cumulative: true,
        shiftCount: acc.count,
      },
      detail: `Cumulative layout shift of ${acc.sum.toFixed(3)} across ${acc.count} small unattributed shifts.`,
    });
  }

  for (const survivor of survivors) {
    const { track, testid, selector } = survivor;
    const segment = track.samples[0]?.segment ?? 0;
    const intervals = transitionIntervals(
      track.samples,
      recording.pixelThreshold,
    );
    const flickers = detectFlicker(track.samples);
    // Uppercase the stored tag: a namespaced inline <svg> records a lowercase
    // 'svg', which would otherwise miss the media gate and never dither.
    const dithers = MEDIA_TAGS.has((track.tag ?? '').toUpperCase())
      ? detectDithering(track.samples, intervals)
      : [];

    // Track this element's defects so a transition can link the ones it spans.
    const elementDefects: Defect[] = [];

    for (const cluster of flickers) {
      const detail =
        `Visibility toggled ${cluster.toggleCount}x within ` +
        `${FLICKER_WINDOW_MS}ms.`;
      const defect: Defect = {
        id: id(),
        type: 'flicker',
        testid,
        selector,
        segment,
        severity: cluster.severity,
        window: cluster.window,
        metrics: {
          toggleCount: cluster.toggleCount,
          frequencyHz: Math.round(cluster.frequencyHz),
          minOpacity: cluster.minOpacity,
          maxOpacity: cluster.maxOpacity,
        },
        detail,
      };
      defects.push(defect);
      elementDefects.push(defect);
    }

    for (const cluster of dithers) {
      const detail =
        `High-frequency pixel noise in a static region over ` +
        `${cluster.frames} frames.`;
      const defect: Defect = {
        id: id(),
        type: 'dithering',
        testid,
        selector,
        segment,
        severity: cluster.severity,
        window: cluster.window,
        metrics: {
          noiseEnergy: Number(cluster.noiseEnergy.toFixed(4)),
          frames: cluster.frames,
          ...rectMetrics('region', cluster.region),
        },
        detail,
      };
      defects.push(defect);
      elementDefects.push(defect);
    }

    for (const interval of intervals) {
      const first = interval.samples[0];
      const last = interval.samples[interval.samples.length - 1];
      if (!first || !last) continue;
      const window: Window = [first.t, last.t];
      // Jank is discontinuous MOTION; a resize is never motion, so it never janks
      // (`scoreJank` reads the top-left corner, which a centre-grow resize — or a
      // scroll over a page-still resizing box — moves, which would otherwise read
      // as a teleport). Only score jank when the interval actually translated.
      const jank = interval.hadMove
        ? scoreJank(interval, recording.frameBudgetMs, recording.pixelThreshold)
        : {
            jankFrames: 0,
            droppedFrames: 0,
            maxJumpPx: 0,
            jankRatio: 0,
            severity: 0,
          };

      let jankDefectId: string | null = null;
      if (jank.jankFrames >= MIN_JANK_FRAMES) {
        const detail =
          `${jank.droppedFrames} dropped frame(s); ` +
          `${jank.maxJumpPx.toFixed(0)}px max jump.`;
        const defect: Defect = {
          id: id(),
          type: 'jank',
          testid,
          selector,
          segment,
          severity: jank.severity,
          window,
          metrics: {
            frames: interval.samples.length,
            droppedFrames: jank.droppedFrames,
            maxJumpPx: Number(jank.maxJumpPx.toFixed(1)),
            jankRatio: Number(jank.jankRatio.toFixed(3)),
            expectedFrameMs: Number(recording.frameBudgetMs.toFixed(1)),
          },
          detail,
        };
        defects.push(defect);
        elementDefects.push(defect);
        jankDefectId = defect.id;
      }

      // Smoothness reflects the worst thing seen in the interval, in priority
      // order: flicker, then shift, then jank, else smooth.
      const flickerHere = elementDefects.find(
        (d) => d.type === 'flicker' && overlaps(d.window, window),
      );
      const shiftHere = defects.find(
        (d) =>
          d.type === 'layout-shift' &&
          d.selector === selector &&
          overlaps(d.window, window),
      );

      let smoothness: Transition['smoothness'] = 'smooth';
      if (flickerHere) smoothness = 'flicker';
      else if (shiftHere) smoothness = 'shift';
      else if (jank.jankFrames >= MIN_JANK_FRAMES) smoothness = 'janky';

      const linked = [jankDefectId, flickerHere?.id, shiftHere?.id].filter(
        (value): value is string => value !== null && value !== undefined,
      );

      transitions.push({
        testid,
        selector,
        segment,
        kind: intervalKind(interval),
        easing: classifyEasing(interval, recording.pixelThreshold),
        window,
        smoothness,
        // Start from a perfect 1, subtract the jank severity, and dock a flat
        // 0.5 when a flicker co-occurs — a flicker halves perceived smoothness
        // even when the motion itself is fine. clamp01 floors a pile-up at 0.
        quality: clamp01(1 - jank.severity - (flickerHere ? 0.5 : 0)),
        metrics: {
          frames: interval.samples.length,
          droppedFrames: jank.droppedFrames,
          maxJumpPx: Number(jank.maxJumpPx.toFixed(1)),
          jankRatio: Number(jank.jankRatio.toFixed(3)),
        },
        defects: linked,
      });
    }
  }

  return { transitions, defects };
}
