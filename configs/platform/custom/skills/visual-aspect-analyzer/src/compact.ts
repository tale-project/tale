// The default, AI-optimized output: a distilled Report that keeps only what a
// consumer needs to reason and act, and nothing that bloats the context window.
// Versus the faithful Report it: rounds all numbers, coalesces repeated defects
// into one issue each, keeps only the decision-relevant `metrics` per defect
// (dropping the raw `id`/`segment` and internal session params), hoists the
// per-type fix `hints` to a single map (instead of repeating one on every
// defect), details the transitions worth seeing — every non-smooth one plus any
// with a known easing curve (with a count of the bare smooth ones left out),
// gives each element its settled box `to` (plus a `from` start box only when it
// moved), and leads with a score. The faithful record — every number, id,
// transition, and both-space start/end box — stays behind the CLI's `--full` flag.

import { width, height, rectsDiffer } from './geometry';
import { ALL_TYPES, coalesceDefects, hintFor, summarize } from './summarize';
import type {
  AnchorTarget,
  AuditMeta,
  DefectMetrics,
  DefectType,
  Easing,
  Edge,
  Rect,
  Report,
  Smoothness,
  TransitionKind,
} from './types';

const ms = (n: number): number => Math.round(n);
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A box as `[left, top, width, height]`, rounded — leaner than a 4-key object. */
function boxTuple(rect: Rect): CompactBox {
  return [ms(rect.left), ms(rect.top), ms(width(rect)), ms(height(rect))];
}

// Keep the report scannable on pathological pages: cap the worst-first defect
// list, and (audit only) the discovered-element list. Omitted counts are always
// surfaced — never a silent truncation. Defect-bearing elements sort first, so
// the cap only ever drops defect-free context.
const MAX_DEFECTS = 30;
const MAX_AUDIT_ELEMENTS = 30;

/** A box as `[left, top, width, height]`, in page (document) coordinates. */
export type CompactBox = readonly [number, number, number, number];

export type CompactElement = {
  selector: string;
  /** Human label — `role "name"` (e.g. `nav "Main"`), else the selector. */
  label: string;
  /** Always present (explicit `null` for untagged/affected-only elements). */
  testid: string | null;
  source: 'matched' | 'affected';
  impact: readonly ('paints' | 'layout')[];
  /** What holds the element in place: `screen`/`page`/an ancestor selector/`null`. */
  anchoredTo: AnchorTarget;
  /** Always present: the edges constant in `anchoredTo`'s frame (`[]` when nothing is anchored). */
  anchoredEdges: readonly Edge[];
  /** The start box; present only when the element moved/resized beyond threshold. */
  from?: CompactBox;
  /** The element's settled (end) box, page coords `[left, top, width, height]`. */
  to: CompactBox;
  affectedBy?: readonly string[];
};

/** The decision-relevant numbers behind a defect, curated per type. */
export type CompactDefectMetrics = {
  value?: number; // layout-shift (CLS)
  toggleCount?: number; // flicker
  frequencyHz?: number; // flicker
  droppedFrames?: number; // jank
  maxJumpPx?: number; // jank
  noiseEnergy?: number; // dithering
};

export type CompactDefect = {
  type: DefectType;
  selector: string;
  /** Human label of the affected element (`role "name"`), else the selector. */
  label: string;
  severity: number;
  /** Occurrences folded into this issue; absent means a single occurrence. */
  count?: number;
  window: readonly [number, number];
  detail: string;
  metrics: CompactDefectMetrics;
};

export type CompactTransition = {
  selector: string;
  /** Human label of the element (`role "name"`), else the selector. */
  label: string;
  kind: TransitionKind;
  /** Approximate motion curve; absent when indeterminate or a non-spatial change. */
  easing?: Easing;
  smoothness: Smoothness;
  /** 0..1; 1 is perfectly smooth. */
  quality: number;
};

export type CompactReport = {
  url: string;
  score: number;
  /** Present only for a whole-page audit (the run was given no selectors). */
  audit?: AuditMeta;
  /** One fix hint per defect type present; absent when there are no defects. */
  hints?: Partial<Record<DefectType, string>>;
  /** Discovered elements beyond the cap, omitted from `elements`. */
  elementsOmitted?: number;
  elements: readonly CompactElement[];
  defects: readonly CompactDefect[];
  /** Defects beyond the worst-N, omitted from `defects`; absent when none. */
  defectsOmitted?: number;
  /** Non-smooth transitions and any with a known easing curve; omitted when none. */
  transitions?: readonly CompactTransition[];
  /** Count of bare smooth transitions (no defect, no easing) left out; absent when zero. */
  smoothTransitions?: number;
};

function compactElement(
  e: Report['elements'][number],
  threshold: number,
): CompactElement {
  // Page coords: scroll-invariant, so start↔end are comparable; the `anchoredTo`
  // field still flags a screen-pinned element. `from` appears only when the box
  // actually changed (move OR resize), mirroring the smooth-transition omit.
  const moved = rectsDiffer(e.bounds.page.start, e.bounds.page.end, threshold);
  // Keys in natural reading order; `testid` and `anchoredEdges` are always explicit
  // (an absent field used to force the consumer to infer "all four / none").
  // `from`→`to` reads as a range; `to` (the settled box) is always present.
  return {
    selector: e.selector,
    label: e.label,
    testid: e.testid,
    source: e.source,
    impact: e.impactMode,
    anchoredTo: e.anchoredTo,
    anchoredEdges: e.anchoredEdges,
    ...(moved ? { from: boxTuple(e.bounds.page.start) } : {}),
    to: boxTuple(e.bounds.page.end),
    ...(e.affectedBy ? { affectedBy: e.affectedBy } : {}),
  };
}

