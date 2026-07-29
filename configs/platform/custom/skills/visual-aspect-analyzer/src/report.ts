// Step 5 onward — filter the scope down to what the user saw and what had
// impact, resolve anchors, score transitions, and assemble the final report.

import { elementLabel } from './accname';
import { computeAnchor, elementBounds } from './anchors';
import { analyzeDefects, type Survivor } from './defects/analyze';
import { computeAffected, hasLayoutImpact, hasPaintImpact } from './impact';
import type { ElementTrack, Recording, Report, ReportElement } from './types';

/** Did the element enter the viewport at any point (step 5.2)? */
function wasSeen(track: ElementTrack): boolean {
  return track.samples.some((s) => s.inViewport);
}

/**
 * Build the report. The `elements` list contains only matched elements and the
 * elements they affected; each one was in scope, was seen in the viewport, and
 * had visual impact. The filter order is scope → seen → impact.
 */
export function buildReport(recording: Recording): Report {
  const byKey = new Map(recording.elements.map((e) => [e.key, e]));
  const { affected, layoutCauses } = computeAffected(recording);
  // A cause that is the affected node's OWN descendant is coincidental co-movement,
  // not causation — a child cannot push its ancestor — so it is filtered out of
  // `affectedBy` (a container that grew with its own children should not cite them
  // as its cause). Keyed by selector: a node's tracked and candidate copies share
  // a selector but not a key, so a descendant's ancestor chain is matched on the
  // node's selector rather than a single key.
  const causedByDescendant = (causeKey: string, ownSelector: string): boolean =>
    (byKey.get(causeKey)?.ancestorKeys ?? []).some(
      (aKey) => byKey.get(aKey)?.selector === ownSelector,
    );

  const elements: ReportElement[] = [];
  const survivors: Survivor[] = [];

  for (const track of recording.elements) {
    const isTracked = track.kind === 'tracked';
    const affectedInfo = affected.get(track.key);

    // Scope: tracked elements, plus candidates a tracked element affected.
    const inScope = isTracked || affectedInfo !== undefined;
    if (!inScope) continue;
    // Seen: never in the viewport means the user never saw it.
    if (!wasSeen(track)) continue;

    // Impact: paints and/or affects layout. An affected candidate moved by
    // definition, so it has layout impact.
    const impactMode: ('paints' | 'layout')[] = [];
    if (hasPaintImpact(track)) impactMode.push('paints');
    const layout = isTracked
      ? hasLayoutImpact(track, layoutCauses)
      : affectedInfo !== undefined;
    if (layout) impactMode.push('layout');
    if (impactMode.length === 0) continue;

    const anchor = computeAnchor(track, byKey, recording.pixelThreshold);
    // Always derivable here: the element passed the "seen" filter, so it has a
    // sample. The guard keeps `bounds` non-optional for the unreachable case.
    const bounds = elementBounds(track);
    if (!bounds) continue;
    // Shared head/tail fields are hoisted; `source` (and an affected element's
    // sorted `affectedBy` causes) stay inline to keep the key order stable.
    const label =
      elementLabel(track.role ?? null, track.name ?? null) ?? track.selector;
    const head = { testid: track.testid, selector: track.selector, label };
    const tail = {
      impactMode,
      anchoredTo: anchor.anchoredTo,
      anchoredEdges: anchor.anchoredEdges,
      bounds,
    };
    const base: ReportElement = isTracked
      ? { ...head, source: 'matched', ...tail }
      : {
          ...head,
          source: 'affected',
          affectedBy: [...(affectedInfo?.affectedBy ?? [])]
            .filter((k) => !causedByDescendant(k, track.selector))
            .sort(),
          ...tail,
        };

    elements.push(base);
    survivors.push({ track, testid: track.testid, selector: track.selector });
  }

  const { transitions, defects } = analyzeDefects(survivors, recording);

  return {
    session: {
      segments: recording.segments,
      pixelThreshold: recording.pixelThreshold,
      frameBudgetMs: recording.frameBudgetMs,
      ...(recording.audit ? { audit: recording.audit } : {}),
    },
    elements,
    transitions,
    defects,
  };
}
