// In-page instrumentation. Bundled to a browser IIFE and injected on every page
// load; it discovers the page's own relevant elements (a scored, proactive
// selection of component roots — `select.ts` — plus seeded media and whatever the
// four observers flag as active), tags them, runs the observers + an rAF geometry
// sampler, segments navigation (SPA History + full reloads), and exposes the
// invisible `display:none` counterfactual. The driver pulls `dump()` at session
// end and feeds it to the offline analysis engine.
//
// Across a full reload it persists the accumulated recording to sessionStorage
// and merges it on the next load, so a multi-page (MPA) session yields one
// recording with a monotonic clock and globally-unique keys.
//
// It touches the live DOM only to tag attributes and, during a keyframe, to
// toggle one element synchronously and restore it before paint. The user sees
// nothing.

import { computeAccessibleName, computeRole } from './accname';
import { type ListenerRegistry, nullListenerRegistry } from './listeners';
import { type JsonValue, validateRecording } from './recording';
import { selectComponents } from './select';
import type {
  AuditMeta,
  ElementTrack,
  GeometrySample,
  LayoutShiftEntry,
  LayoutShiftSource,
  Rect,
  Recording,
  Segment,
} from './types';

export type InstrumentOptions = {
  pixelThreshold: number;
  frameBudgetMs: number;
};

type Tracked = {
  key: string;
  testid: string;
  selector: string;
  role: string | null;
  name: string | null;
  el: Element;
  samples: GeometrySample[];
  changed: boolean;
  ancestorKeys: string[];
};

const MAX_ANCESTORS = 6;

// Re-run the scored selection at most this often when a listener is bound after
// settle, so a handler-churning page can't thrash layout every frame.
const RESELECT_THROTTLE_MS = 250;

// Whole-page auto-detection. The instrument discovers its own elements: a scored
// proactive selection of component roots (`select.ts`), seeded media, and
// anything the observers later flag as active. Generic discoveries are capped so
// the per-frame sampler never thrashes layout enough to induce the jank it
// measures; media and other high-signal nodes bypass the cap.
const AUDIT_DISCOVERY_CAP = 80;
// Replaced media that draws its own content and emits no other signal, so it is
// always seeded/high-signal. `SVG` is included, but note a real inline <svg>'s
// `tagName` is the lowercase namespaced 'svg' — every check below normalises the
// case before testing membership.
const AUDIT_MEDIA_TAGS = new Set(['IMG', 'CANVAS', 'VIDEO', 'SVG']);
const AUDIT_SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'META',
  'LINK',
  'HEAD',
  'TITLE',
  'NOSCRIPT',
  'TEMPLATE',
  'BASE',
]);

type Candidate = {
  key: string;
  el: Element;
  selector: string;
  role: string | null;
  name: string | null;
  samples: GeometrySample[];
  ancestorKeys: string[];
};

/** A sub-rect the driver can screenshot, in viewport coordinates. */
export type ProbeRect = { key: string; rect: Rect };
/** The same, stamped with the instrument clock for pixel-noise alignment. */
export type TimedRect = ProbeRect & { t: number };

type InstrumentApi = {
  keyframe: () => void;
  dump: () => string;
  /** Current sub-rects of every tracked + candidate element, for frame diffing. */
  rects: () => TimedRect[];
  /** Tracked elements that look occluded now, for the paint counterfactual. */
  paintProbeTargets: () => ProbeRect[];
  /**
   * Hide/restore a tracked element for the driver's paint probe. While probing,
   * the rAF sampler skips it, so the brief (cross-`evaluate`, async) hidden
   * state is never recorded as a real visibility toggle (a false flicker).
   */
  setProbe: (key: string, on: boolean) => void;
};

type Fragment = {
  segments: Segment[];
  elements: ElementTrack[];
  layoutShifts: LayoutShiftEntry[];
};

const STORE_KEY = '__va_store';

// A box in any coordinate space — the structural shape DOMRect/DOMRectReadOnly
// both satisfy, so callers pass either without a cast.
type RectLike = { top: number; right: number; bottom: number; left: number };

function rectOfDom(r: RectLike): Rect {
  return { top: r.top, right: r.right, bottom: r.bottom, left: r.left };
}

function toRect(
  domRect: DOMRect,
  scrollX: number,
  scrollY: number,
): { screen: Rect; page: Rect } {
  const screen: Rect = {
    top: domRect.top,
    right: domRect.right,
    bottom: domRect.bottom,
    left: domRect.left,
  };
  const page: Rect = {
    top: domRect.top + scrollY,
    right: domRect.right + scrollX,
    bottom: domRect.bottom + scrollY,
    left: domRect.left + scrollX,
  };
  return { screen, page };
}

/** The element fields the paint heuristic reads; `Element` satisfies it. */
export type PaintNode = { textContent: string | null; tagName: string };
/**
 * The computed-style fields the paint heuristic reads; `CSSStyleDeclaration`
 * satisfies it. Naming the exact surface keeps the heuristic pure and unit-
 * testable without constructing a whole `CSSStyleDeclaration`.
 */
export type PaintStyle = Pick<
  CSSStyleDeclaration,
  | 'visibility'
  | 'display'
  | 'backgroundImage'
  | 'backgroundColor'
  | 'borderTopWidth'
  | 'borderRightWidth'
  | 'borderBottomWidth'
  | 'borderLeftWidth'
  | 'boxShadow'
  | 'outlineStyle'
  | 'outlineWidth'
  | 'backdropFilter'
>;

/** Replaced elements draw their own content, so they always paint. */
const REPLACED_TAGS = new Set(['IMG', 'VIDEO', 'CANVAS', 'SVG', 'PICTURE']);

