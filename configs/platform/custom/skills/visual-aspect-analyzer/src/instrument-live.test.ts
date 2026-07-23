// Live-harness tests for the in-page instrument. Unlike instrument.test.ts
// (which stubs the rAF loop and the observers as no-ops to keep the synchronous
// surface tests simple), this harness *captures* the rAF callback and every
// observer/event callback and drives them by hand, with elements given non-zero
// geometry. That exercises the parts that only run inside a live browser frame:
// the sampler tick, sampleElement/pushSample, the four observer callbacks, the
// layout-shift mapper, rects()/paintProbeTargets(), the keyframe move-detector,
// and the pagehide persist.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import { Window } from 'happy-dom';

import { installVisualAspectInstrument } from './instrument';

const MARKUP =
  '<div id="card"><div id="row">' +
  '<button id="target">Go</button><span id="sib">x</span>' +
  '</div></div>';

type Box = { top: number; right: number; bottom: number; left: number };

// Minimal structural shapes for the records/entries the instrument actually
// reads — typed so the harness needs no `any`/`as`.
interface FakeMutationRecord {
  type: 'attributes' | 'childList';
  target: Node;
  attributeName: string | null;
  addedNodes: readonly Node[];
}
type MutationCb = (records: readonly FakeMutationRecord[]) => void;
interface FakeResizeEntry {
  target: Element;
}
type ResizeCb = (entries: readonly FakeResizeEntry[]) => void;
interface FakeIntersectionEntry {
  target: Element;
  isIntersecting: boolean;
}
type IntersectionCb = (entries: readonly FakeIntersectionEntry[]) => void;
interface FakeShiftSource {
  node: Node | null;
  previousRect: Box;
  currentRect: Box;
}
interface FakeShiftEntry {
  value: number;
  sources: readonly FakeShiftSource[];
  hadRecentInput: boolean;
}
interface FakeShiftList {
  getEntries(): readonly FakeShiftEntry[];
}
type PerfCb = (list: FakeShiftList) => void;
interface FakeEvent {
  target: EventTarget | null;
}
type Listener = (e: FakeEvent) => void;

// Captured callbacks — reset per test, populated by install().
let mutationCb: MutationCb | null = null;
let resizeCb: ResizeCb | null = null;
let intersectionCb: IntersectionCb | null = null;
let perfCb: PerfCb | null = null;
let rafCb: (() => void) | null = null;
let listeners = new Map<string, Listener[]>();

class RecMutationObserver {
  constructor(cb: MutationCb) {
    mutationCb = cb;
  }
  observe(
    _target: Node,
    _options: { subtree?: boolean; attributes?: boolean; childList?: boolean },
  ): void {}
  disconnect(): void {}
  takeRecords(): readonly FakeMutationRecord[] {
    return [];
  }
}
class RecResizeObserver {
  constructor(cb: ResizeCb) {
    resizeCb = cb;
  }
  observe(_target: Element): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
}
class RecIntersectionObserver {
  constructor(cb: IntersectionCb) {
    intersectionCb = cb;
  }
  observe(_target: Element): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
}
class RecPerformanceObserver {
  constructor(cb: PerfCb) {
    perfCb = cb;
  }
  observe(_options: { type: string; buffered: boolean }): void {}
  disconnect(): void {}
}

const saved = new Map<string, unknown>();
function setGlobal(name: string, value: unknown): void {
  saved.set(name, Reflect.get(globalThis, name));
  Reflect.set(globalThis, name, value);
}

// Read the (happy-dom) document back through globalThis so it carries the lib
// `Document` type — the no-`as`/no-`any` laundering the other tests use. `win` is
// still used directly for happy-dom-only surfaces (prototypes, DOMRect).
function doc(): Document {
  return Reflect.get(globalThis, 'document');
}

let win: Window;
let origPush: History['pushState'];
let origReplace: History['replaceState'];

const OPTS = { pixelThreshold: 1, frameBudgetMs: 16 };
// Auto-detect is the only mode now; with the non-zero geometry below, the scored
// selector tracks the interactive `#target` button (the legacy `#target` focus).
const install = () => installVisualAspectInstrument(OPTS);
const installAudit = () => installVisualAspectInstrument(OPTS);

function pump(): void {
  const cb = rafCb;
  rafCb = null;
  if (cb) cb();
}

