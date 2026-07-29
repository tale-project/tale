import { expect, test } from 'bun:test';

import { buildReport } from './report';
import { must, rect, recording, sample } from './test-fixtures';
import type { Defect, ElementTrack, Rect, ReportElement } from './types';

function findElement(
  elements: readonly ReportElement[],
  selector: string,
): ReportElement {
  return must(
    elements.find((e) => e.selector === selector),
    `expected element ${selector} in report`,
  );
}

test('paint impact is temporal: an element that starts painting mid-session counts', () => {
  const loader: ElementTrack = {
    key: 'va-load',
    testid: 'va-load',
    selector: '#hero img',
    kind: 'tracked',
    ancestorKeys: [],
    samples: [
      sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0), paints: false }),
      sample({ t: 16, frame: 1, screen: rect(0, 100, 50, 0), paints: true }),
    ],
  };
  const occluded: ElementTrack = {
    key: 'va-occ',
    testid: 'va-occ',
    selector: '#behind',
    kind: 'tracked',
    ancestorKeys: [],
    samples: [
      sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0), occluded: true }),
    ],
  };
  const unseen: ElementTrack = {
    key: 'va-unseen',
    testid: 'va-unseen',
    selector: '#offscreen',
    kind: 'tracked',
    ancestorKeys: [],
    samples: [
      sample({
        t: 0,
        frame: 0,
        screen: rect(0, 100, 50, 0),
        inViewport: false,
      }),
    ],
  };

  const report = buildReport(recording([loader, occluded, unseen]));
  const selectors = report.elements.map((e) => e.selector);
  expect(selectors).toContain('#hero img');
  expect(selectors).not.toContain('#behind'); // occluded → no visible impact
  expect(selectors).not.toContain('#offscreen'); // never entered the viewport
  expect(findElement(report.elements, '#hero img').impactMode).toContain(
    'paints',
  );
});

test('screen anchor: a fixed element stays put in the viewport while the page scrolls both axes', () => {
  const bar: ElementTrack = {
    key: 'va-bar',
    testid: 'va-bar',
    selector: '#topbar',
    kind: 'tracked',
    ancestorKeys: [],
    samples: [
      sample({
        t: 0,
        frame: 0,
        screen: rect(0, 300, 50, 0),
        page: rect(0, 300, 50, 0),
      }),
      sample({
        t: 16,
        frame: 1,
        screen: rect(0, 300, 50, 0),
        page: rect(100, 350, 150, 50),
      }),
      sample({
        t: 32,
        frame: 2,
        screen: rect(0, 300, 50, 0),
        page: rect(200, 400, 250, 100),
      }),
    ],
  };
  const report = buildReport(recording([bar]));
  const el = findElement(report.elements, '#topbar');
  expect(el.anchoredTo).toBe('screen');
  expect([...el.anchoredEdges].sort()).toEqual([
    'bottom',
    'left',
    'right',
    'top',
  ]);
});

test('page anchor: content fixed in the document scrolls with the page', () => {
  const content: ElementTrack = {
    key: 'va-content',
    testid: 'va-content',
    selector: '#article',
    kind: 'tracked',
    ancestorKeys: [],
    samples: [
      sample({
        t: 0,
        frame: 0,
        screen: rect(100, 300, 200, 0),
        page: rect(100, 300, 200, 0),
      }),
      sample({
        t: 16,
        frame: 1,
        screen: rect(0, 300, 100, 0),
        page: rect(100, 300, 200, 0),
      }),
      sample({
        t: 32,
        frame: 2,
        screen: rect(-100, 300, 0, 0),
        page: rect(100, 300, 200, 0),
      }),
    ],
  };
  const report = buildReport(recording([content]));
  const el = findElement(report.elements, '#article');
  expect(el.anchoredTo).toBe('page');
  expect([...el.anchoredEdges].sort()).toEqual([
    'bottom',
    'left',
    'right',
    'top',
  ]);
});

test('affected-by: a block that resizes pushes a footer, and the layout shift is reported', () => {
  const block: ElementTrack = {
    key: 'va-block',
    testid: 'va-block',
    selector: '#promo',
    kind: 'tracked',
    ancestorKeys: [],
    samples: [
      sample({ t: 0, frame: 0, screen: rect(0, 200, 100, 0) }),
      sample({ t: 16, frame: 1, screen: rect(0, 200, 100, 0) }),
      sample({ t: 32, frame: 2, screen: rect(0, 200, 160, 0) }),
      sample({ t: 48, frame: 3, screen: rect(0, 200, 160, 0) }),
    ],
  };
  const footer: ElementTrack = {
    key: 'cand-footer',
    testid: null,
    selector: 'footer',
    kind: 'candidate',
    ancestorKeys: [],
    samples: [
      sample({ t: 0, frame: 0, screen: rect(120, 200, 140, 0) }),
      sample({ t: 16, frame: 1, screen: rect(120, 200, 140, 0) }),
      sample({ t: 32, frame: 2, screen: rect(180, 200, 200, 0) }),
      sample({ t: 48, frame: 3, screen: rect(180, 200, 200, 0) }),
    ],
  };
  const report = buildReport(
    recording(
      [block, footer],
      [
        {
          t: 32,
          segment: 0,
          value: 0.18,
          hadRecentInput: false,
          sources: [
            {
              key: 'cand-footer',
              previousRect: rect(120, 200, 140, 0),
              currentRect: rect(180, 200, 200, 0),
            },
          ],
        },
      ],
    ),
  );

  const footerEl = findElement(report.elements, 'footer');
  expect(footerEl.source).toBe('affected');
  expect(footerEl.affectedBy).toEqual(['va-block']);
  expect(findElement(report.elements, '#promo').impactMode).toContain('layout');

  const shift = report.defects.find((d) => d.type === 'layout-shift');
  expect(must(shift, 'expected a layout-shift defect').selector).toBe('footer');
  expect(must(shift, 'shift').severity).toBeCloseTo(0.18, 5);
});

