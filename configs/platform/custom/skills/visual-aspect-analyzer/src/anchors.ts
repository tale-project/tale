// Steps 6-7 — what reference frame holds each element's edges constant, plus the
// element's start/end box (both share the primary-segment selection below).
//
// screen  : edge fixed in viewport coords (position: fixed).
// page    : edge fixed in document coords (scrolls with the page).
// ancestor: edge holds a constant offset to a containing element.

import { constantEdges, edgeOf, isConstant } from './geometry';
import type {
  AnchorTarget,
  Edge,
  ElementBounds,
  ElementTrack,
  GeometrySample,
  Rect,
} from './types';
import { ALL_EDGES } from './types';

export type AnchorResult = { anchoredTo: AnchorTarget; anchoredEdges: Edge[] };

/**
 * Samples from the segment the element was seen in most. Anchors are computed
 * per segment, so a multi-segment session stays deterministic instead of mixing
 * coordinate spaces from different pages.
 */
function primarySegmentSamples(track: ElementTrack): readonly GeometrySample[] {
  if (track.samples.length === 0) return track.samples;
  const counts = new Map<number, number>();
  for (const s of track.samples)
    counts.set(s.segment, (counts.get(s.segment) ?? 0) + 1);
  let best = track.samples[0]?.segment ?? 0;
  let bestCount = -1;
  for (const [segment, count] of counts) {
    if (count > bestCount) {
      best = segment;
      bestCount = count;
    }
  }
  return track.samples.filter((s) => s.segment === best);
}

/**
 * The element's box at the first and last sample of its primary segment, in both
 * coordinate spaces. Uses the same segment selection as `computeAnchor`, so the
 * box and the anchor never mix pages. Returns `null` only for a sample-less track
 * (which never reaches the report, as it failed the "seen" filter).
 */
export function elementBounds(track: ElementTrack): ElementBounds | null {
  const samples = primarySegmentSamples(track);
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return null;
  return {
    screen: { start: first.rectScreen, end: last.rectScreen },
    page: { start: first.rectPage, end: last.rectPage },
  };
}

/** Index an ancestor's page-boxes by frame, for offset alignment. */
function frameRects(track: ElementTrack): Map<number, Rect> {
  const map = new Map<number, Rect>();
  for (const s of track.samples) map.set(s.frame, s.rectPage);
  return map;
}

/**
 * Edges whose offset to the ancestor stays constant across the frames the two
 * share. Page coordinates are used so the offset is scroll-invariant (both
 * boxes scroll together), isolating real relative motion.
 */
function offsetAnchoredEdges(
  samples: readonly GeometrySample[],
  ancestor: ElementTrack,
  threshold: number,
): Edge[] {
  const ancestorRects = frameRects(ancestor);
  const offsets = new Map<Edge, number[]>();
  for (const edge of ALL_EDGES) offsets.set(edge, []);
  for (const s of samples) {
    const a = ancestorRects.get(s.frame);
    if (!a) continue;
    for (const edge of ALL_EDGES) {
      offsets.get(edge)?.push(edgeOf(s.rectPage, edge) - edgeOf(a, edge));
    }
  }
  // A constant offset is only EVIDENCE of an anchor when it actually held across
  // ≥2 shared frames. An empty (disjoint sampling windows) or single-frame
  // (one coincidental overlap) series is vacuously "constant" — its spread is
  // trivially 0 — so without this guard a child sharing no real history with its
  // parent would be handed a confident 4-edge ancestor anchor from no evidence.
  // Mirrors screenAnchoredEdges, which likewise requires a real scrolling pair.
  return ALL_EDGES.filter((edge) => {
    const series = offsets.get(edge) ?? [];
    return series.length >= 2 && isConstant(series, threshold);
  });
}

/** Whether every edge in `inner` is also in `outer`. */
function isSubset(inner: readonly Edge[], outer: readonly Edge[]): boolean {
  return inner.every((edge) => outer.includes(edge));
}

/**
 * Edges pinned to the viewport: whenever the page scrolls UNDER the edge (its
 * page value moves between two frames), its screen value holds. Requires at
 * least one such scrolling pair, so a never-scrolled element doesn't vacuously
 * qualify. Unlike a global "constant in screen" test, this catches a sticky
 * element that only pins mid-scroll — in flow its screen edge moves (no page
 * motion there, so those pairs don't count), and while stuck its screen edge
 * holds as the page scrolls under it.
 */
