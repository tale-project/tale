// Synchronous surface tests for the instrument, run against a happy-dom document
// with the rAF loop and observers stubbed as no-ops. happy-dom does no layout
// (every getBoundingClientRect is a zero box), so the scored selector finds
// nothing here — the geometry-dependent behaviour (sampling, the keyframe
// counterfactual, the observer callbacks) lives in instrument-live.test.ts, which
// drives a captured rAF/observer harness with real boxes. What stays here: the
// pure helpers (paintsNow, mapShiftSources) and the parts that need no layout —
// media seeding, audit metadata, segmentation, and the MPA store merge.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import { Window } from 'happy-dom';

import {
  ancestorClipKey,
  type ColorStyle,
  hashColor,
  installVisualAspectInstrument,
  mapShiftSources,
  paintsNow,
  type PaintStyle,
} from './instrument';
import { recording, rect, sample, track } from './test-fixtures';

const MARKUP =
  '<div id="card"><div id="row">' +
  '<button id="target">Go</button><span id="sib">x</span>' +
  '</div></div>';

class StubObserver {
  observe(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

const saved = new Map<string, unknown>();
function setGlobal(name: string, value: unknown): void {
  saved.set(name, Reflect.get(globalThis, name));
  Reflect.set(globalThis, name, value);
}

function doc(): Document {
  return Reflect.get(globalThis, 'document');
}

let win: Window;
let origPush: History['pushState'];
let origReplace: History['replaceState'];

const install = () =>
  installVisualAspectInstrument({ pixelThreshold: 1, frameBudgetMs: 16 });

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
  setGlobal('MutationObserver', StubObserver);
  setGlobal('ResizeObserver', StubObserver);
  setGlobal('IntersectionObserver', StubObserver);
  setGlobal('PerformanceObserver', StubObserver);
  // No-op rAF: keep the sampler from looping during the synchronous test.
  setGlobal('requestAnimationFrame', () => 0);
  setGlobal('addEventListener', () => {});
  origPush = win.history.pushState;
  origReplace = win.history.replaceState;
});

// Fresh, untagged DOM, empty store, and pristine History methods per test.
beforeEach(() => {
  doc().body.innerHTML = MARKUP;
  win.sessionStorage.clear();
  win.history.pushState = origPush;
  win.history.replaceState = origReplace;
  // Reset the URL too: a prior test's pushState leaves location elsewhere, and
  // segment identity is now URL-derived — without this, URL-sensitive tests
  // become order-dependent.
  origReplace.call(win.history, {}, '', '/');
});

afterAll(() => {
  for (const [name, value] of saved) Reflect.set(globalThis, name, value);
});

