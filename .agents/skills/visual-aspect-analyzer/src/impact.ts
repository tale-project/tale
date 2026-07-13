// Question 1 — does an element have visual impact, and which elements does it
// affect?
//
// Impact is a TEMPORAL property: it counts if it had impact in ANY frame the
// user saw. It can flip from no-impact to impactful mid-session (an image
// loads, text is injected, an occluder is removed) and back — so every signal
// here is evaluated per frame and unioned, never sampled at one instant.

import { rectsDiffer } from './geometry';
import type { ElementTrack, Recording, Window } from './types';

/**
 * Paint impact at a single frame: the element renders pixels the user can
 * actually see. Occlusion is folded in, so a paints-in-isolation element fully
 * covered by an opaque one scores zero here — the same verdict a pixel
 * counterfactual would give, without having to run one.
 */
export function effectivePaint(
  sample: ElementTrack['samples'][number],
): boolean {
  return (
    sample.paints &&
    sample.visible &&
    sample.inViewport &&
    sample.opacity > 0 &&
    !sample.occluded
  );
}

/**
 * Merged runs of frames where the element actually painted — the timeline that
 * shows WHEN impact turned on and off, not just whether it ever did.
 */
export function paintIntervals(track: ElementTrack): Window[] {
  const windows: Window[] = [];
  let start: number | null = null;
  let last = 0;
  for (const sample of track.samples) {
    if (effectivePaint(sample)) {
      // Extend the open run, or open a new one on the first painting frame.
      if (start === null) start = sample.t;
      last = sample.t;
    } else if (start !== null) {
      // First non-painting frame after a run closes it.
      windows.push([start, last]);
      start = null;
    }
  }
  if (start !== null) windows.push([start, last]);
  return windows;
}

/** Paint impact = painted in at least one frame (the temporal union). */
export function hasPaintImpact(track: ElementTrack): boolean {
  return track.samples.some(effectivePaint);
}

/** Result of attributing a candidate's movement to the tracked causes. */
export type AffectedInfo = {
  affectedBy: string[];
  windows: Window[];
};

type AffectedResult = {
  /** key -> attribution, for candidate (non-tracked) elements that moved. */
  affected: Map<string, AffectedInfo>;
  /** Tracked keys that moved another element (so: have layout impact). */
  layoutCauses: Set<string>;
};

/** Report a cause by its testid when tagged, else its internal key. */
function causeLabel(track: ElementTrack): string {
  return track.testid ?? track.key;
}

/** Merge one (affected element, cause, window) attribution into the result. */
function recordAttribution(
  result: AffectedResult,
  affectedKey: string,
  cause: string,
  window: Window,
): void {
  const existing = result.affected.get(affectedKey);
  if (existing) {
    if (!existing.affectedBy.includes(cause)) existing.affectedBy.push(cause);
    existing.windows.push(window);
    return;
  }
  result.affected.set(affectedKey, { affectedBy: [cause], windows: [window] });
}

/**
 * Frames at which an element's page-box moved or its visibility flipped, mapped
 * to the timestamp of that frame. Page coordinates are used so a natural change
 * is detected independently of scrolling.
 */
function changedFrames(
  track: ElementTrack,
  threshold: number,
): Map<number, number> {
  const frames = new Map<number, number>();
  let prev: ElementTrack['samples'][number] | null = null;
  for (const sample of track.samples) {
    if (
      prev !== null &&
      (rectsDiffer(prev.rectPage, sample.rectPage, threshold) ||
        prev.visible !== sample.visible)
    ) {
      frames.set(sample.frame, sample.t);
    }
    prev = sample;
  }
  return frames;
}

/**
 * Frames where the element's ORIGIN translated (top-left was displaced), not
 * merely resized. "Affected by" means *pushed/moved by* another element, so a
 * candidate that only changed size (top-left fixed — it grew) is the likely
 * CAUSE of a shift, never its victim, and must not be attributed as affected.
 */
function movedFrames(
  track: ElementTrack,
  threshold: number,
): Map<number, number> {
  const frames = new Map<number, number>();
  let prev: ElementTrack['samples'][number] | null = null;
  for (const sample of track.samples) {
    if (
      prev !== null &&
      (Math.abs(sample.rectPage.left - prev.rectPage.left) > threshold ||
        Math.abs(sample.rectPage.top - prev.rectPage.top) > threshold)
    ) {
      frames.set(sample.frame, sample.t);
    }
    prev = sample;
  }
  return frames;
}

/**
 * Attribute every candidate element's movement to the tracked elements
 * responsible.
 *
 * Primary signal is observed CO-MOVEMENT: the page runs the experiment for us —
 * when a tracked element changes and a candidate moves in the same frame, the
 * candidate is affected by it. Two confirmations layer on top: `layout-shift`
 * sources that co-occur with a tracked change, and the invisible `display:none`
 * counterfactual (`layoutProbe`) for tracked elements that never changed alone.
 */
