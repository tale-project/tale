// Phase B/C of auto-detection: pick the page's developer-recognizable component
// roots. The instrument (audit-only) calls `selectComponents(document, …)` at
// settle. It gathers candidates from cheap structural / semantic / interactive /
// media / name signals (one DOM walk, attribute reads only — no layout), then
// does ONE batched layout pass to score each, collapses parent/child wrappers to
// the component root, and keeps the highest-scoring within a budget. The scoring,
// dedup, and budget steps are PURE and unit-tested; only `selectComponents`
// touches the DOM. No Node/Bun API, so it bundles into the browser IIFE.

import { clamp01 } from './geometry';
import type { ListenerRegistry } from './listeners';

// ---------------------------------------------------------------------------
// Pure scoring — the unit-test seam
// ---------------------------------------------------------------------------

/** Per-candidate features the score is a weighted sum of (all in [0,1]/bool). */
export type CandidateFeatures = {
  isLandmark: boolean;
  isInteractive: boolean;
  hasEventListener: boolean;
  isHeading: boolean;
  isMedia: boolean;
  componentNameHint: boolean;
  repeatedStructureMember: boolean;
  /** 0..1: how deliberately drawn the box is (border/bg/padding/radius/shadow). */
  boxness: number;
  inInitialViewport: boolean;
  /** 0..1: sqrt(area)/sqrt(viewport), clamped — presence without favoring giants. */
  areaNorm: number;
  /** Box ≈ whole viewport → a wrapper, not a component (penalty). */
  coversViewport: boolean;
  /** 0..1: log-normalized visible text length. */
  textDensity: number;
  highZIndex: boolean;
  /** Tiny AND non-interactive → a decorative speck (penalty). */
  tinyNonInteractive: boolean;
  /** Ancestor count up to `<body>`, for the nesting penalty. */
  depth: number;
};

export const SCORE_WEIGHTS = {
  isLandmark: 3.0,
  isInteractive: 2.5,
  hasEventListener: 2.0,
  isHeading: 1.5,
  isMedia: 2.0,
  componentNameHint: 2.0,
  repeatedStructureMember: 1.5,
  boxness: 2.0,
  inInitialViewport: 1.0,
  areaNorm: 1.5,
  textDensity: 1.0,
  highZIndex: 1.0,
  coversViewport: -2.5,
  tinyNonInteractive: -2.0,
  deeplyNested: -1.5,
} as const;

/** Depth at which the nesting penalty starts, and the span over which it ramps. */
export const DEPTH_FREE = 4;
export const DEPTH_SPAN = 8;

/** Weighted sum of a candidate's features. Pure; higher is more relevant. */
export function scoreCandidate(f: CandidateFeatures): number {
  const w = SCORE_WEIGHTS;
  let s = 0;
  if (f.isLandmark) s += w.isLandmark;
  if (f.isInteractive) s += w.isInteractive;
  if (f.hasEventListener) s += w.hasEventListener;
  if (f.isHeading) s += w.isHeading;
  if (f.isMedia) s += w.isMedia;
  if (f.componentNameHint) s += w.componentNameHint;
  if (f.repeatedStructureMember) s += w.repeatedStructureMember;
  if (f.inInitialViewport) s += w.inInitialViewport;
  if (f.highZIndex) s += w.highZIndex;
  s += w.boxness * clamp01(f.boxness);
  s += w.areaNorm * clamp01(f.areaNorm);
  s += w.textDensity * clamp01(f.textDensity);
  if (f.coversViewport) s += w.coversViewport;
  if (f.tinyNonInteractive) s += w.tinyNonInteractive;
  const over = clamp01((f.depth - DEPTH_FREE) / DEPTH_SPAN);
  s += w.deeplyNested * over;
  return s;
}

// ---------------------------------------------------------------------------
// Pure component-root dedup + budget
// ---------------------------------------------------------------------------