/**
 * Paint heuristic: would this element render any pixels of its own this frame?
 *
 * Deliberately an OVER-approximation. A false positive only adds a candidate
 * that the later impact checks can still drop; a false negative would silently
 * hide a real element. So ANY one signal counts: non-empty text, a
 * non-transparent background (colour or image), a border on ANY edge (a
 * bottom-border underline or right-border divider paints just as much as a full
 * box), a box-shadow, or replaced media. `visibility:hidden`/`display:none`
 * short-circuits to false — it renders nothing regardless of the above.
 */
export function paintsNow(el: PaintNode, style: PaintStyle): boolean {
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  const text = (el.textContent ?? '').trim().length > 0;
  const bg =
    style.backgroundImage !== 'none' ||
    style.backgroundColor !== 'rgba(0, 0, 0, 0)';
  const border =
    parseFloat(style.borderTopWidth) > 0 ||
    parseFloat(style.borderRightWidth) > 0 ||
    parseFloat(style.borderBottomWidth) > 0 ||
    parseFloat(style.borderLeftWidth) > 0;
  const shadow = style.boxShadow !== 'none';
  // An outline (drawn outside the border box) or a backdrop-filter (which paints
  // by re-rendering what is behind the element) are visible on their own.
  const outline =
    style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
  const backdrop =
    style.backdropFilter !== 'none' && style.backdropFilter !== '';
  // Uppercase before the lookup: a namespaced inline <svg> reports a lowercase
  // 'svg' tagName, so a raw `.has()` would miss it and drop the element.
  const replaced = REPLACED_TAGS.has(el.tagName.toUpperCase());
  return text || bg || border || shadow || replaced || outline || backdrop;
}

/**
 * The subset of computed style `hashColor` reads. Like `PaintStyle`, a `Pick`
 * keeps this hot per-frame helper honest about what it touches and lets tests
 * pass a plain literal without casting a full `CSSStyleDeclaration`.
 */
export type ColorStyle = Pick<
  CSSStyleDeclaration,
  | 'color'
  | 'backgroundColor'
  | 'backgroundImage'
  | 'filter'
  | 'boxShadow'
  | 'clipPath'
  | 'borderRadius'
  | 'borderTopColor'
  | 'borderRightColor'
  | 'borderBottomColor'
  | 'borderLeftColor'
  | 'maskImage'
  | 'maskPosition'
  | 'maskSize'
  | 'mixBlendMode'
  | 'backgroundBlendMode'
  | 'isolation'
  | 'objectFit'
  | 'objectPosition'
>;

/** djb2 string hash, folded to a 32-bit int. */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * Stable hash of everything (besides geometry/opacity/visibility, tracked
 * separately) that changes the pixels an element paints WITHIN its box, for
 * change detection. Beyond `color`/`backgroundColor` it includes
 * `backgroundImage` (animated gradients), `filter` (hue-rotate/brightness/blur),
 * `boxShadow`, `clipPath`, and `mask*` (mask-image/position/size) — a mask wipe
 * or shimmer reveals different pixels with an UNCHANGED box, exactly like
 * clip-path, so it must register the same way. It also includes `mixBlendMode`/
 * `backgroundBlendMode`/`isolation`: an element whose own blend mode animates
 * recomposites different pixels over its backdrop with an UNCHANGED box and style,
 * so without this its `colorKey` would read constant and the composited churn —
 * on replaced media especially — would be misattributed as dithering. Any of
 * these animating registers as a "colour" change, never as a separate defect.
 * The same holds for `objectFit`/`objectPosition`: on replaced media (img/video/
 * canvas/svg) they re-crop or reposition the painted content WITHIN an unchanged
 * box, so without them a deliberate object-position pan or fit swap would leave
 * `colorKey` constant and its pixel churn would be misattributed as dithering.
 * It also includes the four `border*Color`s: the border is painted INSIDE the
 * border box (the rect the dithering probe screenshots), so an animated border
 * colour on a static media element churns the captured pixels with an otherwise
 * constant `colorKey` and would be misread as dithering — the same failure mode
 * as the properties above. (`borderRadius` is already here as it clips them.)
 */
export function hashColor(style: ColorStyle): number {
  return djb2(
    `${style.color}|${style.backgroundColor}|${style.backgroundImage}` +
      `|${style.filter}|${style.boxShadow}|${style.clipPath}|${style.borderRadius}` +
      `|${style.borderTopColor}|${style.borderRightColor}` +
      `|${style.borderBottomColor}|${style.borderLeftColor}` +
      `|${style.maskImage}|${style.maskPosition}|${style.maskSize}` +
      `|${style.mixBlendMode}|${style.backgroundBlendMode}|${style.isolation}` +
      `|${style.objectFit}|${style.objectPosition}`,
  );
}

/**
 * A replaced element's pixels can be revealed or wiped by an ANCESTOR's animating
 * `clip-path` or `mask` even though the element's OWN computed style — and its own
 * bitmap — never change. Its `colorKey` would then read constant across the
 * reveal, so the pixel churn inside its sub-rect is misread as DITHERING (e.g. a
 * static striped canvas under a parent's clip/mask wipe). Folding every ancestor's
 * clip-path/mask into the element's colorKey makes an ancestor reveal register as
 * a colour change, so the region is no longer "stable" and the churn is never
 * blamed on the element. Only replaced media can dither, so this walk runs for
 * media alone (see `sampleElement`) and the per-frame cost stays bounded. A static
 * ancestor clip contributes a constant term, so a genuinely self-dithering canvas
 * still fires.
 */
