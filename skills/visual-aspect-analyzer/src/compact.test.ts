import { describe, expect, test } from 'bun:test';

import { compactReport } from './compact';
import type {
  AuditMeta,
  Defect,
  DefectMetrics,
  ElementBounds,
  Rect,
  Report,
  ReportElement,
  Transition,
} from './types';

/** A static box (start === end) in both spaces, from one page rect. */
function staticBounds(r: Rect): ElementBounds {
  return { screen: { start: r, end: r }, page: { start: r, end: r } };
}

/** Bounds that move from `start` to `end` (same in both spaces; no scroll). */
function movingBounds(start: Rect, end: Rect): ElementBounds {
  return { screen: { start, end }, page: { start, end } };
}

const box = (
  top: number,
  right: number,
  bottom: number,
  left: number,
): Rect => ({
  top,
  right,
  bottom,
  left,
});

function jank(severity: number, window: readonly [number, number]): Defect {
  return {
    id: `d-${severity}`,
    type: 'jank',
    testid: 'va-1',
    selector: '#a',
    segment: 0,
    severity,
    window,
    metrics: { droppedFrames: 3, maxJumpPx: 88 },
    detail: `jank ${severity}`,
  };
}

/** A defect of any type, with custom curated metrics, on `#a`. */
function defect(
  type: Defect['type'],
  metrics: DefectMetrics,
  detail: string,
): Defect {
  return {
    id: `d-${type}`,
    type,
    testid: 'va-1',
    selector: '#a',
    segment: 0,
    severity: 0.7,
    window: [0, 10],
    metrics,
    detail,
  };
}

function transition(
  smoothness: Transition['smoothness'],
  easing: Transition['easing'] = null,
): Transition {
  return {
    testid: 'va-1',
    selector: '#a',
    segment: 0,
    kind: 'move',
    easing,
    window: [0, 10],
    smoothness,
    quality: smoothness === 'smooth' ? 1 : 0.5,
    metrics: {},
    defects: [],
  };
}

function report(defects: Defect[], transitions: Transition[]): Report {
  return {
    session: {
      segments: [{ index: 0, url: 'https://x.test/', from: 0, to: 1000 }],
      pixelThreshold: 1,
      frameBudgetMs: 16.666666666666668,
    },
    elements: [
      {
        testid: 'va-1',
        selector: '#a',
        label: 'button "Go"',
        source: 'matched',
        impactMode: ['paints', 'layout'],
        anchoredTo: 'page',
        anchoredEdges: ['top', 'right', 'bottom', 'left'],
        bounds: staticBounds(box(0, 100, 50, 0)),
      },
      {
        testid: null,
        selector: 'footer',
        label: 'contentinfo',
        source: 'affected',
        affectedBy: ['va-1'],
        impactMode: ['layout'],
        anchoredTo: null,
        anchoredEdges: [],
        bounds: staticBounds(box(200, 100, 240, 0)),
      },
    ],
    transitions,
    defects,
  };
}