function fire(type: string, target: EventTarget | null = null): void {
  for (const cb of listeners.get(type) ?? []) cb({ target });
}

// Non-zero geometry, since happy-dom does no layout. An element whose own style
// is display:none reads as a zero box (so the sampler records a hidden frame); a
// candidate measured while ANOTHER element is hidden reads as moved (so the
// keyframe counterfactual detects a real shift).
function setGeometry(): void {
  function gbcr(this: Element) {
    const styleAttr = this.getAttribute('style') ?? '';
    if (styleAttr.includes('display: none')) return new win.DOMRect(0, 0, 0, 0);
    const otherHidden = Array.from(doc().querySelectorAll('[style]')).some(
      (e) =>
        e !== this && (e.getAttribute('style') ?? '').includes('display: none'),
    );
    return new win.DOMRect(10, otherHidden ? 200 : 20, 100, 50);
  }
  Reflect.set(win.Element.prototype, 'getBoundingClientRect', gbcr);
  Reflect.set(win.HTMLElement.prototype, 'getBoundingClientRect', gbcr);
  // A non-null, non-containing topmost element makes isOccluded resolve to true.
  Reflect.set(doc(), 'elementFromPoint', () => doc().body);
}

beforeAll(() => {
  win = new Window({ url: 'https://example.test/' });
  setGlobal('window', win);
  setGlobal('document', win.document);
  setGlobal('location', win.location);
  setGlobal('history', win.history);
  setGlobal('sessionStorage', win.sessionStorage);
  setGlobal('getComputedStyle', win.getComputedStyle.bind(win));
  setGlobal('Element', win.Element);
  setGlobal('HTMLElement', win.HTMLElement);
  setGlobal('MutationObserver', RecMutationObserver);
  setGlobal('ResizeObserver', RecResizeObserver);
  setGlobal('IntersectionObserver', RecIntersectionObserver);
  setGlobal('PerformanceObserver', RecPerformanceObserver);
  setGlobal('requestAnimationFrame', (cb: (t: number) => void): number => {
    rafCb = () => cb(0);
    return 0;
  });
  setGlobal('addEventListener', (type: string, cb: Listener): void => {
    const arr = listeners.get(type) ?? [];
    arr.push(cb);
    listeners.set(type, arr);
  });
  setGeometry();
  origPush = win.history.pushState;
  origReplace = win.history.replaceState;
});

beforeEach(() => {
  doc().body.innerHTML = MARKUP;
  win.sessionStorage.clear();
  win.history.pushState = origPush;
  win.history.replaceState = origReplace;
  mutationCb = null;
  resizeCb = null;
  intersectionCb = null;
  perfCb = null;
  rafCb = null;
  listeners = new Map();
});

afterAll(() => {
  for (const [name, value] of saved) Reflect.set(globalThis, name, value);
});

function dumpOf(api: { dump: () => string }): {
  elements: {
    selector: string;
    kind: string;
    ancestorKeys: string[];
    samples: { visible: boolean; occluded: boolean; inViewport: boolean }[];
  }[];
  layoutShifts: { value: number; sources: { key: string | null }[] }[];
  audit?: { discovered: number; capped: boolean };
} {
  return JSON.parse(api.dump());
}

describe('rAF sampler', () => {
  test('a pumped frame samples tracked and candidate elements', () => {
    const api = install();
    pump();
    const els = dumpOf(api).elements;
    const target = els.find((e) => e.selector === '#target');
    expect(target?.samples.length).toBeGreaterThan(0);
    // toRect/hashColor/isOccluded all ran on a real (non-zero) box.
    expect(target?.samples[0]?.visible).toBe(true);
    expect(target?.samples[0]?.occluded).toBe(true); // elementFromPoint → body
    // A neighbour candidate is sampled in the same frame.
    const candidate = els.find((e) => e.kind === 'candidate');
    expect(candidate?.samples.length).toBeGreaterThan(0);
  });

  test('a visible element going display:none records one hidden frame', () => {
    const api = install();
    pump(); // first frame: visible
    const target = doc().querySelector('#target');
    target?.setAttribute('style', 'display: none');
    pump(); // second frame: zero box → hidden frame reusing last geometry
    const samples = dumpOf(api).elements.find(
      (e) => e.selector === '#target',
    )?.samples;
    expect(samples?.length).toBe(2);
    expect(samples?.[0]?.visible).toBe(true);
    expect(samples?.[1]?.visible).toBe(false); // the recorded hidden frame
  });

  test('the sampler skips an element hidden by the paint probe', () => {
    const api = install();
    api.setProbe('va-1', true); // probing → skipped by the tick
    pump();
    api.setProbe('va-1', false);
    const samples = dumpOf(api).elements.find(
      (e) => e.selector === '#target',
    )?.samples;
    expect(samples?.length ?? 0).toBe(0); // never sampled while probing
  });
});