export function ancestorClipKey(el: Element): number {
  let acc = '';
  let node: Element | null = el.parentElement;
  let guard = 0;
  while (node && guard++ < 64) {
    const s = getComputedStyle(node);
    acc += `|${s.clipPath}|${s.maskImage}|${s.maskPosition}|${s.maskSize}`;
    node = node.parentElement;
  }
  return djb2(acc);
}

/**
 * Fully covered: EVERY sampled point (the centre plus four inset corners) has a
 * non-descendant element on top. Sampling more than the centre lets the heuristic
 * degrade gracefully without the pixel counterfactual — a thin bar over an
 * element's middle no longer reads as fully occluded when its edges are clearly
 * visible. The centre is tested first so the common (not-occluded) case
 * short-circuits on a single probe; the driver's pixel counterfactual still backs
 * up the all-covered verdict when pixels are captured (see `annotatePaint`).
 */
function isOccluded(
  el: Element,
  domRect: DOMRect,
  peNoneCovers: readonly Element[] = [],
): boolean {
  const { left, top, width, height } = domRect;
  if (width <= 0 || height <= 0) return false;
  const cx = left + width / 2;
  const cy = top + height / 2;
  const lx = left + width * 0.15;
  const rx = left + width * 0.85;
  const ty = top + height * 0.15;
  const by = top + height * 0.85;
  const points: ReadonlyArray<readonly [number, number]> = [
    [cx, cy],
    [lx, ty],
    [rx, ty],
    [lx, by],
    [rx, by],
  ];
  for (const [px, py] of points) {
    const hit = document.elementFromPoint(px, py);
    // A clear sample (nothing, or self/a descendant on top) is not occluded —
    // UNLESS an opaque `pointer-events:none` element covers it ABOVE `el`.
    // elementFromPoint ignores pe:none, so such a cover is otherwise invisible to
    // the hit-test and the element would wrongly read as painting.
    const clear = hit === null || hit === el || el.contains(hit);
    if (clear && !coveredByOpaquePeNone(el, px, py, peNoneCovers)) return false;
  }
  return true;
}

/**
 * Opaque elements with `pointer-events:none`. They paint (and visually occlude)
 * but `document.elementFromPoint` skips them, so the occlusion hit-test can't see
 * them as covers. Recomputed at selection time (not per frame) and passed to
 * `isOccluded`. "Opaque" = visible, full opacity, and a solid background or
 * replaced media (its own pixels).
 */
function findOpaquePeNoneCovers(): Element[] {
  const out: Element[] = [];
  for (const el of Array.from(document.querySelectorAll('*'))) {
    if (AUDIT_SKIP_TAGS.has(el.tagName)) continue;
    const s = getComputedStyle(el);
    if (s.pointerEvents !== 'none') continue;
    if (s.visibility === 'hidden' || s.display === 'none') continue;
    if ((parseFloat(s.opacity) || 0) < 0.99) continue;
    const opaqueBg =
      s.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
      s.backgroundColor !== 'transparent' &&
      !/,\s*0(\.0+)?\)\s*$/.test(s.backgroundColor);
    const media = REPLACED_TAGS.has(el.tagName.toUpperCase());
    if (opaqueBg || media) out.push(el);
  }
  return out;
}

/** Does `a` paint above `b`? Higher z-index wins; equal/auto falls back to DOM
 * order (a later element paints over an earlier one in the same stacking context).
 * An approximation — it ignores nested stacking contexts — but it correctly
 * resolves the common opaque-overlay-over-content case. */
function paintsAbove(a: Element, b: Element): boolean {
  const za = parseInt(getComputedStyle(a).zIndex, 10);
  const zb = parseInt(getComputedStyle(b).zIndex, 10);
  const aHasZ = !Number.isNaN(za);
  const bHasZ = !Number.isNaN(zb);
  if (aHasZ && bHasZ && za !== zb) return za > zb;
  if (aHasZ && !bHasZ) return za > 0;
  // `b PRECEDES a` (bit 2) → a is later in document order → painted on top.
  return (a.compareDocumentPosition(b) & 2) !== 0;
}

/** Is `el` covered at (px,py) by an opaque pe:none element painted above it? */
function coveredByOpaquePeNone(
  el: Element,
  px: number,
  py: number,
  covers: readonly Element[],
): boolean {
  for (const cover of covers) {
    if (cover === el || el.contains(cover) || cover.contains(el)) continue;
    const r = cover.getBoundingClientRect();
    if (px < r.left || px > r.right || py < r.top || py > r.bottom) continue;
    if (paintsAbove(cover, el)) return true;
  }
  return false;
}

// Cache of "is this element in a viewport-pinnable subtree" — its own or an
// ancestor's `position` is fixed/sticky. Computed once per element (a dynamic
// position change is a rare, documented boundary) so the per-frame sampler never
// re-walks ancestors with getComputedStyle.
const pinnableCache = new WeakMap<Element, boolean>();

/**
 * Can this element hold its position in the viewport while the page scrolls?
 * True iff it — or any ancestor up to <html> — is `position: fixed` or `sticky`.
 * Used by the anchor classifier (via the `canPin` sample flag) to tell a genuine
 * screen anchor from browser scroll-anchoring, which briefly holds a STATIC
 * in-flow element's screen position when content is inserted above it.
 */
function isPinnable(el: Element): boolean {
  const cached = pinnableCache.get(el);
  if (cached !== undefined) return cached;
  let node: Element | null = el;
  let result = false;
  while (node && node.tagName !== 'HTML') {
    const pos = getComputedStyle(node).position;
    if (pos === 'fixed' || pos === 'sticky') {
      result = true;
      break;
    }
    node = node.parentElement;
  }
  pinnableCache.set(el, result);
  return result;
}