describe('compactReport', () => {
  test('coalesces defects, rounds the window, keeps curated metrics, drops id/segment', () => {
    const out = compactReport(
      report([jank(0.55, [10.4, 20.6]), jank(0.9, [5.2, 25.9])], []),
    );
    expect(out.defects.length).toBe(1);
    const d = out.defects[0];
    expect(d?.count).toBe(2);
    expect(d?.severity).toBe(0.9); // worst, rounded
    expect(d?.window).toEqual([5, 26]); // merged + rounded to ms
    expect(d?.detail).toBe('jank 0.9');
    // Curated metrics survive (worst occurrence); raw id/segment do not.
    expect(d?.metrics).toEqual({ droppedFrames: 3, maxJumpPx: 88 });
    expect(Object.keys(d ?? {})).not.toContain('id');
    expect(Object.keys(d ?? {})).not.toContain('segment');
    expect(Object.keys(d ?? {})).not.toContain('hint');
  });

  test('hoists one fix hint per defect type to a top-level map', () => {
    const out = compactReport(report([jank(0.5, [0, 10])], []));
    expect(out.hints?.jank?.length).toBeGreaterThan(0);
    // No per-defect hint, and no hint for a type that did not occur.
    expect(out.hints?.['layout-shift']).toBeUndefined();
  });

  test('renames impactMode→impact, carries anchoredTo through; keeps affectedBy', () => {
    const out = compactReport(report([], []));
    const a = out.elements[0];
    expect(a?.anchoredTo).toBe('page');
    expect(a?.impact).toEqual(['paints', 'layout']);
    expect(Object.keys(a ?? {})).not.toContain('impactMode');
    expect(out.elements[1]?.affectedBy).toEqual(['va-1']);
  });

  test('always emits testid and anchoredEdges explicitly (null / empty included)', () => {
    const footer = compactReport(report([], [])).elements[1];
    expect(footer?.testid).toBeNull();
    expect(footer?.anchoredEdges).toEqual([]);
    expect(footer?.anchoredTo).toBeNull();
  });

  test('keeps the full anchored-edge set rather than inferring it from anchoredTo', () => {
    const a = compactReport(report([], [])).elements[0];
    expect(a?.anchoredTo).toBe('page');
    expect(a?.anchoredEdges).toEqual(['top', 'right', 'bottom', 'left']);
  });

  test('keeps a partial (1-3 edge) anchor set verbatim', () => {
    const partial = report([], []);
    const out = compactReport({
      ...partial,
      elements: [
        {
          testid: 'va-1',
          selector: '#bar',
          label: '#bar',
          source: 'matched',
          impactMode: ['paints'],
          anchoredTo: 'screen',
          anchoredEdges: ['bottom', 'left'],
          bounds: staticBounds(box(0, 200, 40, 0)),
        },
      ],
    });
    expect(out.elements[0]?.anchoredEdges).toEqual(['bottom', 'left']);
  });

  test('gives each element its settled (end) box as to [left, top, width, height]', () => {
    const base = report([], []);
    const out = compactReport({
      ...base,
      elements: [
        {
          testid: 'va-1',
          selector: '#a',
          label: '#a',
          source: 'matched',
          impactMode: ['layout'],
          anchoredTo: null,
          anchoredEdges: [],
          bounds: movingBounds(box(0, 100, 50, 0), box(30, 230, 110, 30)),
        },
      ],
    });
    // end box {top:30,right:230,bottom:110,left:30} → [left, top, width, height]
    expect(out.elements[0]?.to).toEqual([30, 30, 200, 80]);
  });

  test('adds from (the start box) only when the element moved/resized', () => {
    const base = report([], []);
    const out = compactReport({
      ...base,
      elements: [
        {
          testid: 'va-1',
          selector: '#a',
          label: '#a',
          source: 'matched',
          impactMode: ['layout'],
          anchoredTo: null,
          anchoredEdges: [],
          bounds: movingBounds(box(0, 100, 50, 0), box(30, 130, 80, 30)),
        },
      ],
    });
    expect(out.elements[0]?.to).toEqual([30, 30, 100, 50]);
    expect(out.elements[0]?.from).toEqual([0, 0, 100, 50]);
  });

  test('omits from for a static element (start↔end within pixelThreshold)', () => {
    const base = report([], []); // pixelThreshold 1
    const out = compactReport({
      ...base,
      elements: [
        {
          testid: 'va-1',
          selector: '#a',
          label: '#a',
          source: 'matched',
          impactMode: ['paints'],
          anchoredTo: 'page',
          anchoredEdges: ['top', 'right', 'bottom', 'left'],
          bounds: movingBounds(box(0, 100, 50, 0), box(0.5, 100.5, 50.5, 0.5)),
        },
      ],
    });
    expect(out.elements[0]?.to).toEqual([1, 1, 100, 50]); // end box, rounded
    expect(out.elements[0]?.from).toBeUndefined();
    expect(Object.keys(out.elements[0] ?? {})).not.toContain('from');
  });

  test('omits defect count for a single occurrence', () => {
    const out = compactReport(report([jank(0.5, [0, 10])], []));
    expect(out.defects[0]?.count).toBeUndefined();
    expect(Object.keys(out.defects[0] ?? {})).not.toContain('count');
  });

  test('element keys read in natural order (selector, testid first)', () => {
    const keys = Object.keys(compactReport(report([], [])).elements[0] ?? {});
    expect(keys[0]).toBe('selector');
    expect(keys.indexOf('testid')).toBeLessThan(keys.indexOf('source'));
  });

  test('carries each element label, and joins it onto defects by selector', () => {
    const out = compactReport(report([jank(0.5, [0, 10])], []));
    // The element keeps its role+name label alongside the precise selector.
    expect(out.elements[0]?.label).toBe('button "Go"');
    expect(out.elements[0]?.selector).toBe('#a');
    // A defect on `#a` shows the same label (looked up by selector).
    expect(out.defects[0]?.selector).toBe('#a');
    expect(out.defects[0]?.label).toBe('button "Go"');
  });

  test('falls back to the selector as the label when an element is unknown', () => {
    // A page-level layout shift has selector "(page)" and no element entry.
    const pageShift: Defect = {
      ...jank(0.4, [0, 10]),
      type: 'layout-shift',
      selector: '(page)',
      testid: null,
    };
    const out = compactReport(report([pageShift], []));
    expect(out.defects[0]?.label).toBe('(page)');
  });

  test('keeps only non-smooth transitions, with quality, and counts the smooth ones', () => {
    const out = compactReport(
      report(
        [],
        [transition('smooth'), transition('smooth'), transition('janky')],
      ),
    );
    expect(out.transitions?.length).toBe(1);
    expect(out.transitions?.[0]?.smoothness).toBe('janky');
    expect(out.transitions?.[0]?.quality).toBe(0.5);
    expect(out.smoothTransitions).toBe(2);
  });

  test("carries a transition's easing when present, omits it when null", () => {
    const out = compactReport(
      report([], [transition('janky', 'ease-out'), transition('shift')]),
    );
    expect(out.transitions?.[0]?.easing).toBe('ease-out');
    expect(out.transitions?.[1]?.easing).toBeUndefined();
    expect(Object.keys(out.transitions?.[1] ?? {})).not.toContain('easing');
  });

  test('omits transition fields entirely when all are smooth and uneased', () => {
    const out = compactReport(report([], [transition('smooth')]));
    expect(out.transitions).toBeUndefined();
    expect(out.smoothTransitions).toBe(1);
  });

  test('details a smooth transition that has an easing curve', () => {
    const out = compactReport(report([], [transition('smooth', 'ease-in')]));
    expect(out.transitions?.length).toBe(1);
    expect(out.transitions?.[0]?.easing).toBe('ease-in');
    expect(out.transitions?.[0]?.smoothness).toBe('smooth');
    expect(out.smoothTransitions).toBeUndefined();
  });

  test('lists the eased smooth move but only counts the bare smooth one', () => {
    const out = compactReport(
      report([], [transition('smooth', null), transition('smooth', 'linear')]),
    );
    expect(out.transitions?.length).toBe(1);
    expect(out.transitions?.[0]?.easing).toBe('linear');
    expect(out.smoothTransitions).toBe(1); // the uneased smooth one
  });

  test('a clean report has no defects, hints, or transition noise', () => {
    const out = compactReport(report([], []));
    expect(out.defects).toEqual([]);
    expect(out.hints).toBeUndefined();
    expect(out.transitions).toBeUndefined();
    expect(out.smoothTransitions).toBeUndefined();
    expect(Object.keys(out)).not.toContain('summary');
    expect(out.url).toBe('https://x.test/');
  });

  test('surfaces the audit block for a whole-page audit', () => {
    const base = report([], []);
    const audit: AuditMeta = { wholePage: true, discovered: 7, capped: true };
    const out = compactReport({
      ...base,
      session: { ...base.session, audit },
    });
    expect(out.audit).toEqual(audit);
  });

  test('omits the audit block when the report carries no audit metadata', () => {
    expect(compactReport(report([], [])).audit).toBeUndefined();
  });

  test('never dangles a surfaced defect to an omitted element (regression)', () => {
    // More defect-bearing elements than the element cap: every SURFACED defect's
    // element must still be present, or a consumer follows a dangling reference.
    const N = 36;
    const els: ReportElement[] = Array.from({ length: N }, (_, i) => ({
      testid: `va-${i}`,
      selector: `#chip-${i}`,
      label: `chip ${i}`,
      source: 'matched',
      impactMode: ['layout'],
      anchoredTo: 'page',
      anchoredEdges: ['top', 'right', 'bottom', 'left'],
      bounds: staticBounds(box(0, 100, 50, 0)),
    }));
    const defects: Defect[] = Array.from({ length: N }, (_, i) => ({
      id: `d-${i}`,
      type: 'layout-shift',
      testid: `va-${i}`,
      selector: `#chip-${i}`,
      segment: 0,
      severity: (N - i) / N,
      window: [0, 10],
      metrics: { score: 0.1 },
      detail: 'shift',
    }));
    const base = report([], []);
    const out = compactReport({
      ...base,
      session: {
        ...base.session,
        audit: { wholePage: true, discovered: N, capped: false },
      },
      elements: els,
      defects,
    });
    const present = new Set(out.elements.map((e) => e.selector));
    expect(out.defects.length).toBeGreaterThan(0);
    for (const d of out.defects) expect(present.has(d.selector)).toBe(true);
  });

  test('joins a multi-segment session url with an arrow', () => {
    const base = report([], []);
    const multi: Report = {
      ...base,
      session: {
        ...base.session,
        segments: [
          { index: 0, url: 'https://x.test/', from: 0, to: 500 },
          { index: 1, url: 'https://x.test/next', from: 500, to: 1000 },
        ],
      },
    };
    expect(compactReport(multi).url).toBe(
      'https://x.test/ → https://x.test/next',
    );
  });

  test('the compact output is smaller than the faithful report', () => {
    const r = report(
      [jank(0.55, [10.4, 20.6]), jank(0.9, [5.2, 25.9])],
      [transition('janky')],
    );
    const compact = JSON.stringify(compactReport(r)).length;
    const full = JSON.stringify(r).length;
    expect(compact).toBeLessThan(full);
  });

  describe('compactMetrics — flicker branch', () => {
    test('surfaces toggleCount and frequencyHz for a flicker defect', () => {
      const out = compactReport(
        report(
          [defect('flicker', { toggleCount: 6, frequencyHz: 12.5 }, 'flicker')],
          [],
        ),
      );
      expect(out.defects[0]?.type).toBe('flicker');
      expect(out.defects[0]?.metrics).toEqual({
        toggleCount: 6,
        frequencyHz: 12.5,
      });
    });

    test('rounds frequencyHz to two decimals and drops unrelated raw metrics', () => {
      const out = compactReport(
        report(
          [
            defect(
              'flicker',
              // The 3rd-decimal frequency must round; `score`/`maxJumpPx` are not
              // flicker keys and must be discarded by the curated branch.
              {
                toggleCount: 4,
                frequencyHz: 9.876,
                score: 0.42,
                maxJumpPx: 88,
              },
              'flicker',
            ),
          ],
          [],
        ),
      );
      expect(out.defects[0]?.metrics).toEqual({
        toggleCount: 4,
        frequencyHz: 9.88,
      });
    });

    test('omits a flicker metric key whose value is missing or non-numeric', () => {
      const out = compactReport(
        report(
          // No frequencyHz at all; toggleCount present but null (not a number).
          [
            defect(
              'flicker',
              { toggleCount: null, droppedFrames: 2 },
              'flicker',
            ),
          ],
          [],
        ),
      );
      const m = out.defects[0]?.metrics ?? {};
      expect(m).toEqual({});
      expect(Object.keys(m)).not.toContain('toggleCount');
      expect(Object.keys(m)).not.toContain('frequencyHz');
    });
  });

  describe('compactMetrics — dithering branch', () => {
    test('surfaces noiseEnergy for a dithering defect', () => {
      const out = compactReport(
        report([defect('dithering', { noiseEnergy: 3.5 }, 'dithering')], []),
      );
      expect(out.defects[0]?.type).toBe('dithering');
      expect(out.defects[0]?.metrics).toEqual({ noiseEnergy: 3.5 });
    });

    test('rounds noiseEnergy to two decimals and ignores foreign keys', () => {
      const out = compactReport(
        report(
          [
            defect(
              'dithering',
              { noiseEnergy: 1.23456, toggleCount: 9 },
              'dithering',
            ),
          ],
          [],
        ),
      );
      expect(out.defects[0]?.metrics).toEqual({ noiseEnergy: 1.23 });
    });

    test('emits empty metrics when noiseEnergy is absent', () => {
      const out = compactReport(
        report([defect('dithering', { something: 1 }, 'dithering')], []),
      );
      expect(out.defects[0]?.metrics).toEqual({});
    });
  });

  describe('compactMetrics — both branches in one report', () => {
    test('curates flicker and dithering defects side by side', () => {
      const out = compactReport(
        report(
          [
            defect('flicker', { toggleCount: 3, frequencyHz: 5 }, 'flicker'),
            defect('dithering', { noiseEnergy: 2 }, 'dithering'),
          ],
          [],
        ),
      );
      const byType = new Map(out.defects.map((d) => [d.type, d.metrics]));
      expect(byType.get('flicker')).toEqual({ toggleCount: 3, frequencyHz: 5 });
      expect(byType.get('dithering')).toEqual({ noiseEnergy: 2 });
      // Both types contribute their own hoisted fix hint.
      expect(out.hints?.flicker?.length).toBeGreaterThan(0);
      expect(out.hints?.dithering?.length).toBeGreaterThan(0);
    });
  });
});