test('ancestor anchor: a child moving in lockstep resolves to the highest preserving ancestor', () => {
  const moving = (
    key: string,
    base: Rect,
    kind: ElementTrack['kind'],
    seen: boolean,
  ): ElementTrack => ({
    key,
    testid: kind === 'tracked' ? key : null,
    selector:
      key === 'va-child' ? '#badge' : key === 'anc-grand' ? '#card' : `#${key}`,
    kind,
    ancestorKeys: [],
    samples: [0, 1, 2].map((f) =>
      sample({
        t: f * 16,
        frame: f,
        screen: rect(
          base.top + 10 * f,
          base.right + 10 * f,
          base.bottom + 10 * f,
          base.left + 10 * f,
        ),
        inViewport: seen,
      }),
    ),
  });

  const child = moving('va-child', rect(10, 110, 60, 10), 'tracked', true);
  const parent = moving('anc-parent', rect(0, 200, 200, 0), 'candidate', false);
  const grand = moving(
    'anc-grand',
    rect(-10, 220, 220, -10),
    'candidate',
    false,
  );
  const greatGrand: ElementTrack = {
    key: 'anc-gg',
    testid: null,
    selector: '#page',
    kind: 'candidate',
    ancestorKeys: [],
    samples: [0, 1, 2].map((f) =>
      sample({
        t: f * 16,
        frame: f,
        screen: rect(0, 300, 300, 0),
        inViewport: false,
      }),
    ),
  };
  const withChain: ElementTrack = {
    ...child,
    ancestorKeys: ['anc-parent', 'anc-grand', 'anc-gg'],
  };

  const report = buildReport(recording([withChain, parent, grand, greatGrand]));
  const el = findElement(report.elements, '#badge');
  expect(el.anchoredTo).toBe('#card');
  expect([...el.anchoredEdges].sort()).toEqual([
    'bottom',
    'left',
    'right',
    'top',
  ]);
});

test('jank: a transition with sustained stutter is flagged and lowers quality', () => {
  const lefts = [0, 5, 10, 15, 20, 210, 215, 220, 225, 415];
  const ts = [0, 16, 32, 48, 64, 128, 144, 160, 176, 192];
  const mover: ElementTrack = {
    key: 'va-move',
    testid: 'va-move',
    selector: '#drawer',
    kind: 'tracked',
    ancestorKeys: [],
    samples: lefts.map((left, f) =>
      sample({
        t: must(ts[f], 't'),
        frame: f,
        screen: rect(0, left + 100, 50, left),
      }),
    ),
  };
  const report = buildReport(recording([mover]));
  const jank: Defect | undefined = report.defects.find(
    (d) => d.type === 'jank',
  );
  expect(must(jank, 'expected a jank defect').selector).toBe('#drawer');
  expect(must(jank, 'jank').metrics.droppedFrames).toBe(1);
  const transition = must(
    report.transitions.find((t) => t.selector === '#drawer'),
    'expected a transition',
  );
  expect(transition.smoothness).toBe('janky');
  expect(transition.quality).toBeLessThan(1);
});

test('flicker: a rapid visible→hidden→visible toggle is flagged', () => {
  const flick: ElementTrack = {
    key: 'va-flick',
    testid: 'va-flick',
    selector: '.overlay',
    kind: 'tracked',
    ancestorKeys: [],
    samples: [
      sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0), opacity: 1 }),
      sample({ t: 30, frame: 1, screen: rect(0, 100, 50, 0), opacity: 0 }),
      sample({ t: 60, frame: 2, screen: rect(0, 100, 50, 0), opacity: 1 }),
    ],
  };
  const report = buildReport(recording([flick]));
  const flicker = report.defects.find((d) => d.type === 'flicker');
  expect(must(flicker, 'expected a flicker defect').selector).toBe('.overlay');
  expect(must(flicker, 'flicker').metrics.toggleCount).toBe(2);
});

test('dithering: high-frequency pixel noise in a static region is flagged', () => {
  const shimmer: ElementTrack = {
    key: 'va-dither',
    testid: 'va-dither',
    selector: '.gradient',
    tag: 'CANVAS',
    kind: 'tracked',
    ancestorKeys: [],
    samples: [0, 1, 2].map((f) =>
      sample({
        t: f * 16,
        frame: f,
        screen: rect(0, 100, 50, 0),
        pixelNoise: 0.2,
      }),
    ),
  };
  const report = buildReport(recording([shimmer]));
  const dither = report.defects.find((d) => d.type === 'dithering');
  expect(must(dither, 'expected a dithering defect').selector).toBe(
    '.gradient',
  );
  expect(must(dither, 'dither').metrics.frames).toBe(3);
});

test('report shape carries session metadata', () => {
  const el: ElementTrack = {
    key: 'va-1',
    testid: 'va-1',
    selector: '#x',
    kind: 'tracked',
    ancestorKeys: [],
    samples: [sample({ t: 0, frame: 0, screen: rect(0, 10, 10, 0) })],
  };
  const report = buildReport(recording([el]));
  expect(report.session.pixelThreshold).toBe(1);
  expect(report.session.segments.length).toBe(1);
});