describe('hashColor', () => {
  // Only the fields hashColor reads; each test flips exactly one.
  const BASE: ColorStyle = {
    color: 'rgb(0, 0, 0)',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    backgroundImage: 'none',
    filter: 'none',
    boxShadow: 'none',
    clipPath: 'none',
    borderRadius: '0px',
    borderTopColor: 'rgb(0, 0, 0)',
    borderRightColor: 'rgb(0, 0, 0)',
    borderBottomColor: 'rgb(0, 0, 0)',
    borderLeftColor: 'rgb(0, 0, 0)',
    maskImage: 'none',
    maskPosition: '0% 0%',
    maskSize: 'auto',
    mixBlendMode: 'normal',
    backgroundBlendMode: 'normal',
    isolation: 'auto',
    objectFit: 'fill',
    objectPosition: '50% 50%',
  };

  test('a mask-image/position/size change registers — a mask reveal is not a blind spot (regression)', () => {
    // A mask wipe/shimmer reveals different pixels with an UNCHANGED box, exactly
    // like clip-path. Round 7 clip-mask-reveal-04/05: an animated mask was silent
    // because hashColor omitted mask*, so colorKey never moved → no `color`
    // transition (and, with pixels captured, the churn risked being misread as
    // dithering since the region looked "stable").
    expect(hashColor({ ...BASE, maskImage: 'url("#a")' })).not.toBe(
      hashColor({ ...BASE, maskImage: 'url("#b")' }),
    );
    expect(hashColor({ ...BASE, maskPosition: '0% 0%' })).not.toBe(
      hashColor({ ...BASE, maskPosition: '100% 0%' }),
    );
    expect(hashColor({ ...BASE, maskSize: '0% 100%' })).not.toBe(
      hashColor({ ...BASE, maskSize: '100% 100%' }),
    );
  });

  test('an unchanged style hashes identically; clip-path still registers', () => {
    expect(hashColor(BASE)).toBe(hashColor({ ...BASE }));
    expect(hashColor({ ...BASE, clipPath: 'inset(0px)' })).not.toBe(
      hashColor({ ...BASE, clipPath: 'inset(50%)' }),
    );
  });

  test('a blend-mode / isolation change registers — own animating blend is not misread as dithering (r7 blend-mode-compositing)', () => {
    // A static canvas whose OWN mix-blend-mode flips recomposites different pixels
    // over its backdrop with an unchanged box and style; without blend in the hash
    // its colorKey held constant and the composited churn was flagged as dithering.
    expect(hashColor({ ...BASE, mixBlendMode: 'multiply' })).not.toBe(
      hashColor({ ...BASE, mixBlendMode: 'screen' }),
    );
    expect(hashColor({ ...BASE, backgroundBlendMode: 'multiply' })).not.toBe(
      hashColor({ ...BASE, backgroundBlendMode: 'difference' }),
    );
    expect(hashColor({ ...BASE, isolation: 'isolate' })).not.toBe(
      hashColor(BASE),
    );
  });

  test('an object-fit / object-position change registers — a media pan/fit swap is not misread as dithering (round 8 object-fit-media)', () => {
    // On replaced media, object-position pans (or object-fit cover<->contain) re-crop
    // the painted pixels within an UNCHANGED box; without these in the hash the
    // colorKey held constant, so dithering's isStableRegion treated the panning crop
    // as a static region with bitmap noise → a FALSE `dithering` defect.
    expect(hashColor({ ...BASE, objectPosition: '0% 50%' })).not.toBe(
      hashColor({ ...BASE, objectPosition: '100% 50%' }),
    );
    expect(hashColor({ ...BASE, objectFit: 'cover' })).not.toBe(
      hashColor({ ...BASE, objectFit: 'contain' }),
    );
  });

  test('a border-colour change registers — an animated border on static media is not misread as dithering', () => {
    // The border paints INSIDE the border box (the rect the dithering probe
    // screenshots), so a colour pulse on a static <img>/<canvas>'s border churns
    // the captured pixels; without border colour in the hash the colorKey held
    // constant and isStableRegion would flag the churn as a FALSE `dithering`.
    for (const edge of [
      'borderTopColor',
      'borderRightColor',
      'borderBottomColor',
      'borderLeftColor',
    ] as const) {
      expect(hashColor({ ...BASE, [edge]: 'rgb(255, 0, 0)' })).not.toBe(
        hashColor(BASE),
      );
    }
  });
});

describe('ancestorClipKey (ancestor clip/mask reveal)', () => {
  // getElementById is typed HTMLElement | null; narrow without a cast.
  const need = (id: string): HTMLElement => {
    const e = doc().getElementById(id);
    if (!e) throw new Error(`missing #${id}`);
    return e;
  };

  test("an ancestor's animating clip-path varies a media child's key, so a static canvas it reveals is not misread as dithering (r7 clip-path-reveal-02)", () => {
    // A clip-path on the PARENT wrapper progressively reveals a static canvas: the
    // canvas's OWN computed style and bitmap never change, so without folding the
    // ancestor clip into its colorKey the region reads "stable" and the sub-rect
    // pixel churn is blamed on the canvas as dithering. The ancestor key must move.
    doc().body.innerHTML = '<div id="wrap"><canvas id="cv"></canvas></div>';
    const wrap = need('wrap');
    const cv = need('cv');
    wrap.style.clipPath = 'inset(0 50% 0 0)';
    const a = ancestorClipKey(cv);
    wrap.style.clipPath = 'inset(0 10% 0 0)';
    const b = ancestorClipKey(cv);
    expect(a).not.toBe(b);
  });

  test('a static (or absent) ancestor clip leaves the key constant, so a genuinely self-dithering canvas still fires (true-negative)', () => {
    // Same DOM state → same key: a non-animating ancestor clip contributes a
    // constant term, so a media element whose own bitmap churns is unaffected.
    doc().body.innerHTML =
      '<div id="wrap" style="clip-path: inset(0 30% 0 0)"><canvas id="cv"></canvas></div>';
    expect(ancestorClipKey(need('cv'))).toBe(ancestorClipKey(need('cv')));
    doc().body.innerHTML = '<div><canvas id="bare"></canvas></div>';
    expect(ancestorClipKey(need('bare'))).toBe(ancestorClipKey(need('bare')));
  });

  test('the reveal is detected at any ancestor depth, not just the immediate parent', () => {
    doc().body.innerHTML =
      '<section id="grand"><div id="mid"><canvas id="cv"></canvas></div></section>';
    const grand = need('grand');
    const cv = need('cv');
    grand.style.clipPath = 'inset(0 50% 0 0)';
    const a = ancestorClipKey(cv);
    grand.style.clipPath = 'inset(0 0 0 0)';
    const b = ancestorClipKey(cv);
    expect(a).not.toBe(b);
  });
});

