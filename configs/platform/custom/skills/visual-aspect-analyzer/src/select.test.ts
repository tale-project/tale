import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import { Window } from 'happy-dom';

import { nullListenerRegistry } from './listeners';
import {
  allocateBudget,
  type CandidateFeatures,
  componentRootDedup,
  DEPTH_FREE,
  DEPTH_SPAN,
  SCORE_WEIGHTS,
  scoreCandidate,
  type ScoredRect,
  selectComponents,
} from './select';

// A candidate with no signal; each test flips exactly one feature (mirrors the
// paintsNow BLANK pattern) so a weight change is caught by the matching test.
const BLANK: CandidateFeatures = {
  isLandmark: false,
  isInteractive: false,
  hasEventListener: false,
  isHeading: false,
  isMedia: false,
  componentNameHint: false,
  repeatedStructureMember: false,
  boxness: 0,
  inInitialViewport: false,
  areaNorm: 0,
  coversViewport: false,
  textDensity: 0,
  highZIndex: false,
  tinyNonInteractive: false,
  depth: 0,
};

function sr(o: Partial<ScoredRect> & { id: number }): ScoredRect {
  return {
    id: o.id,
    area: o.area ?? 100,
    score: o.score ?? 1,
    semanticRank: o.semanticRank ?? 0,
    ancestorIds: o.ancestorIds ?? [],
    forced: o.forced ?? false,
  };
}

describe('scoreCandidate', () => {
  test('a blank candidate scores zero', () => {
    expect(scoreCandidate(BLANK)).toBe(0);
  });

  test('each boolean feature adds exactly its weight', () => {
    const cases: [keyof CandidateFeatures, number][] = [
      ['isLandmark', SCORE_WEIGHTS.isLandmark],
      ['isInteractive', SCORE_WEIGHTS.isInteractive],
      ['hasEventListener', SCORE_WEIGHTS.hasEventListener],
      ['isHeading', SCORE_WEIGHTS.isHeading],
      ['isMedia', SCORE_WEIGHTS.isMedia],
      ['componentNameHint', SCORE_WEIGHTS.componentNameHint],
      ['repeatedStructureMember', SCORE_WEIGHTS.repeatedStructureMember],
      ['inInitialViewport', SCORE_WEIGHTS.inInitialViewport],
      ['highZIndex', SCORE_WEIGHTS.highZIndex],
    ];
    for (const [key, weight] of cases) {
      expect(scoreCandidate({ ...BLANK, [key]: true })).toBeCloseTo(weight, 5);
    }
  });

  test('continuous features scale by their weight at 1.0', () => {
    expect(scoreCandidate({ ...BLANK, boxness: 1 })).toBeCloseTo(
      SCORE_WEIGHTS.boxness,
      5,
    );
    expect(scoreCandidate({ ...BLANK, areaNorm: 1 })).toBeCloseTo(
      SCORE_WEIGHTS.areaNorm,
      5,
    );
    expect(scoreCandidate({ ...BLANK, textDensity: 1 })).toBeCloseTo(
      SCORE_WEIGHTS.textDensity,
      5,
    );
  });

  test('penalties drive the score negative', () => {
    expect(scoreCandidate({ ...BLANK, coversViewport: true })).toBeCloseTo(
      SCORE_WEIGHTS.coversViewport,
      5,
    );
    expect(scoreCandidate({ ...BLANK, tinyNonInteractive: true })).toBeCloseTo(
      SCORE_WEIGHTS.tinyNonInteractive,
      5,
    );
  });

  test('the nesting penalty ramps from DEPTH_FREE to DEPTH_FREE+DEPTH_SPAN', () => {
    expect(scoreCandidate({ ...BLANK, depth: DEPTH_FREE })).toBe(0);
    expect(
      scoreCandidate({ ...BLANK, depth: DEPTH_FREE + DEPTH_SPAN }),
    ).toBeCloseTo(SCORE_WEIGHTS.deeplyNested, 5);
    // Half-way through the span is half the penalty.
    expect(
      scoreCandidate({ ...BLANK, depth: DEPTH_FREE + DEPTH_SPAN / 2 }),
    ).toBeCloseTo(SCORE_WEIGHTS.deeplyNested / 2, 5);
  });

  test('a landmark hero outscores a deeply nested generic div', () => {
    const hero = scoreCandidate({
      ...BLANK,
      isLandmark: true,
      isInteractive: true,
      boxness: 1,
      inInitialViewport: true,
    });
    const generic = scoreCandidate({ ...BLANK, depth: 20, textDensity: 0.2 });
    expect(hero).toBeGreaterThan(generic);
  });
});