// Cache of "does a ::before/::after pseudo paint its own pixels". A host can
// render nothing itself yet show a painting pseudo (a `content:''` badge with a
// background, a `content:'★'` glyph). Pseudo-elements aren't DOM nodes, so this
// is the host's only paint signal. Computed once per element (pseudo style rarely
// changes) to keep the per-frame sampler off `getComputedStyle(el, '::before')`.
const pseudoPaintCache = new WeakMap<Element, boolean>();
export function paintsViaPseudo(el: Element): boolean {
  const cached = pseudoPaintCache.get(el);
  if (cached !== undefined) return cached;
  let result = false;
  const view = el.ownerDocument?.defaultView;
  if (view) {
    for (const pseudo of ['::before', '::after'] as const) {
      const s = view.getComputedStyle(el, pseudo);
      const content = s.content;
      // `none`/`normal` ⇒ no generated box; `''` is how a no-pseudo element reads
      // in some engines (happy-dom) — a real empty box computes to `'""'`.
      if (content === 'none' || content === 'normal' || content === '')
        continue;
      // A box that renders content (a glyph/image/counter — i.e. NOT the empty
      // string) paints; an empty `content:''` box paints only via bg/border/shadow.
      const rendersContent = content !== '""' && content !== "''";
      const paintsBox =
        s.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
        s.backgroundImage !== 'none' ||
        parseFloat(s.borderTopWidth) > 0 ||
        parseFloat(s.borderRightWidth) > 0 ||
        parseFloat(s.borderBottomWidth) > 0 ||
        parseFloat(s.borderLeftWidth) > 0 ||
        s.boxShadow !== 'none';
      if (rendersContent || paintsBox) {
        result = true;
        break;
      }
    }
  }
  pseudoPaintCache.set(el, result);
  return result;
}

/**
 * Document scaffolding (`<html>`/`<body>`). These "move" whenever content
 * resizes, but reporting them as affected elements is noise, never actionable —
 * so they are never registered as candidates or shift sources.
 */
function isStructural(el: Element): boolean {
  return el.tagName === 'HTML' || el.tagName === 'BODY';
}

// Depth cap for a candidate's nth-child path: enough to disambiguate, short
// enough to stay a readable label rather than a brittle full-document selector.
const MAX_PATH_DEPTH = 4;

/**
 * A readable selector for an untagged element: its own id, else an nth-child
 * path anchored at the nearest ancestor WITH an id (so `#grid > div:nth-child(3)`
 * rather than `html > body:nth-child(2) > div:nth-child(1) > div:nth-child(3)`).
 * Structural `html`/`body` are never emitted — they add no specificity.
 */
function cssPath(el: Element): string {
  // An author-provided test id is the most stable, meaningful locator.
  const testid = el.getAttribute('data-testid');
  if (testid) return `[data-testid="${testid}"]`;
  if (el.id) return `#${el.id}`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && parts.length < MAX_PATH_DEPTH) {
    // An ancestor with an id anchors the path; stop and prefix it.
    if (node !== el && node.id) {
      parts.unshift(`#${node.id}`);
      return parts.join(' > ');
    }
    if (isStructural(node)) break; // html/body add only clutter
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    const index = Array.from(parent.children).indexOf(node) + 1;
    parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
    node = parent;
  }
  return parts.join(' > ') || el.tagName.toLowerCase();
}

/** A node a layout shift moved, before resolution to a key. */
type ShiftSourceLike = {
  node: Node | null;
  previousRect: RectLike;
  currentRect: RectLike;
};

/**
 * Resolve `layout-shift` attributions to recorded keys. Pure and exported so it
 * can be tested without a live PerformanceObserver. `resolveKey` maps a moved
 * node to its key (registering it as a candidate if new), or `null`.
 */
export function mapShiftSources(
  sources: readonly ShiftSourceLike[],
  resolveKey: (node: Node) => string | null,
): LayoutShiftSource[] {
  const out: LayoutShiftSource[] = [];
  for (const s of sources) {
    out.push({
      key: s.node ? resolveKey(s.node) : null,
      previousRect: rectOfDom(s.previousRect),
      currentRect: rectOfDom(s.currentRect),
    });
  }
  return out;
}

type StoredSession = {
  recording: Recording;
  pageOrdinal: number;
  elapsed: number;
};

/**
 * Read the accumulated prior-page session, or `null` on first load / bad data.
 * All storage access is guarded — sessionStorage throws in some contexts (e.g.
 * `data:` URLs, privacy modes) and must never abort install.
 */
function readStore(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed: JsonValue = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const ordinal = parsed.pageOrdinal;
    const elapsed = parsed.elapsed;
    if (typeof ordinal !== 'number' || typeof elapsed !== 'number') return null;
    return {
      recording: validateRecording(parsed),
      pageOrdinal: ordinal,
      elapsed,
    };
  } catch (err) {
    console.warn('[va] ignoring inaccessible/malformed session store', err);
    return null;
  }
}

/** The instrument's view of the listener registry installed before page scripts. */
function hasFn(o: object, key: string): boolean {
  return key in o && typeof Reflect.get(o, key) === 'function';
}

function isListenerRegistry(value: unknown): value is ListenerRegistry {
  return (
    typeof value === 'object' &&
    value !== null &&
    hasFn(value, 'has') &&
    hasFn(value, 'typesFor') &&
    hasFn(value, 'drainPending')
  );
}

/** The pre-page-scripts event-boundary registry, or a null one if absent. */
function readListenerRegistry(): ListenerRegistry {
  const raw: unknown = Reflect.get(globalThis, '__VA_LISTENERS');
  return isListenerRegistry(raw) ? raw : nullListenerRegistry();
}

/**
 * Install the instrument and return its control surface (also pinned on
 * `globalThis` as `__VA` for the driver to call).
 */