describe('paintsNow', () => {
  // A style that paints nothing; each test flips exactly one signal on.
  const BLANK: PaintStyle = {
    visibility: 'visible',
    display: 'block',
    backgroundImage: 'none',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    borderTopWidth: '0px',
    borderRightWidth: '0px',
    borderBottomWidth: '0px',
    borderLeftWidth: '0px',
    boxShadow: 'none',
    outlineStyle: 'none',
    outlineWidth: '0px',
    backdropFilter: 'none',
  };
  const node = (textContent = '', tagName = 'DIV') => ({
    textContent,
    tagName,
  });

  test('a blank element paints nothing', () => {
    expect(paintsNow(node(), BLANK)).toBe(false);
  });

  test('non-empty text paints', () => {
    expect(paintsNow(node('Hello'), BLANK)).toBe(true);
    expect(paintsNow(node('   '), BLANK)).toBe(false); // whitespace-only does not
  });

  test('a non-transparent background paints', () => {
    expect(
      paintsNow(node(), { ...BLANK, backgroundColor: 'rgb(255, 0, 0)' }),
    ).toBe(true);
    expect(paintsNow(node(), { ...BLANK, backgroundImage: 'url(x.png)' })).toBe(
      true,
    );
  });

  test('a border on ANY edge paints (regression: not just top/left)', () => {
    expect(paintsNow(node(), { ...BLANK, borderTopWidth: '1px' })).toBe(true);
    expect(paintsNow(node(), { ...BLANK, borderRightWidth: '1px' })).toBe(true);
    expect(paintsNow(node(), { ...BLANK, borderBottomWidth: '2px' })).toBe(
      true,
    );
    expect(paintsNow(node(), { ...BLANK, borderLeftWidth: '1px' })).toBe(true);
  });

  test('a box-shadow paints', () => {
    expect(paintsNow(node(), { ...BLANK, boxShadow: '0 0 4px black' })).toBe(
      true,
    );
  });

  test('an outline paints (regression); a none/0-width outline does not', () => {
    expect(
      paintsNow(node(), {
        ...BLANK,
        outlineStyle: 'solid',
        outlineWidth: '2px',
      }),
    ).toBe(true);
    expect(
      paintsNow(node(), {
        ...BLANK,
        outlineStyle: 'none',
        outlineWidth: '2px',
      }),
    ).toBe(false);
    expect(
      paintsNow(node(), {
        ...BLANK,
        outlineStyle: 'solid',
        outlineWidth: '0px',
      }),
    ).toBe(false);
  });

  test('a backdrop-filter paints (regression)', () => {
    expect(paintsNow(node(), { ...BLANK, backdropFilter: 'blur(4px)' })).toBe(
      true,
    );
  });

  test('replaced media always paints', () => {
    expect(paintsNow(node('', 'IMG'), BLANK)).toBe(true);
    expect(paintsNow(node('', 'CANVAS'), BLANK)).toBe(true);
  });

  test('a namespaced inline <svg> (lowercase tagName) paints (regression)', () => {
    // A real <svg> reports the lowercase, namespaced 'svg' — a raw uppercase-set
    // lookup missed it, dropping a churning SVG from the audit entirely.
    expect(paintsNow(node('', 'svg'), BLANK)).toBe(true);
  });

  test('hidden or display:none never paints, whatever else is set', () => {
    expect(paintsNow(node('Hello'), { ...BLANK, visibility: 'hidden' })).toBe(
      false,
    );
    expect(paintsNow(node('Hello'), { ...BLANK, display: 'none' })).toBe(false);
  });
});

describe('auto-detect install', () => {
  test('seeds replaced media (canvas/img) as tracked elements', () => {
    doc().body.innerHTML =
      '<canvas id="cv"></canvas><img id="im" alt="" /><p id="txt">hi</p>';
    const dump = JSON.parse(install().dump());
    const selectors = dump.elements
      .filter((e: { kind: string }) => e.kind === 'tracked')
      .map((e: { selector: string }) => e.selector);
    expect(selectors).toContain('#cv');
    expect(selectors).toContain('#im');
    // A plain paragraph isn't seeded — and with no layout it isn't scored in.
    expect(selectors).not.toContain('#txt');
  });

  test('tags discovered media and always reports audit metadata in the dump', () => {
    doc().body.innerHTML = '<canvas id="cv"></canvas>';
    const dump = JSON.parse(install().dump());
    expect(doc().querySelector('#cv')?.getAttribute('data-testid')).toBe(
      'va-1',
    );
    expect(dump.audit).toEqual({
      wholePage: true,
      discovered: 1,
      capped: false,
    });
  });

  test('exposes the control surface on globalThis', () => {
    install();
    expect(Reflect.get(globalThis, '__VA')).toBeDefined();
  });
});