/** A scored candidate reduced to what dedup/budget need (no DOM). */
export type ScoredRect = {
  id: number;
  area: number;
  score: number;
  /** landmark(3) > interactive/heading(2) > name-hint(1) > generic(0); +0.5 boxed. */
  semanticRank: number;
  /** Ids of the OTHER candidates that DOM-contain this one. */
  ancestorIds: readonly number[];
  /** Replaced media: never dropped, exempt from the static budget. */
  forced: boolean;
};

/** Ancestor may be at most this much bigger before it's a real container. */
export const CONTAINMENT_K = 1.4;

/**
 * Collapse parent/child wrappers to the component root. When a candidate's
 * nearest kept ancestor is ~the same size (`area(ancestor) ≤ k·area(child)`),
 * keep one — the semantically richer; a tie keeps the outer (ancestor), which
 * also snaps an anonymous event-boundary node up to its boxed/landmark parent.
 * When the ancestor is much bigger it's a genuine container, so both are kept.
 * Forced (media) candidates are never dropped. Returns the ids to KEEP.
 */
export function componentRootDedup(
  cands: readonly ScoredRect[],
  k: number = CONTAINMENT_K,
): Set<number> {
  const byId = new Map(cands.map((c) => [c.id, c]));
  const dropped = new Set<number>();
  for (const c of cands) {
    if (dropped.has(c.id)) continue;
    // Nearest still-kept ancestor = the smallest-area one that contains c.
    let nearest: ScoredRect | undefined;
    for (const ancId of c.ancestorIds) {
      const anc = byId.get(ancId);
      if (!anc || dropped.has(anc.id)) continue;
      if (!nearest || anc.area < nearest.area) nearest = anc;
    }
    if (!nearest) continue;
    if (nearest.area > c.area * k) continue; // genuine container → keep both
    const keepAncestor =
      nearest.semanticRank > c.semanticRank ||
      (nearest.semanticRank === c.semanticRank && nearest.score >= c.score);
    if (keepAncestor) {
      if (!c.forced) dropped.add(c.id);
    } else if (!nearest.forced) {
      dropped.add(nearest.id);
    }
  }
  return new Set(cands.filter((c) => !dropped.has(c.id)).map((c) => c.id));
}

export const SELECT_BUDGET = 80;
export const RESERVED_ACTIVITY_SLOTS = 10;

/**
 * Pick the ids to track within budget: every forced (media) candidate, then the
 * highest-scoring of the rest up to `staticBudget`. `capped` is true when more
 * non-forced candidates qualified than there was room for.
 */
export function allocateBudget(
  kept: readonly ScoredRect[],
  staticBudget: number,
): { selected: Set<number>; capped: boolean } {
  const selected = new Set<number>();
  for (const c of kept) if (c.forced) selected.add(c.id);
  const rest = kept.filter((c) => !c.forced).sort((a, b) => b.score - a.score);
  const room = Math.max(0, staticBudget);
  for (let i = 0; i < rest.length && i < room; i++) {
    const c = rest[i];
    if (c) selected.add(c.id);
  }
  return { selected, capped: rest.length > room };
}

// ---------------------------------------------------------------------------
// Thin DOM layer — gather + feature extraction
// ---------------------------------------------------------------------------

export const COMPONENT_HINT_RE =
  /\b(hero|cta|card|nav|navbar|menu|modal|dialog|toast|snackbar|tab|tabs|carousel|slider|product|promo|btn|button|panel|drawer|sidebar|search|cart|price|banner|footer|header|accordion|dropdown|tooltip|badge|avatar|gallery|grid|list|item)\b/i;

const LANDMARK_SELECTOR =
  // `<search>` is the element form of the search landmark (alongside its role).
  'header,nav,main,footer,aside,section,form,search,' +
  '[role=banner],[role=navigation],[role=main],[role=contentinfo],' +
  '[role=complementary],[role=search],[role=region]';
