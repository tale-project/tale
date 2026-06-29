// Shared domain model for the Visual Aspect Analyzer.
//
// Two halves live here: the RECORDING (what the in-page instrument + driver
// produce over a session) and the REPORT (what the offline analysis emits).
// Keeping both in one file lets the analysis engine consume the recording and
// produce the report without a second, drifting source of truth.

/** One of an element's four box edges. */
export type Edge = 'top' | 'right' | 'bottom' | 'left';

/** Canonical edge order, reused wherever edges are iterated. */
export const ALL_EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];

/** A box, in whichever coordinate space the field that holds it names. */
export type Rect = { top: number; right: number; bottom: number; left: number };

/** A closed time window `[startMs, endMs]`, relative to session start. */
export type Window = readonly [number, number];

// ---------------------------------------------------------------------------
// Recording — produced live, consumed by the analysis engine
// ---------------------------------------------------------------------------

/**
 * A logical page in the session. A new segment opens on an SPA route change and
 * on a full reload; windows in the report are attributed to one.
 */
export type Segment = {
  index: number;
  url: string;
  from: number;
  to: number;
};

/**
 * One per-frame sample of one element. `rectScreen` is viewport-relative (moves
 * with `position: fixed`); `rectPage` is document-relative (scrolls with the
 * page). They differ only by the scroll offset, but storing both lets the
 * anchor and motion math stay branch-free and lets us tell scroll from motion.
 */
export type GeometrySample = {
  t: number;
  frame: number;
  segment: number;
  rectScreen: Rect;
  rectPage: Rect;
  opacity: number;
  /** `visibility: visible`, not `display: none`, and attached to the DOM. */
  visible: boolean;
  /** Inside the viewport this frame (from IntersectionObserver). */
  inViewport: boolean;
  /** Fully covered by an opaque element above it (from `elementsFromPoint`). */
  occluded: boolean;
  /** Paint heuristic held this frame (text/bg/border/shadow/replaced). */
  paints: boolean;
  /**
   * Noise energy (0..1) in this element's sub-rect versus the previous captured
   * frame, when the driver ran a pixel diff here; `null` when it did not.
   */
  pixelNoise: number | null;
  /**
   * Hash of the element's computed text + background colour. A change
   * between frames marks a colour transition. Optional: absent in recordings
   * from instruments that don't sample colour.
   */
  colorKey?: number;
  /**
   * `position` is `absolute` or `fixed` this frame — the element is OUT OF the
   * normal flow, so an in-flow element's growth cannot push it (a same-frame
   * move is self-driven). Used to keep coincidental co-movement from being read
   * as causation. Optional: absent in recordings from instruments that don't
   * sample it.
   */
  outOfFlow?: boolean;
  /**
   * `position` is `fixed` or `sticky` this frame — the element CAN pin to the
   * viewport. The anchor classifier only treats held-while-scrolling as a `screen`
   * anchor for such elements; a `static` element that briefly holds its screen
   * position is browser scroll-anchoring, not a real pin. Optional: absent in
   * recordings from instruments that don't sample it (treated as cannot-pin).
   */
  canPin?: boolean;
};

/**
 * Result of the invisible `display: none` counterfactual the instrument runs
 * for an element that never changed on its own (so observed co-movement never
 * gave a free experiment to attribute).
 */
export type LayoutProbe = {
  affects: boolean;
  movedKeys: readonly string[];
};

/** A single element followed across the session by a stable key. */
export type ElementTrack = {
  /** Stable id (the `data-testid` for tracked elements). */
  key: string;
  /** The `data-testid` if the element was tagged, else `null`. */
  testid: string | null;
  selector: string;
  /** ARIA role (explicit or implicit from the tag); for the display label. */
  role?: string;
  /** Accessible name (common accname cases); for the display label. */
  name?: string;
  /** Upper-case tag name (e.g. `CANVAS`); replaced media can dither. Optional. */
  tag?: string;
  /** `tracked` was auto-detected; `candidate` may be affected by one. */
  kind: 'tracked' | 'candidate';
  /** Ancestor keys, direct parent first, for the anchor-parent walk. */
  ancestorKeys: readonly string[];
  samples: readonly GeometrySample[];
  /** Present only when the invisible layout counterfactual ran on this node. */
  layoutProbe?: LayoutProbe;
};

/** A node a layout shift moved, with its before/after boxes. */
export type LayoutShiftSource = {
  key: string | null;
  previousRect: Rect;
  currentRect: Rect;
};

/**
 * A `layout-shift` PerformanceObserver entry, kept verbatim — CLS is read from
 * the platform, never recomputed.
 */
export type LayoutShiftEntry = {
  t: number;
  segment: number;
  value: number;
  hadRecentInput: boolean;
  sources: readonly LayoutShiftSource[];
};

