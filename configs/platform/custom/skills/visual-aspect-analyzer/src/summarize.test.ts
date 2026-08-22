import { describe, expect, test } from 'bun:test';

import { coalesceDefects, summarize } from './summarize';
import type { Defect, Rect, Report, ReportElement } from './types';

const r0: Rect = { top: 0, right: 10, bottom: 10, left: 0 };

function report(defects: Defect[], elements = 2): Report {
  return {
    session: { segments: [], pixelThreshold: 1, frameBudgetMs: 16 },
    elements: Array.from({ length: elements }, (_, i): ReportElement => ({
      testid: `va-${i}`,
      selector: `#e${i}`,
      label: `#e${i}`,
      source: i === 0 ? 'matched' : 'affected',
      impactMode: ['paints'],
      anchoredTo: 'page',
      anchoredEdges: ['top'],
      bounds: {
        screen: { start: r0, end: r0 },
        page: { start: r0, end: r0 },
      },
    })),
    transitions: [],
    defects,
  };
}

function defect(type: Defect['type'], severity: number): Defect {
  return {
    id: `d-${type}`,
    type,
    testid: 'va-0',
    selector: '#e0',
    segment: 0,
    severity,
    window: [0, 10],
    metrics: {},
    detail: `${type} happened`,
  };
}

describe('summarize', () => {
  test('a clean report scores 100 with no hints', () => {
    const s = summarize(report([]));
    expect(s.score).toBe(100);
    expect(s.hints).toEqual([]);
    expect(s.headline).toContain('no defects');
    expect(s.matched).toBe(1);
    expect(s.affected).toBe(1);
  });

  test('defects lower the score and add one hint per type', () => {
    const s = summarize(
      report([defect('layout-shift', 1), defect('flicker', 1)]),
    );
    expect(s.score).toBeLessThan(40);
    expect(s.defectsByType['layout-shift']).toBe(1);
    expect(s.defectsByType.flicker).toBe(1);
    expect(s.hints.length).toBe(2);
  });

  test('the headline names defect counts by type, in canonical order', () => {
    const s = summarize(
      report([
        defect('jank', 0.3),
        defect('layout-shift', 0.5),
        defect('jank', 0.4),
      ]),
    );
    expect(s.headline).toContain('Visual health');
    // Canonical order is layout-shift before jank, regardless of input order.
    expect(s.headline).toContain('1 layout-shift, 2 jank');
  });

  test('worst lists the highest-severity defects first', () => {
    const s = summarize(
      report([defect('dithering', 0.2), defect('jank', 0.9)]),
    );
    expect(s.worst[0]?.type).toBe('jank');
    expect(s.worst[0]?.severity).toBe(0.9);
  });

  test('repeated defects on one element coalesce with a count', () => {
    const s = summarize(
      report([defect('flicker', 0.4), defect('flicker', 0.9)]),
    );
    expect(s.worst.length).toBe(1);
    expect(s.worst[0]?.count).toBe(2);
    expect(s.worst[0]?.severity).toBe(0.9); // keeps the worst
  });

  test('any reported defect drops the score below 100 (the gate stays trustworthy)', () => {
    // Regression: a sub-rounding severity (e.g. a 1e-4 CLS) would otherwise leave
    // the weighted penalty rounding to 0 and the score at a misleading 100 while
    // the defect is still listed. The gate ("investigate anything < 100") must
    // never read 100 with a defect present.
    const s = summarize(report([defect('layout-shift', 0.0001)]));
    expect(s.score).toBeLessThan(100);
    expect(s.score).toBe(99); // capped just under — not zeroed by a negligible severity
  });

  test('one noisy defect type cannot zero the score by itself', () => {
    const flickers = Array.from({ length: 8 }, () => defect('flicker', 1));
    const s = summarize(report(flickers));
    expect(s.score).toBe(75); // flicker penalty caps at its weight (25)
  });

  test('the score never goes below 0', () => {
    const s = summarize(
      report([
        defect('layout-shift', 1),
        defect('jank', 1),
        defect('flicker', 1),
        defect('dithering', 1),
      ]),
    );
    expect(s.score).toBe(0);
  });
});

describe('coalesceDefects', () => {
  test('carries the worst occurrence’s metrics (the one detail came from)', () => {
    const mild: Defect = {
      ...defect('jank', 0.3),
      metrics: { droppedFrames: 1 },
      detail: 'mild',
    };
    const worst: Defect = {
      ...defect('jank', 0.9),
      metrics: { droppedFrames: 7 },
      detail: 'worst',
    };
    const [c] = coalesceDefects([mild, worst]);
    expect(c?.severity).toBe(0.9);
    expect(c?.detail).toBe('worst');
    expect(c?.metrics).toEqual({ droppedFrames: 7 });
  });

  test('breaks severity ties by type order then selector, independent of input order', () => {
    const d = (type: Defect['type'], selector: string): Defect => ({
      ...defect(type, 0.5),
      id: `${type}|${selector}`,
      selector,
    });
    const input = [
      d('dithering', '#b'),
      d('layout-shift', '#z'),
      d('jank', '#m'),
      d('jank', '#a'),
    ];
    const order = (xs: Defect[]) =>
      coalesceDefects(xs).map((c) => `${c.type}|${c.selector}`);
    // Type order is layout-shift → jank → flicker → dithering; within a type,
    // selectors sort lexically. Reversing the input must not change the output.
    const expected = ['layout-shift|#z', 'jank|#a', 'jank|#m', 'dithering|#b'];
    expect(order(input)).toEqual(expected);
    expect(order(input.toReversed())).toEqual(expected);
  });
});