describe('observer callbacks', () => {
  test('a mutation marks the touched tracked element changed', () => {
    const api = install();
    const target = doc().querySelector('#target');
    if (!target || !mutationCb) throw new Error('no target/observer');
    mutationCb([
      {
        type: 'attributes',
        target,
        attributeName: 'class',
        addedNodes: [],
      },
    ]);
    // A changed element is excluded from the keyframe counterfactual; an
    // unchanged one is not — so its probe never gets set.
    api.keyframe();
    const probed = dumpOf(api).elements.find(
      (e: { selector: string; layoutProbe?: unknown }) =>
        e.selector === '#target' && 'layoutProbe' in e,
    );
    expect(probed).toBeUndefined();
  });

  test('a resize marks the element changed; intersection updates inViewport', () => {
    const api = install();
    const target = doc().querySelector('#target');
    if (!target || !resizeCb || !intersectionCb)
      throw new Error('no target/observers');
    resizeCb([{ target }]);
    intersectionCb([{ target, isIntersecting: false }]);
    pump();
    const sample = dumpOf(api).elements.find((e) => e.selector === '#target')
      ?.samples[0];
    expect(sample?.inViewport).toBe(false); // observer value, not the manual fallback
  });

  test('a layout-shift entry is recorded and its source resolved to a key', () => {
    const api = install();
    const sib = doc().querySelector('#sib');
    if (!sib || !perfCb) throw new Error('no source/observer');
    perfCb({
      getEntries: () => [
        {
          value: 0.25,
          hadRecentInput: false,
          sources: [
            {
              node: sib,
              previousRect: { top: 0, right: 10, bottom: 10, left: 0 },
              currentRect: { top: 5, right: 15, bottom: 15, left: 5 },
            },
          ],
        },
      ],
    });
    const shifts = dumpOf(api).layoutShifts;
    expect(shifts.length).toBe(1);
    expect(shifts[0]?.value).toBe(0.25);
    expect(shifts[0]?.sources[0]?.key).not.toBeNull(); // #sib resolved to a candidate
  });

  test('a layout-shift with a non-element source yields a null key', () => {
    const api = install();
    if (!perfCb) throw new Error('no observer');
    const textNode = doc().createTextNode('x');
    perfCb({
      getEntries: () => [
        {
          value: 0.1,
          hadRecentInput: true,
          sources: [
            {
              node: textNode,
              previousRect: { top: 0, right: 0, bottom: 0, left: 0 },
              currentRect: { top: 1, right: 1, bottom: 1, left: 1 },
            },
          ],
        },
      ],
    });
    expect(dumpOf(api).layoutShifts[0]?.sources[0]?.key).toBeNull();
  });
});