const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6,[role=heading]';
const INTERACTIVE_SELECTOR =
  // `<summary>` is the disclosure toggle of a `<details>`; `[role=radio]` is the
  // custom-widget peer of the checkbox/switch roles already listed.
  'a[href],button,input,select,textarea,summary,' +
  '[role=button],[role=link],[role=tab],[role=menuitem],' +
  '[role=checkbox],[role=radio],[role=switch],[role=slider],' +
  '[tabindex],[contenteditable]';
const MEDIA_TAGS = new Set(['IMG', 'CANVAS', 'VIDEO', 'SVG', 'PICTURE']);
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'META',
  'LINK',
  'HEAD',
  'TITLE',
  'NOSCRIPT',
  'TEMPLATE',
  'BASE',
  'HTML',
  'BODY',
]);

const Z_HINT = 10;
const TINY_AREA = 24 * 24;
const COVERS_FRACTION = 0.85;
const TEXT_FULL = 200;

type Flags = {
  isLandmark: boolean;
  isInteractive: boolean;
  isHeading: boolean;
  isMedia: boolean;
  hasEventListener: boolean;
  componentNameHint: boolean;
  repeatedStructureMember: boolean;
  hasPaintingPseudo: boolean;
};

/**
 * Does a ::before/::after pseudo-element paint its own pixels (a `content:''`
 * badge with a background, a glyph)? The host element renders nothing of its own,
 * so this is its only paint signal. Probed only as a last resort (see
 * `candidacyFlags`) to bound the extra getComputedStyle over the candidacy scan.
 */
function paintsViaPseudoStyle(el: Element): boolean {
  const view = el.ownerDocument?.defaultView;
  if (!view) return false;
  for (const pseudo of ['::before', '::after'] as const) {
    const s = view.getComputedStyle(el, pseudo);
    const content = s.content;
    // `''` is how a no-pseudo element reads in some engines (happy-dom); a real
    // empty `content:''` box computes to `'""'`.
    if (content === 'none' || content === 'normal' || content === '') continue;
    const rendersContent = content !== '""' && content !== "''";
    const paintsBox =
      s.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
      s.backgroundImage !== 'none' ||
      parseFloat(s.borderTopWidth) > 0 ||
      parseFloat(s.borderRightWidth) > 0 ||
      parseFloat(s.borderBottomWidth) > 0 ||
      parseFloat(s.borderLeftWidth) > 0 ||
      s.boxShadow !== 'none';
    if (rendersContent || paintsBox) return true;
  }
  return false;
}

/** Does the element carry an inline `on*` handler attribute? */
function hasInlineHandler(el: Element): boolean {
  return el.getAttributeNames().some((n) => n.startsWith('on'));
}

/** Does any of the element's id/class/data-* match a component-name hint? */
function nameHint(el: Element): boolean {
  if (el.id && COMPONENT_HINT_RE.test(el.id)) return true;
  const cls = el.getAttribute('class');
  if (cls && COMPONENT_HINT_RE.test(cls)) return true;
  for (const name of el.getAttributeNames()) {
    if (!name.startsWith('data-')) continue;
    if (COMPONENT_HINT_RE.test(name)) return true;
    const value = el.getAttribute(name);
    if (value && COMPONENT_HINT_RE.test(value)) return true;
  }
  return false;
}

/** A child's "signature" (tag + class) for repeated-structure detection. */
function signature(el: Element): string {
  return `${el.tagName}.${el.getAttribute('class') ?? ''}`;
}

/**
 * Repeated-structure (list/grid) membership: the child shares its tag+class
 * signature with ≥3 of its siblings — the cheap stand-in for subdividing a
 * region into cards. Each parent's signature tally is computed once.
 */