/**
 * Provenance of a whole-page audit (a run with no selectors). Present only when
 * the session discovered its own elements instead of matching given ones.
 */
export type AuditMeta = {
  /** Always true; marks the recording as a no-selector page audit. */
  wholePage: true;
  /** How many elements the audit discovered and tracked. */
  discovered: number;
  /** True if generic discovery hit its cap, so some elements were not tracked. */
  capped: boolean;
};

/** Everything the live session captures; the sole input to the analysis. */
export type Recording = {
  /** Tolerance in px for "constant" (anchors) and "static" (pixel diffs). */
  pixelThreshold: number;
  /** Frame budget in ms (e.g. 1000/60); >1.5x of it is a dropped frame. */
  frameBudgetMs: number;
  segments: readonly Segment[];
  elements: readonly ElementTrack[];
  layoutShifts: readonly LayoutShiftEntry[];
  /** Present only for a whole-page audit (the run was given no selectors). */
  audit?: AuditMeta;
};

// ---------------------------------------------------------------------------
// Report — produced by the analysis engine
// ---------------------------------------------------------------------------

// The two fixed reference frames; an ancestor anchor is named by selector.
type ReferenceFrame = 'screen' | 'page';

/**
 * What an element is anchored to — the reference frame that holds its edges
 * constant: `screen` | `page` | a CSS selector for an ancestor | `null`
 * (unknown / not anchored). The `string & {}` keeps the literal hints while
 * still accepting any selector.
 */
export type AnchorTarget = ReferenceFrame | (string & {}) | null;

/** An element's box at the start vs. end of its primary segment, one space. */
export type BoundsPair = { start: Rect; end: Rect };

/**
 * Where an element sat at the start and end of the session, in both spaces.
 * `screen` is viewport-relative; `page` is document-relative and scroll-invariant,
 * so start↔end are only comparable there (a scrolled `screen` box moves on its own).
 */
export type ElementBounds = {
  screen: BoundsPair;
  page: BoundsPair;
};

export type ReportElement = {
  testid: string | null;
  selector: string;
  /** Human label — `role "name"` (e.g. `nav "Main"`), else the CSS selector. */
  label: string;
  source: 'matched' | 'affected';
  /** Present when `source` is `affected`: the testids of the matched causes. */
  affectedBy?: readonly string[];
  /** Impact modes the element exhibited at least once over the session. */
  impactMode: readonly ('paints' | 'layout')[];
  /**
   * What holds the element in place: `screen` (viewport-fixed), `page`
   * (document-fixed), an ancestor's CSS selector, or `null` (no single stable
   * frame). Pairs with `anchoredEdges` — this names the frame, that lists the
   * edges constant in it.
   */
  anchoredTo: AnchorTarget;
  /** Which edges (top/right/bottom/left) stayed constant in `anchoredTo`'s frame; `[]` when none. */
  anchoredEdges: readonly Edge[];
  /** Start/end boxes from the element's primary segment (both coordinate spaces). */
  bounds: ElementBounds;
};

export type DefectType = 'layout-shift' | 'flicker' | 'jank' | 'dithering';

/**
 * The raw numbers behind a defect's severity, kept primitive so the report
 * stays JSON-serializable and auditable.
 */
export type DefectMetrics = Readonly<Record<string, number | boolean | null>>;

export type Defect = {
  id: string;
  type: DefectType;
  testid: string | null;
  selector: string;
  segment: number;
  severity: number;
  window: Window;
  metrics: DefectMetrics;
  detail: string;
};

export type TransitionKind = 'move' | 'resize' | 'fade' | 'color' | 'composite';
export type Smoothness = 'smooth' | 'janky' | 'flicker' | 'shift';

/**
 * Approximate motion curve of a transition: `linear` (constant speed), `ease-in`
 * (accelerates from rest), `ease-out` (decelerates to rest), or `ease-in-out`
 * (the slow-fast-slow S-curve). A coarse, shape-level label, not a bezier fit.
 */
export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

/** One intended change over time, annotated with its smoothness and defects. */
export type Transition = {
  testid: string | null;
  selector: string;
  segment: number;
  kind: TransitionKind;
  /** Approximate motion curve; `null` when indeterminate or a non-spatial change. */
  easing: Easing | null;
  window: Window;
  smoothness: Smoothness;
  /** 0..1 quality; 1 is perfectly smooth. */
  quality: number;
  metrics: DefectMetrics;
  /** Ids into `defects[]` that occurred within this transition. */
  defects: readonly string[];
};

export type Report = {
  session: {
    segments: readonly Segment[];
    pixelThreshold: number;
    frameBudgetMs: number;
    /** Present only when this was a whole-page audit (no selectors). */
    audit?: AuditMeta;
  };
  elements: readonly ReportElement[];
  transitions: readonly Transition[];
  defects: readonly Defect[];
};