describe('audit-mode discovery via observers', () => {
  test('discovers attribute and child-list targets, skipping our own tag write', () => {
    doc().body.innerHTML =
      '<div id="wrap"><section><span class="leaf">x</span></section></div>';
    const api = installAudit();
    const leaf = doc().querySelector('.leaf');
    const ignored = doc().querySelector('#wrap');
    const canvas = doc().createElement('canvas');
    doc().body.appendChild(canvas);
    if (!leaf || !ignored || !mutationCb) throw new Error('no nodes/observer');
    mutationCb([
      {
        type: 'attributes',
        target: leaf,
        attributeName: 'class',
        addedNodes: [],
      },
      // Our own data-testid write is not a real change — skipped.
      {
        type: 'attributes',
        target: ignored,
        attributeName: 'data-testid',
        addedNodes: [],
      },
      {
        type: 'childList',
        target: doc().body,
        attributeName: null,
        addedNodes: [canvas],
      },
    ]);
    const selectors = dumpOf(api)
      .elements.filter((e) => e.kind === 'tracked')
      .map((e) => e.selector);
    // cssPath anchored at the nearest id'd ancestor (#wrap), not a full path.
    expect(selectors.some((s) => s.startsWith('#wrap'))).toBe(true);
    expect(selectors.some((s) => s.startsWith('canvas'))).toBe(true); // media discovered
  });

  test('an ancestor-walk candidate carries its OWN ancestorKeys (regression)', () => {
    // Plain (non-component) wrappers: they become candidates ONLY via the
    // ancestor walk of the discovered leaf, never via the scored selection.
    doc().body.innerHTML =
      '<div id="wrap"><div id="mid"><span class="leaf">x</span></div></div>';
    const api = installAudit();
    const leaf = doc().querySelector('.leaf');
    if (!leaf || !mutationCb) throw new Error('no nodes/observer');
    // Discovering the leaf registers #mid as a candidate while walking its
    // ancestors. That candidate must record its OWN ancestor (#wrap) — without
    // it the out-of-flow attribution in impact.ts can never reach a positioned
    // ancestor, so an absolute child riding a moving ancestor is dropped.
    mutationCb([
      {
        type: 'attributes',
        target: leaf,
        attributeName: 'class',
        addedNodes: [],
      },
    ]);
    const mid = dumpOf(api).elements.find(
      (e) => e.kind === 'candidate' && e.selector === '#mid',
    );
    expect(mid).toBeDefined();
    expect((mid?.ancestorKeys ?? []).length).toBeGreaterThan(0);
  });

  test('generic discovery is capped, and the dump flags it', () => {
    const api = installAudit();
    if (!mutationCb) throw new Error('no observer');
    const records: FakeMutationRecord[] = [];
    for (let i = 0; i < 90; i++) {
      const div = doc().createElement('div');
      div.id = `g${i}`;
      doc().body.appendChild(div);
      records.push({
        type: 'attributes',
        target: div,
        attributeName: 'class',
        addedNodes: [],
      });
    }
    mutationCb(records);
    const audit = dumpOf(api).audit;
    expect(audit?.capped).toBe(true);
    expect(audit?.discovered).toBe(80); // AUDIT_DISCOVERY_CAP
  });

  test('a layout-shift source is promoted to a tracked survivor in audit mode', () => {
    doc().body.innerHTML = '<p id="mover">x</p>';
    const api = installAudit();
    const mover = doc().querySelector('#mover');
    if (!mover || !perfCb) throw new Error('no source/observer');
    perfCb({
      getEntries: () => [
        {
          value: 0.3,
          hadRecentInput: false,
          sources: [
            {
              node: mover,
              previousRect: { top: 0, right: 10, bottom: 10, left: 0 },
              currentRect: { top: 50, right: 10, bottom: 60, left: 0 },
            },
          ],
        },
      ],
    });
    const tracked = dumpOf(api).elements.filter((e) => e.kind === 'tracked');
    expect(tracked.some((e) => e.selector === '#mover')).toBe(true);
  });
});

describe('driver surface', () => {
  test('rects() returns a stamped sub-rect for each non-zero element', () => {
    const api = install();
    const rects = api.rects();
    expect(rects.length).toBeGreaterThan(0);
    for (const r of rects) {
      expect(typeof r.t).toBe('number');
      expect(r.rect.right - r.rect.left).toBe(100);
    }
  });

  test('paintProbeTargets() lists the tracked elements that look occluded', () => {
    const api = install();
    const targets = api.paintProbeTargets();
    // elementFromPoint → body, so the tracked #target reads as occluded.
    expect(targets.some((t) => t.key === 'va-1')).toBe(true);
  });

  test('keyframe detects a real move when a candidate shifts under the toggle', () => {
    const api = install();
    api.keyframe();
    const probed = dumpOf(api).elements.find(
      (e: { selector: string; layoutProbe?: { affects: boolean } }) =>
        e.selector === '#target' && e.layoutProbe !== undefined,
    );
    // Hiding #target shifts the candidate box (gbcr), so the probe sees impact.
    expect(
      (probed as { layoutProbe?: { affects: boolean } } | undefined)
        ?.layoutProbe?.affects,
    ).toBe(true);
  });
});