function makeRepeatedMembership(): (el: Element) => boolean {
  const cache = new WeakMap<Element, Set<string>>();
  const repeatedSigs = (parent: Element): Set<string> => {
    const cached = cache.get(parent);
    if (cached) return cached;
    const counts = new Map<string, number>();
    for (const child of Array.from(parent.children)) {
      const sig = signature(child);
      counts.set(sig, (counts.get(sig) ?? 0) + 1);
    }
    const repeated = new Set<string>();
    for (const [sig, n] of counts) if (n >= 3) repeated.add(sig);
    cache.set(parent, repeated);
    return repeated;
  };
  return (el: Element): boolean => {
    const parent = el.parentElement;
    return parent ? repeatedSigs(parent).has(signature(el)) : false;
  };
}

function candidacyFlags(
  el: Element,
  registry: ListenerRegistry,
  isRepeatedMember: (el: Element) => boolean,
): Flags {
  const isLandmark = el.matches(LANDMARK_SELECTOR);
  const isInteractive = el.matches(INTERACTIVE_SELECTOR);
  const isHeading = el.matches(HEADING_SELECTOR);
  // Uppercase first: a namespaced inline <svg> reports a lowercase 'svg'.
  const isMedia = MEDIA_TAGS.has(el.tagName.toUpperCase());
  const hasEventListener = registry.has(el) || hasInlineHandler(el);
  const componentNameHint = nameHint(el);
  const repeatedStructureMember = isRepeatedMember(el);
  // The pseudo-element probe is the rare last resort, so pay for its
  // getComputedStyle only when no cheaper signal already qualifies the element.
  const hasCheapSignal =
    isLandmark ||
    isInteractive ||
    isHeading ||
    isMedia ||
    hasEventListener ||
    componentNameHint ||
    repeatedStructureMember;
  return {
    isLandmark,
    isInteractive,
    isHeading,
    isMedia,
    hasEventListener,
    componentNameHint,
    repeatedStructureMember,
    hasPaintingPseudo: !hasCheapSignal && paintsViaPseudoStyle(el),
  };
}

function isCandidate(f: Flags): boolean {
  return (
    f.isLandmark ||
    f.isInteractive ||
    f.isHeading ||
    f.isMedia ||
    f.hasEventListener ||
    f.componentNameHint ||
    f.repeatedStructureMember ||
    f.hasPaintingPseudo
  );
}

/** How deeply nested the element is (ancestors up to, but excluding, body). */
function depthOf(el: Element): number {
  let depth = 0;
  let node: Element | null = el.parentElement;
  while (node && node.tagName !== 'BODY' && node.tagName !== 'HTML') {
    depth++;
    node = node.parentElement;
  }
  return depth;
}

/** 0..1 box deliberateness from border / background / padding / radius / shadow. */
function boxness(style: CSSStyleDeclaration): number {
  let n = 0;
  if (
    parseFloat(style.borderTopWidth) > 0 ||
    parseFloat(style.borderRightWidth) > 0 ||
    parseFloat(style.borderBottomWidth) > 0 ||
    parseFloat(style.borderLeftWidth) > 0
  ) {
    n++;
  }
  if (
    style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
    style.backgroundColor !== 'transparent' &&
    style.backgroundColor !== ''
  ) {
    n++;
  }
  if (style.backgroundImage !== 'none' && style.backgroundImage !== '') n++;
  if (
    parseFloat(style.paddingTop) > 0 ||
    parseFloat(style.paddingRight) > 0 ||
    parseFloat(style.paddingBottom) > 0 ||
    parseFloat(style.paddingLeft) > 0
  ) {
    n++;
  }
  if (style.boxShadow !== 'none' && style.boxShadow !== '') n++;
  if (parseFloat(style.borderTopLeftRadius) > 0) n++;
  return Math.min(1, n / 5);
}