export function installVisualAspectInstrument(
  options: InstrumentOptions,
): InstrumentApi {
  const start = performance.now();

  // Restore prior pages (MPA). `globalBase` continues segment numbering; the
  // `idPrefix` keeps keys unique across pages; `timeBase` keeps the clock
  // monotonic since performance.now() resets on every document.
  const prior = readStore();
  const priorSegments = prior ? [...prior.recording.segments] : [];
  const priorElements = prior ? [...prior.recording.elements] : [];
  const priorLayoutShifts = prior ? [...prior.recording.layoutShifts] : [];
  const pageOrdinal = prior ? prior.pageOrdinal : 0;
  const timeBase = prior ? prior.elapsed : 0;
  const globalBase = priorSegments.length;
  const idPrefix = pageOrdinal > 0 ? `p${pageOrdinal}-` : '';

  let frame = 0;
  let localIndex = 0;
  const segments: Segment[] = [
    { index: globalBase, url: location.href, from: timeBase, to: timeBase },
  ];
  const tracked: Tracked[] = [];
  const candidates = new Map<Element, Candidate>();
  const layoutShifts: LayoutShiftEntry[] = [];
  const inView = new Map<Element, boolean>();
  const probes = new Map<string, { affects: boolean; movedKeys: string[] }>();
  let nextTestid = 1;
  let nextCandidate = 1;
  let resizeObserver: ResizeObserver | null = null;
  let intersectionObserver: IntersectionObserver | null = null;

  // Every element we track. Dedupes re-tagging, keeps a tracked element from also
  // becoming a candidate, and makes our own tagging/keyframe writes idempotent.
  const trackedEls = new WeakSet<Element>();
  // Keys currently hidden by the driver's paint probe — skipped by the sampler.
  const probing = new Set<string>();
  // The element's own inline `visibility` before a probe hid it, so the restore
  // puts back the author's value (e.g. a `visibility:hidden` canvas) instead of
  // blanking it — blanking would un-hide it and its churn would read as a defect.
  const priorProbeVisibility = new Map<string, string>();
  // Opaque pointer-events:none covers, refreshed at each selection (not per frame)
  // and consulted by `isOccluded` — elementFromPoint can't see them.
  let peNoneCovers: Element[] = [];
  // `discovered`/`capped` report coverage so a truncated audit is never silent.
  let discovered = 0;
  let capped = false;
  const listeners = readListenerRegistry();
  // Clock of the last post-settle re-score, to throttle listener-driven reselects.
  // Starts at -Infinity so the FIRST pending listener triggers a reselect
  // immediately; only repeats are throttled.
  let lastReselect = -Infinity;

  const now = (): number => timeBase + (performance.now() - start);
  const segmentIndex = (): number => segments[localIndex]?.index ?? globalBase;

  const observeElement = (el: Element): void => {
    resizeObserver?.observe(el);
    intersectionObserver?.observe(el);
  };

  const ensureCandidate = (node: Element): string | null => {
    if (isStructural(node)) return null; // html/body are noise, never affected
    if (trackedEls.has(node)) return null; // a tracked element is never a candidate
    const existing = candidates.get(node);
    if (existing) return existing.key;
    const key = `${idPrefix}cand-${nextCandidate++}`;
    const candidate: Candidate = {
      key,
      el: node,
      selector: cssPath(node),
      role: computeRole(node),
      name: computeAccessibleName(node),
      samples: [],
      ancestorKeys: [],
    };
    // Register in the map BEFORE walking ancestors, so a re-entrant walk
    // (registerAncestors → ensureCandidate) resolves this node instead of
    // recursing forever. A candidate's own ancestorKeys are what let the
    // out-of-flow attribution in impact.ts reach its positioned ancestor — an
    // absolutely-positioned wrapper that rides a moving ancestor was being
    // dropped because its ancestorKeys were always empty.
    candidates.set(node, candidate);
    candidate.ancestorKeys = registerAncestors(node);
    observeElement(node);
    return key;
  };

  // The ancestor chain (parent first) feeds the anchor-parent walk in step 7,
  // stopping at the document scaffolding. An ancestor that is ITSELF tracked
  // contributes its tracked key — not a candidate — so the anchor walk can still
  // resolve it. Registering ancestors is what makes ancestor anchoring (rule 3)
  // work for auto-detected elements; non-ancestor neighbours are NOT registered,
  // which is what keeps the candidate set from exploding.
  const registerAncestors = (el: Element): string[] => {
    const keys: string[] = [];
    let node: Element | null = el.parentElement;
    while (node && keys.length < MAX_ANCESTORS && !isStructural(node)) {
      const trackedHit = tracked.find((t) => t.el === node);
      const key = trackedHit ? trackedHit.key : ensureCandidate(node);
      if (key) keys.push(key);
      node = node.parentElement;
    }
    return keys;
  };

  // Promote an element into the tracked set, so the full impact/anchor/defect
  // pipeline runs on it. Deduped via `trackedEls`; structural and non-visual
  // nodes filtered out; generic discoveries capped (media and explicitly-forced
  // high-signal nodes are not). Zero-box nodes are NOT filtered here — they simply
  // produce no samples and are pruned downstream, which keeps this branch free of
  // a layout read. `force` bypasses the cap (the proactive selection and media
  // enforce their own budget upstream).
  const discover = (node: Node | EventTarget | null, force = false): void => {
    if (!(node instanceof Element) || trackedEls.has(node)) return;
    if (isStructural(node) || AUDIT_SKIP_TAGS.has(node.tagName)) return;
    const highSignal =
      force || AUDIT_MEDIA_TAGS.has(node.tagName.toUpperCase());
    if (!highSignal && discovered >= AUDIT_DISCOVERY_CAP) {
      capped = true;
      return;
    }
    // Compute the locator BEFORE tagging, so a minted `va-N` never leaks into
    // the element's own selector (it reflects the node's author id/testid/path).
    const selector = cssPath(node);
    const role = computeRole(node);
    const name = computeAccessibleName(node);
    trackedEls.add(node); // before tagging, so the data-testid write can't re-enter
    const existing = node.getAttribute('data-testid');
    const testid = existing ?? `${idPrefix}va-${nextTestid++}`;
    if (!existing) node.setAttribute('data-testid', testid);
    const ancestorKeys = registerAncestors(node);
    tracked.push({
      key: testid,
      testid,
      selector,
      role,
      name,
      el: node,
      samples: [],
      changed: false,
      ancestorKeys,
    });
    observeElement(node);
    discovered++;
  };

  // Seed replaced media: a churning <canvas>/<video> fires no mutation,
  // animation, or layout-shift signal, so seeding is the only way to catch it
  // (the dithering target). Runs at settle and on each navigation.
  const seedMedia = (): void => {
    for (const el of Array.from(
      document.querySelectorAll('img, canvas, video, svg'),
    ))
      discover(el, true);
  };

  // The proactive, scored selection of component roots (`select.ts`). Runs at
  // settle and on navigation; idempotent via `trackedEls`. Forces its picks past
  // the per-element cap (the selection enforces the 80-slot budget itself, minus
  // the slots reserved for runtime observer discoveries) and surfaces a capped
  // selection so coverage is never silently truncated.
  const runSelect = (): void => {
    let result: { elements: Element[]; capped: boolean };
    try {
      result = selectComponents(document, listeners, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
    } catch (err) {
      console.warn('[va] component selection failed', err);
      return;
    }
    for (const el of result.elements) discover(el, true);
    if (result.capped) capped = true;
    peNoneCovers = findOpaquePeNoneCovers();
  };

  const gather = (): void => {
    seedMedia();
    runSelect();
  };

  const sampleElement = (
    el: Element,
  ): Omit<GeometrySample, 'segment'> | null => {
    const domRect = el.getBoundingClientRect();
    if (domRect.width === 0 && domRect.height === 0) return null;
    const { screen, page } = toRect(domRect, window.scrollX, window.scrollY);
    const style = getComputedStyle(el);
    // Prefer IntersectionObserver; fall back to a manual viewport test when it
    // is unavailable (older engines, the happy-dom test harness).
    const manualInView = domRect.bottom > 0 && domRect.top < window.innerHeight;
    // Only replaced media can dither, and only media pays the ancestor-clip walk:
    // an ancestor's animating clip-path/mask reveal must vary the element's
    // colorKey so the churn it causes is not misread as the media dithering.
    const media = REPLACED_TAGS.has(el.tagName.toUpperCase());
    return {
      t: now(),
      frame,
      rectScreen: screen,
      rectPage: page,
      opacity: parseFloat(style.opacity) || 0,
      visible: style.visibility !== 'hidden' && style.display !== 'none',
      inViewport: inView.get(el) ?? manualInView,
      occluded: isOccluded(el, domRect, peNoneCovers),
      paints: paintsNow(el, style) || paintsViaPseudo(el),
      colorKey: hashColor(style) ^ (media ? ancestorClipKey(el) : 0),
      pixelNoise: null,
      // Out of normal flow → can't be pushed by an in-flow element's growth, so
      // a same-frame move is self-driven, not caused (see impact.ts Pass 1).
      outOfFlow: style.position === 'absolute' || style.position === 'fixed',
      // In a viewport-pinnable subtree (self OR an ancestor is fixed/sticky), so
      // it CAN hold its screen position as the page scrolls. A static element NOT
      // in such a subtree that briefly holds its screen position is browser
      // scroll-anchoring, not a real pin — the anchor classifier gates `screen` on
      // this (anchors.ts). Ancestor-aware so an absolute child of a fixed bar still
      // counts; an absolute element relative to a static page does not.
      canPin: isPinnable(el),
    };
  };

  // Sample one element, or — when it has just gone `display:none` after being
  // visible — record a HIDDEN frame that reuses its last geometry and opacity
  // (so a display toggle reads as flicker, with no false 0-rect move or fade).
  const pushSample = (
    holder: { el: Element; samples: GeometrySample[] },
    segment: number,
  ): void => {
    const base = sampleElement(holder.el);
    if (base) {
      holder.samples.push({ ...base, segment });
      return;
    }
    const last = holder.samples[holder.samples.length - 1];
    if (!last || !last.visible) return; // never-seen or already-hidden: nothing to add
    if (getComputedStyle(holder.el).display !== 'none') return; // genuinely empty box
    holder.samples.push({
      ...last,
      t: now(),
      frame,
      segment,
      visible: false,
      paints: false,
      occluded: false,
      pixelNoise: null,
    });
  };

  const tick = (): void => {
    frame++;
    const segment = segmentIndex();
    // A boundary listener bound AFTER the settle-time selection (lazy hydration,
    // a deferred `addEventListener` with no DOM mutation) means a component
    // appeared that the scored selection never saw. Re-run it, throttled. The
    // throttle is checked first so `drainPending` is consumed only when we act.
    if (
      now() - lastReselect > RESELECT_THROTTLE_MS &&
      listeners.drainPending()
    ) {
      lastReselect = now();
      runSelect();
    }
    // Refresh opaque pe:none covers on the FIRST sampled frame: they are styled by
    // the page's parse-time scripts (before any tick), so without this an element
    // that is opaque from frame 0 under such a cover paints in the early frames and
    // the temporal union latches it. Cheap (one extra query); later covers are
    // picked up by the selection refresh.
    if (frame === 1) peNoneCovers = findOpaquePeNoneCovers();
    for (const t of tracked) if (!probing.has(t.key)) pushSample(t, segment);
    for (const candidate of candidates.values())
      if (!probing.has(candidate.key)) pushSample(candidate, segment);
    const local = segments[localIndex];
    if (local) local.to = now();
    requestAnimationFrame(tick);
  };

  // Invisible counterfactual: toggle each never-changed tracked element off,
  // read every candidate rect (which forces a synchronous layout), then restore
  // it — all within one JS turn, before the browser paints, so nothing flashes.
  const keyframe = (): void => {
    // Each tracked element is tested in isolation: exactly one is hidden per
    // iteration while every candidate's rect is measured before vs after.
    for (const t of tracked) {
      if (t.changed) continue;
      const element = t.el;
      if (!(element instanceof HTMLElement)) continue;
      const before = new Map<Element, DOMRect>();
      for (const candidate of candidates.values()) {
        before.set(candidate.el, candidate.el.getBoundingClientRect());
      }
      const prevDisplay = element.style.display;
      element.style.display = 'none';
      const movedKeys: string[] = [];
      for (const candidate of candidates.values()) {
        // A self-translating element can be registered as BOTH this tracked node
        // and a candidate; hiding it would collapse its own candidate rect, which
        // is not "it moved another element" — it's the same node. Skip it so the
        // counterfactual never attributes an element to moving itself.
        if (candidate.el === element) continue;
        const after = candidate.el.getBoundingClientRect();
        const prev = before.get(candidate.el);
        if (
          prev &&
          (Math.abs(prev.top - after.top) > options.pixelThreshold ||
            Math.abs(prev.left - after.left) > options.pixelThreshold)
        ) {
          movedKeys.push(candidate.key);
        }
      }
      element.style.display = prevDisplay;
      probes.set(t.key, { affects: movedKeys.length > 0, movedKeys });
    }
  };

  // Mark only the tracked elements actually touched by a mutation/resize, so the
  // invisible counterfactual still runs for the genuinely-unchanged ones.
  const markChanged = (target: Node): void => {
    for (const t of tracked) {
      if (t.el === target || t.el.contains(target) || target.contains(t.el)) {
        t.changed = true;
      }
    }
  };

  const resolveShiftKey = (node: Node): string | null => {
    if (!(node instanceof Element)) return null;
    // A shifted element is a real survivor, not a mere candidate — promote it so
    // its layout-shift defect is reported directly.
    discover(node, true);
    const hit = tracked.find((t) => t.el === node);
    return hit ? hit.key : ensureCandidate(node);
  };

  const observeChanges = (): void => {
    if (typeof MutationObserver !== 'undefined') {
      // Observe `document` (always a Node), not `document.documentElement`,
      // which is null when the instrument installs at document-start. The
      // callback discovers active elements as the DOM streams in.
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === 'attributes') {
            // Our own tagging write is not a real change; a post-load
            // style/class change is.
            if (record.attributeName === 'data-testid') continue;
            markChanged(record.target);
            discover(record.target);
          } else {
            markChanged(record.target);
            // Inserted nodes: media always (a churning canvas emits no other
            // signal), anything else only AFTER the initial parse — otherwise
            // the whole initial DOM, streamed in as childList mutations, would
            // be discovered as "active".
            const settled = document.readyState !== 'loading';
            for (const added of Array.from(record.addedNodes)) {
              if (
                added instanceof Element &&
                (settled || AUDIT_MEDIA_TAGS.has(added.tagName.toUpperCase()))
              ) {
                discover(added);
              }
            }
          }
        }
      }).observe(document, {
        subtree: true,
        attributes: true,
        childList: true,
      });
    }
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) markChanged(entry.target);
      });
    }
    if (typeof IntersectionObserver !== 'undefined') {
      intersectionObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          inView.set(entry.target, entry.isIntersecting);
        }
      });
    }
    if (typeof PerformanceObserver !== 'undefined') {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!('value' in entry) || typeof entry.value !== 'number') continue;
          const raw =
            'sources' in entry && Array.isArray(entry.sources)
              ? entry.sources
              : [];
          layoutShifts.push({
            t: now(),
            segment: segmentIndex(),
            value: entry.value,
            hadRecentInput:
              'hadRecentInput' in entry && entry.hadRecentInput === true,
            sources: mapShiftSources(raw, resolveShiftKey),
          });
        }
      });
      observer.observe({ type: 'layout-shift', buffered: true });
    }
  };

  const onNavigate = (): void => {
    const local = segments[localIndex];
    if (local) local.to = now();
    localIndex++;
    segments.push({
      index: globalBase + localIndex,
      url: location.href,
      from: now(),
      to: now(),
    });
    gather();
  };

  // A "view" is identified by origin + pathname + search; the #fragment is an
  // in-page location. popstate fires both for real back/forward navigation AND
  // for fragment-only history changes (a `location.hash` assignment or a
  // same-page `<a href="#x">` click), which are scroll-to-anchor on the SAME
  // view — not a route change — so they must not open a segment. Explicit
  // pushState/replaceState always segment (developer intent), so this same-view
  // gate lives only on the implicit popstate path.
  const viewKey = (href: string): string => {
    try {
      const u = new URL(href);
      return u.origin + u.pathname + u.search;
    } catch (err) {
      console.warn('[va] could not parse navigation URL', err);
      return href;
    }
  };
  const onPopNavigate = (): void => {
    const local = segments[localIndex];
    if (local && viewKey(local.url) === viewKey(location.href)) return;
    onNavigate();
  };

  // Wrap History so SPA route changes open a new segment (popstate covers
  // back/forward; pushState/replaceState cover programmatic navigation).
  const wrapHistory = (): void => {
    if (typeof history === 'undefined') return;
    const wrap = (method: 'pushState' | 'replaceState'): void => {
      const original = history[method].bind(history);
      history[method] = (data, unused, url) => {
        original(data, unused, url);
        onNavigate();
      };
    };
    wrap('pushState');
    wrap('replaceState');
  };

  const currentFragment = (): Fragment => {
    const elements: ElementTrack[] = [];
    for (const t of tracked) {
      const probe = probes.get(t.key);
      const entry: ElementTrack = {
        key: t.key,
        testid: t.testid,
        selector: t.selector,
        ...(t.role !== null ? { role: t.role } : {}),
        ...(t.name !== null ? { name: t.name } : {}),
        tag: t.el.tagName,
        kind: 'tracked',
        ancestorKeys: t.ancestorKeys,
        samples: t.samples,
      };
      elements.push(probe ? { ...entry, layoutProbe: probe } : entry);
    }
    for (const candidate of candidates.values()) {
      elements.push({
        key: candidate.key,
        testid: null,
        selector: candidate.selector,
        ...(candidate.role !== null ? { role: candidate.role } : {}),
        ...(candidate.name !== null ? { name: candidate.name } : {}),
        tag: candidate.el.tagName,
        kind: 'candidate',
        ancestorKeys: candidate.ancestorKeys,
        samples: candidate.samples,
      });
    }
    return {
      segments: [...segments],
      elements,
      layoutShifts: [...layoutShifts],
    };
  };

  // Current viewport sub-rects for the driver to screenshot + diff (noise).
  const rects = (): TimedRect[] => {
    const out: TimedRect[] = [];
    const t = now();
    const add = (key: string, el: Element): void => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      out.push({ key, t, rect: rectOfDom(r) });
    };
    for (const tr of tracked) add(tr.key, tr.el);
    for (const c of candidates.values()) add(c.key, c.el);
    return out;
  };

  // Tracked elements that currently look occluded — the driver confirms whether
  // they actually paint with a brief visibility:hidden sub-rect diff.
  const paintProbeTargets = (): ProbeRect[] => {
    const out: ProbeRect[] = [];
    for (const tr of tracked) {
      const r = tr.el.getBoundingClientRect();
      // NB: plain hit-test here (no pe:none covers). An opaque pe:none cover fully
      // hides the element, so the per-frame `occluded` flag already drops it — and
      // running the pixel counterfactual on it would spuriously "recover" it
      // (nothing to recover under a full opaque cover). The counterfactual stays
      // for genuinely edge-visible occlusion (a band with visible margins).
      if ((r.width !== 0 || r.height !== 0) && isOccluded(tr.el, r)) {
        out.push({ key: tr.key, rect: rectOfDom(r) });
      }
    }
    return out;
  };

  // Hide/restore a tracked element for the driver's paint probe, marking it
  // `probing` so the sampler ignores the (async, cross-`evaluate`) hidden state.
  const setProbe = (key: string, on: boolean): void => {
    const t = tracked.find((x) => x.key === key);
    if (!t || !(t.el instanceof HTMLElement)) return;
    if (on) {
      probing.add(key);
      priorProbeVisibility.set(key, t.el.style.visibility);
      t.el.style.visibility = 'hidden';
    } else {
      t.el.style.visibility = priorProbeVisibility.get(key) ?? '';
      priorProbeVisibility.delete(key);
      probing.delete(key);
    }
  };

  const dump = (): string => {
    const fragment = currentFragment();
    const audit: AuditMeta = { wholePage: true, discovered, capped };
    const recording: Recording = {
      pixelThreshold: options.pixelThreshold,
      frameBudgetMs: options.frameBudgetMs,
      segments: priorSegments.concat(fragment.segments),
      elements: priorElements.concat(fragment.elements),
      layoutShifts: priorLayoutShifts.concat(fragment.layoutShifts),
      audit,
    };
    return JSON.stringify(recording);
  };

  // Persist the whole accumulated session before the document is torn down, so
  // the next page can merge it (MPA). bfcache restores are not de-duplicated.
  const persist = (): void => {
    const fragment = currentFragment();
    const store = {
      pixelThreshold: options.pixelThreshold,
      frameBudgetMs: options.frameBudgetMs,
      segments: priorSegments.concat(fragment.segments),
      elements: priorElements.concat(fragment.elements),
      layoutShifts: priorLayoutShifts.concat(fragment.layoutShifts),
      pageOrdinal: pageOrdinal + 1,
      elapsed: now(),
    };
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (err) {
      console.warn('[va] could not persist session store', err);
    }
  };

  observeChanges();
  wrapHistory();
  addEventListener('popstate', onPopNavigate);
  addEventListener('pagehide', persist);
  // CSS-driven motion/fade that mutates no attributes still announces itself.
  addEventListener('animationstart', (e) => discover(e.target, true), true);
  addEventListener('transitionrun', (e) => discover(e.target, true), true);
  // Gather now (catches an already-parsed DOM and test harnesses; a no-op on the
  // empty document-start DOM of a real navigation), then again once the DOM has
  // parsed and after load to catch framework-mounted roots. All idempotent.
  gather();
  if (document.readyState === 'loading') {
    addEventListener('DOMContentLoaded', gather, { once: true });
  }
  addEventListener('load', () => requestAnimationFrame(gather), { once: true });
  requestAnimationFrame(tick);

  const api: InstrumentApi = {
    keyframe,
    dump,
    rects,
    paintProbeTargets,
    setProbe,
  };
  Reflect.set(globalThis, '__VA', api);
  return api;
}