describe('persistence (MPA)', () => {
  test('pagehide persists the accumulated session to sessionStorage', () => {
    install();
    pump();
    fire('pagehide');
    const raw = win.sessionStorage.getItem('__va_store');
    expect(raw).not.toBeNull();
    const store = JSON.parse(raw ?? '{}');
    expect(store.pageOrdinal).toBe(1);
    expect(store.elements.length).toBeGreaterThan(0);
  });

  test('a failing sessionStorage.setItem is swallowed, not thrown', () => {
    install();
    // Swap the GLOBAL storage (persist reads the free `sessionStorage`), since
    // happy-dom's Storage method is not overridable on the instance.
    const realStorage = Reflect.get(globalThis, 'sessionStorage');
    Reflect.set(globalThis, 'sessionStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    });
    expect(() => fire('pagehide')).not.toThrow();
    Reflect.set(globalThis, 'sessionStorage', realStorage);
  });
});

describe('install-time guards', () => {
  test('validates a pre-installed listener registry (the hasFn guard)', () => {
    // A registry with `has` but no `typesFor` exercises both hasFn outcomes:
    // 'has' resolves to a function (true), 'typesFor' is absent (false).
    Reflect.set(globalThis, '__VA_LISTENERS', { has: () => false });
    const api = install();
    expect(JSON.parse(api.dump()).segments.length).toBe(1); // installed cleanly
    Reflect.deleteProperty(globalThis, '__VA_LISTENERS');
  });

  test('a component-selection failure is swallowed (runSelect catch)', () => {
    // window.innerWidth is read inside runSelect's try; throwing there drives the
    // catch — install must still complete and dump.
    const realWindow = Reflect.get(globalThis, 'window');
    Reflect.set(globalThis, 'window', {
      get innerWidth(): number {
        throw new Error('no layout engine');
      },
      innerHeight: 0,
    });
    let api: ReturnType<typeof install> | null = null;
    expect(() => {
      api = install();
    }).not.toThrow();
    Reflect.set(globalThis, 'window', realWindow);
    expect(api).not.toBeNull();
  });
});

describe('store recovery', () => {
  test('a non-object store is ignored', () => {
    win.sessionStorage.setItem('__va_store', '[]'); // array, not an object
    const api = install();
    expect(dumpOf(api).elements.every((e) => e.selector !== '#old')).toBe(true);
  });

  test('a malformed store is ignored without throwing', () => {
    win.sessionStorage.setItem('__va_store', '{ not json');
    expect(() => install()).not.toThrow();
  });
});

describe('popstate navigation', () => {
  test('a same-view popstate does not open a new segment', () => {
    // location.href is unchanged since install, so the view key matches and the
    // implicit popstate reads as scroll-to-anchor, not a route change.
    const api = install();
    fire('popstate');
    expect(JSON.parse(api.dump()).segments.length).toBe(1);
  });

  test('an unparseable navigation url is tolerated (viewKey catch)', () => {
    const api = install();
    const realLocation = Reflect.get(globalThis, 'location');
    Reflect.set(globalThis, 'location', { href: 'http://' }); // new URL throws
    expect(() => fire('popstate')).not.toThrow();
    Reflect.set(globalThis, 'location', realLocation);
    // The unparseable href differs from the prior view → a new segment opens.
    expect(JSON.parse(api.dump()).segments.length).toBe(2);
  });
});

describe('install epilogue listeners', () => {
  test('animationstart / transitionrun promote their target to tracked', () => {
    const api = install();
    const sib = doc().querySelector('#sib');
    if (!sib) throw new Error('no #sib');
    fire('animationstart', sib);
    fire('transitionrun', sib);
    const tracked = JSON.parse(api.dump()).elements.filter(
      (e: { kind: string }) => e.kind === 'tracked',
    );
    expect(
      tracked.some((e: { selector: string }) => e.selector === '#sib'),
    ).toBe(true);
  });

  test('the load event schedules a deferred gather (no throw)', () => {
    install();
    // The listener is `() => requestAnimationFrame(gather)`; firing it schedules
    // a gather via the captured rAF without running it synchronously.
    expect(() => fire('load')).not.toThrow();
  });

  test('a still-loading document registers a DOMContentLoaded gather', () => {
    // happy-dom reports a complete document; force the loading branch so the
    // deferred-gather registration runs.
    Object.defineProperty(doc(), 'readyState', {
      value: 'loading',
      configurable: true,
    });
    const api = install();
    Object.defineProperty(doc(), 'readyState', {
      value: 'complete',
      configurable: true,
    });
    expect(() => fire('DOMContentLoaded')).not.toThrow(); // the registered gather
    expect(JSON.parse(api.dump()).segments.length).toBe(1);
  });
});