export function computeAffected(recording: Recording): AffectedResult {
  const result: AffectedResult = {
    affected: new Map(),
    layoutCauses: new Set(),
  };
  const { pixelThreshold, frameBudgetMs } = recording;

  const tracked = recording.elements.filter((e) => e.kind === 'tracked');
  const candidates = recording.elements.filter((e) => e.kind === 'candidate');

  // Precompute each tracked element's change frames once; reused by every pass.
  const trackedFrames = new Map<string, Map<number, number>>();
  for (const t of tracked)
    trackedFrames.set(t.key, changedFrames(t, pixelThreshold));

  // Pass 1 — co-movement. A candidate that is DISPLACED (translated) in the same
  // frame as a tracked element changes is attributed to it (and proves that
  // tracked element moves others). Using translation, not any rect change, keeps
  // a candidate that merely resized — itself a cause — out of the affected set.
  //
  // Same-frame co-movement is correlational, so it is constrained by HOW layout
  // can actually propagate a displacement, keyed on whether the candidate is in
  // normal flow this frame:
  //   • In-flow (static/relative/sticky): a preceding element's growth shifts it,
  //     so any co-changing tracked element is a plausible cause (normal-flow push).
  //   • Out-of-flow (absolute/fixed): a sibling's in-flow growth CANNOT move it —
  //     only its containing block can. So it is attributed solely to a co-changing
  //     ANCESTOR (the positioned ancestor it is laid out against); a coincidental
  //     same-frame move by an unrelated grower is rejected. (`relative`/`sticky`
  //     stay in flow, so they remain pushable; recordings without the `outOfFlow`
  //     signal — older instruments, synthetic fixtures — treat everything as
  //     in-flow, i.e. unchanged behaviour.)
  for (const candidate of candidates) {
    const outOfFlowAt = new Map<number, boolean>();
    for (const s of candidate.samples)
      outOfFlowAt.set(s.frame, s.outOfFlow === true);
    const ancestors = new Set(candidate.ancestorKeys);
    const candFrames = movedFrames(candidate, pixelThreshold);
    for (const [frame, t] of candFrames) {
      const outOfFlow = outOfFlowAt.get(frame) === true;
      for (const cause of tracked) {
        if (!trackedFrames.get(cause.key)?.has(frame)) continue;
        if (outOfFlow && !ancestors.has(cause.key)) continue;
        // A self-translating element can be double-registered (tracked + a
        // candidate of the same DOM node, hence the same selector); never
        // attribute it as "affected by itself".
        if (cause.selector === candidate.selector) continue;
        recordAttribution(result, candidate.key, causeLabel(cause), [t, t]);
        result.layoutCauses.add(cause.key);
      }
    }
  }

  // Pass 2 — layout-shift sources that co-occur (within a frame budget) with a
  // tracked change. `hadRecentInput` shifts are user-initiated, so skipped.
  for (const entry of recording.layoutShifts) {
    if (entry.hadRecentInput) continue;
    for (const cause of tracked) {
      const frames = trackedFrames.get(cause.key);
      if (!frames) continue;
      const coOccurs = [...frames.values()].some(
        (t) => Math.abs(t - entry.t) <= frameBudgetMs,
      );
      if (!coOccurs) continue;
      for (const src of entry.sources) {
        if (src.key === null || src.key === cause.key) continue;
        const srcCand = candidates.find((c) => c.key === src.key);
        // A layout-shift source (the shifted victim) may be a candidate OR a
        // tracked element — the instrument promotes a shift source to tracked, so
        // a grower whose ONLY victim is promoted would otherwise lose all layout
        // credit. Resolve the victim's selector either way to reject a self-shift.
        const srcSelector =
          srcCand?.selector ?? tracked.find((t) => t.key === src.key)?.selector;
        if (srcSelector === undefined || srcSelector === cause.selector)
          continue;
        // The cause co-occurred with a real shift of ANOTHER element, so it has
        // layout impact whether or not that victim is an `affected` candidate.
        result.layoutCauses.add(cause.key);
        // Only a candidate victim becomes `source:"affected"` + `affectedBy`; a
        // victim promoted to tracked is reported as `matched` carrying its own
        // shift (see impact-detection.md), so record the edge for candidates only.
        if (srcCand) {
          recordAttribution(result, src.key, causeLabel(cause), [
            entry.t,
            entry.t + frameBudgetMs,
          ]);
        }
      }
    }
  }

  // Pass 3 — the invisible counterfactual gives precise attribution for tracked
  // elements that never changed on their own (no free experiment to observe).
  for (const cause of tracked) {
    const probe = cause.layoutProbe;
    if (!probe || !probe.affects) continue;
    result.layoutCauses.add(cause.key);
    const window: Window = [
      cause.samples[0]?.t ?? 0,
      cause.samples[cause.samples.length - 1]?.t ?? 0,
    ];
    for (const movedKey of probe.movedKeys) {
      const moved = candidates.find((c) => c.key === movedKey);
      if (!moved || moved.selector === cause.selector) continue;
      recordAttribution(result, movedKey, causeLabel(cause), window);
    }
  }

  return result;
}

/**
 * A tracked element has layout impact if it moved at least one other element
 * (observed or via its counterfactual).
 */
export function hasLayoutImpact(
  track: ElementTrack,
  layoutCauses: ReadonlySet<string>,
): boolean {
  return layoutCauses.has(track.key) || track.layoutProbe?.affects === true;
}