describe('componentRootDedup', () => {
  test('collapses a same-size wrapper to its richer ancestor (snap up)', () => {
    // child (anonymous) inside a boxed/landmark ancestor of ~the same size.
    const cands = [
      sr({ id: 0, area: 100, semanticRank: 3, score: 5 }),
      sr({ id: 1, area: 90, semanticRank: 0, score: 1, ancestorIds: [0] }),
    ];
    expect([...componentRootDedup(cands)]).toEqual([0]);
  });

  test('collapses a same-size anonymous wrapper to its richer child', () => {
    const cands = [
      sr({ id: 0, area: 100, semanticRank: 0, score: 1 }), // anonymous wrapper
      sr({ id: 1, area: 95, semanticRank: 2, score: 4, ancestorIds: [0] }),
    ];
    expect([...componentRootDedup(cands)]).toEqual([1]);
  });

  test('keeps both when the ancestor is a genuinely larger container', () => {
    const cands = [
      sr({ id: 0, area: 1000, semanticRank: 3 }), // section
      sr({ id: 1, area: 100, semanticRank: 1, ancestorIds: [0] }), // card
    ];
    expect([...componentRootDedup(cands)].sort()).toEqual([0, 1]);
  });

  test('never drops forced media even when it loses the comparison', () => {
    const cands = [
      sr({ id: 0, area: 100, semanticRank: 3, score: 5 }),
      sr({ id: 1, area: 90, semanticRank: 0, forced: true, ancestorIds: [0] }),
    ];
    expect([...componentRootDedup(cands)].sort()).toEqual([0, 1]);
  });
});

describe('allocateBudget', () => {
  test('keeps the highest-scoring within budget and flags the overflow', () => {
    const cands = [
      sr({ id: 0, score: 5 }),
      sr({ id: 1, score: 3 }),
      sr({ id: 2, score: 1 }),
    ];
    const { selected, capped } = allocateBudget(cands, 2);
    expect([...selected].sort()).toEqual([0, 1]);
    expect(capped).toBe(true);
  });

  test('always selects forced media, exempt from the static budget', () => {
    const cands = [
      sr({ id: 0, forced: true, score: 0 }),
      sr({ id: 1, forced: true, score: 0 }),
    ];
    const { selected, capped } = allocateBudget(cands, 0);
    expect([...selected].sort()).toEqual([0, 1]);
    expect(capped).toBe(false); // no non-forced candidates competed
  });
});

// ---------------------------------------------------------------------------
// DOM-driven coverage for `selectComponents`. The pure pipeline above is unit-
// tested directly; what is left is the thin DOM layer — in particular the
// `boxness` branches that only fire when an element actually carries a border /
// solid background / padding. happy-dom does no layout (every
// getBoundingClientRect is a zero box, so every candidate is dropped before it
// can be styled-scored), so this harness gives elements a non-zero box exactly
// like instrument-live.test.ts, then reads real inline styles back through
// happy-dom's getComputedStyle to drive `boxness`.
// ---------------------------------------------------------------------------

// Harness-interop globals are saved/restored exactly like instrument.test.ts;
// `unknown` here is the documented harness exception, mirrored from that file.
const saved = new Map<string, unknown>();
function setGlobal(name: string, value: unknown): void {
  saved.set(name, Reflect.get(globalThis, name));
  Reflect.set(globalThis, name, value);
}

// Read the happy-dom document back through globalThis so it carries the lib
// `Document` type (no `as`), the same laundering the sibling DOM tests use.
function doc(): Document {
  return Reflect.get(globalThis, 'document');
}

let win: Window;

// happy-dom does no layout; hand every element a fixed non-zero box so the
// area-zero guard in selectComponents lets the candidate through to scoring.
function setGeometry(): void {
  function gbcr(this: Element) {
    return new win.DOMRect(10, 110, 60, 10); // x=10 y=10 → 100x50 box
  }
  Reflect.set(win.Element.prototype, 'getBoundingClientRect', gbcr);
  Reflect.set(win.HTMLElement.prototype, 'getBoundingClientRect', gbcr);
}

const VP = { width: 1280, height: 800 };

function select(): { elements: Element[]; capped: boolean } {
  return selectComponents(doc(), nullListenerRegistry(), VP);
}

function selectorsOf(els: readonly Element[]): string[] {
  return els.map((el) => `#${el.id}`);
}

beforeAll(() => {
  win = new Window({ url: 'https://example.test/' });
  setGlobal('window', win);
  setGlobal('document', win.document);
  setGlobal('getComputedStyle', win.getComputedStyle.bind(win));
  setGlobal('Element', win.Element);
  setGlobal('HTMLElement', win.HTMLElement);
  setGeometry();
});