describe('SPA segmentation', () => {
  test('pushState opens a new segment', () => {
    const api = install();
    win.history.pushState({}, '', '/next');
    const dump = JSON.parse(api.dump());
    expect(dump.segments.length).toBe(2);
    expect(dump.segments[1].url).toContain('/next');
  });

  // Regression: a popstate whose URL differs from the current view ONLY by the
  // #fragment (a `location.hash` assignment or a same-page `<a href="#x">`
  // click) is scroll-to-anchor on the SAME view, not a route change, so it must
  // NOT open a segment. A popstate that changes pathname/search still segments.
  test('popstate for a fragment-only change does not segment; a real route does', () => {
    const handlers = new Map<string, () => void>();
    const savedAdd = Reflect.get(globalThis, 'addEventListener');
    Reflect.set(
      globalThis,
      'addEventListener',
      (type: string, fn: () => void) => handlers.set(type, fn),
    );
    let api: ReturnType<typeof install>;
    try {
      api = install();
    } finally {
      Reflect.set(globalThis, 'addEventListener', savedAdd);
    }
    const firePopstate = (): void => {
      const fn = handlers.get('popstate');
      if (!fn) throw new Error('popstate handler was not registered');
      fn();
    };

    // The install above captured the base view ('/') as segment 0. Move the URL
    // via the UNWRAPPED pushState so only the popstate handler (not the History
    // wrapper) decides whether to segment.
    origPush.call(win.history, {}, '', '/#section');
    firePopstate();
    expect(JSON.parse(api.dump()).segments.length).toBe(1); // fragment-only: no segment

    origPush.call(win.history, {}, '', '/account');
    firePopstate();
    const dump = JSON.parse(api.dump());
    expect(dump.segments.length).toBe(2); // pathname changed: real route
    expect(dump.segments[1].url).toContain('/account');
  });
});

describe('MPA accumulation', () => {
  test('merges a prior-page store, prefixes keys, continues segments', () => {
    const priorEl = track({
      key: 'va-1',
      selector: '#old',
      samples: [sample({ t: 0, frame: 0, screen: rect(0, 10, 10, 0) })],
    });
    const store = {
      ...recording([priorEl]),
      pageOrdinal: 1,
      elapsed: 100,
    };
    win.sessionStorage.setItem('__va_store', JSON.stringify(store));

    // A canvas is seeded on the fresh page regardless of layout, so there is a
    // freshly-tracked element to check the page-ordinal key prefix on.
    doc().body.innerHTML = '<canvas id="cv"></canvas>';
    const dump = JSON.parse(install().dump());
    expect(
      dump.elements.some((e: { selector: string }) => e.selector === '#old'),
    ).toBe(true);
    const fresh = dump.elements.find(
      (e: { kind: string; selector: string }) =>
        e.kind === 'tracked' && e.selector === '#cv',
    );
    expect(fresh.testid).toBe('p1-va-1'); // page-ordinal prefix keeps keys unique
    expect(dump.segments.length).toBe(2);
    expect(dump.segments[1].index).toBe(1); // continues global numbering
  });
});

describe('mapShiftSources', () => {
  test('resolves moved nodes to keys and converts rects', () => {
    const el = doc().querySelector('#target');
    const sources = [
      {
        node: el,
        previousRect: { top: 0, right: 10, bottom: 10, left: 0 },
        currentRect: { top: 5, right: 15, bottom: 15, left: 5 },
      },
    ];
    const out = mapShiftSources(sources, (n) => (n === el ? 'k1' : null));
    expect(out[0]?.key).toBe('k1');
    expect(out[0]?.currentRect.top).toBe(5);
  });

  test('a null node yields a null key', () => {
    const out = mapShiftSources(
      [
        {
          node: null,
          previousRect: { top: 0, right: 0, bottom: 0, left: 0 },
          currentRect: { top: 0, right: 0, bottom: 0, left: 0 },
        },
      ],
      () => 'x',
    );
    expect(out[0]?.key).toBeNull();
  });
});