// Curate the raw metrics down to the 1-2 numbers a consumer acts on per type.
function compactMetrics(
  type: DefectType,
  m: DefectMetrics,
): CompactDefectMetrics {
  const n = (key: string): number | undefined =>
    typeof m[key] === 'number' ? m[key] : undefined;
  const put = (
    key: keyof CompactDefectMetrics,
    v: number | undefined,
  ): CompactDefectMetrics => (v === undefined ? {} : { [key]: round2(v) });
  switch (type) {
    case 'layout-shift':
      return put('value', n('score'));
    case 'flicker':
      return {
        ...put('toggleCount', n('toggleCount')),
        ...put('frequencyHz', n('frequencyHz')),
      };
    case 'jank':
      return {
        ...put('droppedFrames', n('droppedFrames')),
        ...put('maxJumpPx', n('maxJumpPx')),
      };
    case 'dithering':
      return put('noiseEnergy', n('noiseEnergy'));
  }
}

function compactDefect(
  d: ReturnType<typeof coalesceDefects>[number],
  label: string,
): CompactDefect {
  const window: readonly [number, number] = [ms(d.window[0]), ms(d.window[1])];
  return {
    type: d.type,
    selector: d.selector,
    label,
    severity: round2(d.severity),
    // Only when coalesced; a lone occurrence (the common case) omits it.
    ...(d.count > 1 ? { count: d.count } : {}),
    window,
    detail: d.detail,
    metrics: compactMetrics(d.type, d.metrics),
  };
}

/** Distil a faithful Report into the lean, AI-first default output. */
export function compactReport(report: Report): CompactReport {
  const s = summarize(report);
  const url = report.session.segments.map((seg) => seg.url).join(' → ');
  // The element's role+name label, keyed by its selector, so defects and
  // transitions (which carry a selector) can show the same human label.
  const labelBy = new Map(report.elements.map((e) => [e.selector, e.label]));
  const labelFor = (selector: string): string =>
    labelBy.get(selector) ?? selector;
  // Detail a transition when it's non-smooth (a defect to act on) OR carries an
  // easing label (the consumer asked "how does it move?"). A purely smooth move
  // with no detectable curve stays a bare count — nothing actionable to show.
  const detailed = report.transitions
    .filter((t) => t.smoothness !== 'smooth' || t.easing !== null)
    // A report holds a handful of transitions and the spread conditionally
    // omits `easing`, so the copy cost is irrelevant here.
    // oxlint-disable-next-line oxc/no-map-spread
    .map((t) => ({
      selector: t.selector,
      label: labelFor(t.selector),
      kind: t.kind,
      ...(t.easing ? { easing: t.easing } : {}),
      smoothness: t.smoothness,
      quality: round2(t.quality),
    }));
  const smooth = report.transitions.length - detailed.length;

  const coalesced = coalesceDefects(report.defects);
  const presentTypes = ALL_TYPES.filter((t) =>
    coalesced.some((d) => d.type === t),
  );
  const hints: Partial<Record<DefectType, string>> = {};
  for (const t of presentTypes) hints[t] = hintFor(t);

  const allDefects = coalesced.map((d) =>
    compactDefect(d, labelFor(d.selector)),
  );
  const defects = allDefects.slice(0, MAX_DEFECTS);
  const defectsOmitted = allDefects.length - defects.length;

  // The element list is auto-detected, not requested — keep every element a
  // SURFACED defect points at (so the report never dangles a defect to an omitted
  // element), then fill the rest of the budget so a busy page can't bury findings.
  const surfacedSelectors = new Set(defects.map((d) => d.selector));
  let elements = report.elements.map((e) =>
    compactElement(e, report.session.pixelThreshold),
  );
  let elementsOmitted = 0;
  if (report.session.audit) {
    const withDefect = elements.filter((e) =>
      surfacedSelectors.has(e.selector),
    );
    const rest = elements.filter((e) => !surfacedSelectors.has(e.selector));
    // Never drop a surfaced-defect element, even if that exceeds the soft cap.
    const budget = Math.max(MAX_AUDIT_ELEMENTS, withDefect.length);
    elements = [...withDefect, ...rest].slice(0, budget);
    elementsOmitted = report.elements.length - elements.length;
  }

  const out: CompactReport = {
    url,
    score: s.score,
    ...(report.session.audit ? { audit: report.session.audit } : {}),
    ...(presentTypes.length > 0 ? { hints } : {}),
    ...(elementsOmitted > 0 ? { elementsOmitted } : {}),
    elements,
    defects,
    ...(defectsOmitted > 0 ? { defectsOmitted } : {}),
  };
  if (detailed.length > 0) out.transitions = detailed;
  if (smooth > 0) out.smoothTransitions = smooth;
  return out;
}