beforeEach(() => {
  doc().body.innerHTML = '';
});

afterAll(() => {
  for (const [name, value] of saved) Reflect.set(globalThis, name, value);
});

describe('selectComponents — boxness branches', () => {
  // A deliberately drawn box (border + solid background + padding) outscores an
  // otherwise-identical plain card. Both are siblings, so dedup keeps both and
  // the ordering is decided purely by score — which is where `boxness` lands.
  test('a styled box outranks an identical unstyled card (border/bg/padding)', () => {
    doc().body.innerHTML =
      '<div class="card" id="boxed" ' +
      'style="border: 1px solid red; background-color: rgb(1, 2, 3); padding: 8px;">' +
      'Boxed</div>' +
      '<div class="card" id="plain">Plain</div>';

    const { elements } = select();
    const ids = selectorsOf(elements);
    expect(ids).toContain('#boxed');
    expect(ids).toContain('#plain');
    // Higher boxness ⇒ higher score ⇒ sorted ahead of the plain twin.
    expect(ids.indexOf('#boxed')).toBeLessThan(ids.indexOf('#plain'));
  });

  // Each box signal in isolation still drives selection, proving the individual
  // n++ branches fire independently rather than only as a bundle.
  test('a border-only candidate is selected', () => {
    doc().body.innerHTML =
      '<div class="card" id="b" style="border: 2px solid black;">B</div>';
    expect(selectorsOf(select().elements)).toContain('#b');
  });

  test('a background-color-only candidate is selected', () => {
    doc().body.innerHTML =
      '<div class="card" id="bg" style="background-color: rgb(9, 9, 9);">BG</div>';
    expect(selectorsOf(select().elements)).toContain('#bg');
  });

  test('a padding-only candidate is selected', () => {
    doc().body.innerHTML =
      '<div class="card" id="pad" style="padding: 12px;">PAD</div>';
    expect(selectorsOf(select().elements)).toContain('#pad');
  });

  // The `<search>` landmark, the `<summary>` disclosure toggle, and a custom
  // `[role=radio]` are component-root signals; before these were added each was
  // invisible to discovery unless it happened to carry a name-hint class.
  test('a <search> landmark, a <summary> toggle, and a [role=radio] are discovered', () => {
    doc().body.innerHTML =
      '<search id="srch"><span>find</span></search>' +
      '<details id="det"><summary id="sum">More</summary>body</details>' +
      '<div id="rad" role="radio">Option A</div>';
    const ids = selectorsOf(select().elements);
    expect(ids).toContain('#srch');
    expect(ids).toContain('#sum');
    expect(ids).toContain('#rad');
  });
});

describe('selectComponents — pipeline behaviour', () => {
  // A page with no candidacy signal yields nothing, and nothing is capped.
  test('an empty / signal-free page selects no components', () => {
    doc().body.innerHTML = '<div id="anon"></div>';
    const { elements, capped } = select();
    expect(elements).toEqual([]);
    expect(capped).toBe(false);
  });

  // Forced media is always selected and sorts to the front, ahead of a generic
  // (lower-scoring) named candidate.
  test('replaced media is forced to the front of the selection', () => {
    doc().body.innerHTML =
      '<div class="card" id="named">text</div><img id="pic" alt="" />';
    const ids = selectorsOf(select().elements);
    expect(ids).toContain('#pic');
    expect(ids[0]).toBe('#pic'); // forced media sorts first
  });

  // A candidate recognised ONLY through a data-* attribute — its name matching
  // the hint regex (data-card) and, separately, its value matching (data-role
  // ="modal", whose name does not). Neither id nor class carries a hint, so the
  // data-* scan in nameHint is what makes it a candidate at all.
  test('a data-* attribute name or value supplies the component-name hint', () => {
    doc().body.innerHTML =
      '<div id="byname" data-card="x">A</div>' +
      '<div id="byvalue" data-role="modal">B</div>';
    const ids = selectorsOf(select().elements);
    expect(ids).toContain('#byname'); // matched on the data-* attribute name
    expect(ids).toContain('#byvalue'); // matched on the data-* attribute value
  });

  // A candidate nested below <body> exercises depthOf's walk. The plain wrapper
  // carries no hint, so it is not itself a candidate — only the inner card is
  // selected, and its depth was counted by climbing past the wrapper.
  test('a nested candidate is selected (depthOf walks past its wrapper)', () => {
    doc().body.innerHTML =
      '<div id="wrap"><div class="card" id="deep">deep</div></div>';
    const ids = selectorsOf(select().elements);
    expect(ids).toEqual(['#deep']); // only the inner card; wrapper has no signal
  });
});