function screenAnchoredEdges(
  samples: readonly GeometrySample[],
  threshold: number,
): Edge[] {
  return ALL_EDGES.filter((edge) => {
    let pinned = 0;
    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1];
      const cur = samples[i];
      if (!prev || !cur) continue;
      const pageMoved =
        Math.abs(edgeOf(cur.rectPage, edge) - edgeOf(prev.rectPage, edge)) >
        threshold;
      if (!pageMoved) continue; // page not scrolling under this edge → uninformative
      const screenMoved =
        Math.abs(edgeOf(cur.rectScreen, edge) - edgeOf(prev.rectScreen, edge)) >
        threshold;
      if (!screenMoved) pinned++;
    }
    // Pinned while the page scrolled under it on ≥1 frame. Only a fixed/sticky
    // element holds its viewport position while the page moves under it in
    // document space; a page-anchored element has no page-moving pairs at all
    // and a displaced/animated one moves in BOTH spaces (never pins), so even a
    // single pinned frame is a reliable signal — and one is enough to stay
    // stable for a sticky element that pins only briefly before scrolling away.
    // (Static elements that pin for one frame via browser scroll-anchoring are
    // excluded upstream: `screenAnchoredEdges` is only consulted for an element
    // that is `fixed`/`sticky` in some sample — see `computeAnchor`.)
    return pinned >= 1;
  });
}

/**
 * Resolve the single reference frame that best explains the element's position.
 * Applies the spec's ordered rules and stops at the first match.
 */
export function computeAnchor(
  track: ElementTrack,
  byKey: ReadonlyMap<string, ElementTrack>,
  threshold: number,
): AnchorResult {
  const samples = primarySegmentSamples(track);
  if (samples.length === 0) return { anchoredTo: null, anchoredEdges: [] };

  const pageEdges = constantEdges(
    samples.map((s) => s.rectPage),
    threshold,
  );

  // 1. Edges pinned to the viewport while the page scrolls under them →
  //    screen-anchored. (Per-edge and scroll-gated, so a vertically-only-scrolled
  //    fixed bar and a sticky element that pins mid-scroll are both caught.) Only
  //    a fixed/sticky element CAN pin; a `static` element that briefly holds its
  //    screen position while the page scrolls is browser scroll-anchoring, not a
  //    real anchor, so it is excluded. Recordings whose samples carry no `canPin`
  //    at all (older instruments, synthetic fixtures) keep the prior behaviour —
  //    the gate only excludes when canPin is sampled and never true.
  const canPinSampled = samples.some((s) => s.canPin !== undefined);
  const canPin = samples.some((s) => s.canPin === true);
  const screenAnchored =
    !canPinSampled || canPin ? screenAnchoredEdges(samples, threshold) : [];
  if (screenAnchored.length > 0) {
    return { anchoredTo: 'screen', anchoredEdges: screenAnchored };
  }

  // 2. Fixed in the document on all four edges → page-anchored.
  if (pageEdges.length === ALL_EDGES.length) {
    return { anchoredTo: 'page', anchoredEdges: [...ALL_EDGES] };
  }

  // 3. Walk up the DOM and keep the HIGHEST ancestor that still preserves the
  //    direct parent's anchored edge set. Ascend while the set is preserved;
  //    stop at the level just before an edge would be lost.
  const chain = track.ancestorKeys;
  const directParent = chain[0] ? byKey.get(chain[0]) : undefined;
  if (directParent) {
    const base = offsetAnchoredEdges(samples, directParent, threshold);
    if (base.length > 0) {
      let best = directParent;
      for (let i = 1; i < chain.length; i++) {
        const ancestorKey = chain[i];
        const ancestor = ancestorKey ? byKey.get(ancestorKey) : undefined;
        if (!ancestor) break;
        if (!isSubset(base, offsetAnchoredEdges(samples, ancestor, threshold)))
          break;
        best = ancestor;
      }
      return { anchoredTo: best.selector, anchoredEdges: base };
    }
  }

  // 4. Nothing holds it constant.
  return { anchoredTo: null, anchoredEdges: [] };
}