function featuresOf(
  el: Element,
  flags: Flags,
  rect: DOMRect,
  area: number,
  style: CSSStyleDeclaration,
  vp: { width: number; height: number },
): CandidateFeatures {
  const vpArea = Math.max(1, vp.width * vp.height);
  const text = (el.textContent ?? '').trim();
  const z = parseInt(style.zIndex, 10);
  return {
    isLandmark: flags.isLandmark,
    isInteractive: flags.isInteractive,
    hasEventListener: flags.hasEventListener,
    isHeading: flags.isHeading,
    isMedia: flags.isMedia,
    componentNameHint: flags.componentNameHint,
    repeatedStructureMember: flags.repeatedStructureMember,
    boxness: boxness(style),
    inInitialViewport:
      rect.top < vp.height &&
      rect.bottom > 0 &&
      rect.left < vp.width &&
      rect.right > 0,
    areaNorm: clamp01(Math.sqrt(area) / Math.sqrt(vpArea)),
    coversViewport: area > vpArea * COVERS_FRACTION,
    textDensity: clamp01(Math.log1p(text.length) / Math.log1p(TEXT_FULL)),
    highZIndex: Number.isFinite(z) && z >= Z_HINT,
    tinyNonInteractive:
      area < TINY_AREA && !flags.isInteractive && !flags.hasEventListener,
    depth: depthOf(el),
  };
}

/** Semantic rank for the dedup tie-break (a styled box edges up one notch). */
function rankOf(flags: Flags, box: number): number {
  let rank = 0;
  if (flags.isLandmark) rank = 3;
  else if (flags.isInteractive || flags.isHeading) rank = 2;
  else if (flags.componentNameHint) rank = 1;
  if (box >= 0.6 && rank < 2) rank += 0.5;
  return rank;
}

type RawCandidate = {
  el: Element;
  area: number;
  score: number;
  semanticRank: number;
  forced: boolean;
};

/**
 * Select the developer-recognizable component roots to track, in priority order
 * (forced media first, then by score). One DOM walk gathers candidates and one
 * batched layout pass scores them; the rest is the pure pipeline above. `capped`
 * is true when more components qualified than the static budget allowed — so a
 * truncated selection is never silent.
 */
export function selectComponents(
  doc: Document,
  registry: ListenerRegistry,
  vp: { width: number; height: number },
): { elements: Element[]; capped: boolean } {
  const isRepeatedMember = makeRepeatedMembership();
  const raws: RawCandidate[] = [];
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    if (SKIP_TAGS.has(el.tagName)) continue;
    const flags = candidacyFlags(el, registry, isRepeatedMember);
    if (!isCandidate(flags)) continue;
    const rect = el.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    if (area === 0) continue; // zero-box: no samples to take downstream
    const style = getComputedStyle(el);
    const features = featuresOf(el, flags, rect, area, style, vp);
    raws.push({
      el,
      area,
      score: scoreCandidate(features),
      semanticRank: rankOf(flags, features.boxness),
      forced: flags.isMedia,
    });
  }

  const scored: ScoredRect[] = raws.map((r, i) => ({
    id: i,
    area: r.area,
    score: r.score,
    semanticRank: r.semanticRank,
    ancestorIds: ancestorIdsOf(raws, i),
    forced: r.forced,
  }));
  const keptIds = componentRootDedup(scored);
  const kept = scored.filter((s) => keptIds.has(s.id));
  const { selected, capped } = allocateBudget(
    kept,
    SELECT_BUDGET - RESERVED_ACTIVITY_SLOTS,
  );
  const elements = scored
    .filter((s) => selected.has(s.id))
    .sort((a, b) => Number(b.forced) - Number(a.forced) || b.score - a.score)
    .map((s) => raws[s.id]?.el)
    .filter((el): el is Element => el !== undefined);
  return { elements, capped };
}

/** Ids of the candidates that DOM-contain candidate `i` (excluding itself). */
function ancestorIdsOf(raws: readonly RawCandidate[], i: number): number[] {
  const el = raws[i]?.el;
  if (!el) return [];
  const out: number[] = [];
  for (let j = 0; j < raws.length; j++) {
    if (j === i) continue;
    const other = raws[j]?.el;
    if (other && other.contains(el)) out.push(j);
  }
  return out;
}
