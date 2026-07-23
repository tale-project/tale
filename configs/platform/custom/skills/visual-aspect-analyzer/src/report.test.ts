import { describe, expect, test } from 'bun:test';

import { buildReport } from './report';
import { must, rect, recording, sample, track } from './test-fixtures';
import type { ReportElement } from './types';

function find(
  elements: readonly ReportElement[],
  selector: string,
): ReportElement {
  return must(
    elements.find((e) => e.selector === selector),
    `expected ${selector}`,
  );
}

describe('buildReport scope/seen/impact filters', () => {
  test('keeps a painting tracked element as matched', () => {
    const el = track({
      key: 'va-1',
      selector: '#hero',
      samples: [sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0) })],
    });
    const report = buildReport(recording([el]));
    expect(find(report.elements, '#hero').source).toBe('matched');
    expect(find(report.elements, '#hero').impactMode).toEqual(['paints']);
  });

  test('drops a tracked element that neither paints nor moves others', () => {
    const el = track({
      key: 'va-1',
      selector: '#empty',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0), paints: false }),
      ],
    });
    expect(buildReport(recording([el])).elements).toEqual([]);
  });

  test('drops a never-seen tracked element', () => {
    const el = track({
      key: 'va-1',
      selector: '#offscreen',
      samples: [
        sample({
          t: 0,
          frame: 0,
          screen: rect(0, 100, 50, 0),
          inViewport: false,
        }),
      ],
    });
    expect(buildReport(recording([el])).elements).toEqual([]);
  });

  test('drops a candidate that no tracked element affected', () => {
    const el = track({
      key: 'va-1',
      selector: '#static',
      samples: [sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0) })],
    });
    const lonely = track({
      key: 'cand-x',
      kind: 'candidate',
      selector: '.aside',
      samples: [sample({ t: 0, frame: 0, screen: rect(0, 10, 10, 0) })],
    });
    const report = buildReport(recording([el, lonely]));
    expect(report.elements.some((e) => e.selector === '.aside')).toBe(false);
  });

  test('a layout-only tracked element reports impactMode ["layout"]', () => {
    const bar = track({
      key: 'va-bar',
      selector: '#bar',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 200, 40, 0), paints: false }),
      ],
      layoutProbe: { affects: true, movedKeys: ['cand-below'] },
    });
    const below = track({
      key: 'cand-below',
      kind: 'candidate',
      selector: '#below',
      samples: [sample({ t: 0, frame: 0, screen: rect(40, 200, 80, 0) })],
    });
    const report = buildReport(recording([bar, below]));
    expect(find(report.elements, '#bar').impactMode).toEqual(['layout']);
  });
});

describe('affected attribution in the report', () => {
  test('lists multiple causes sorted and marks the source affected', () => {
    const a = track({
      key: 'va-a',
      selector: '#a',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0) }),
        sample({ t: 16, frame: 1, screen: rect(0, 100, 80, 0) }),
      ],
    });
    const b = track({
      key: 'va-b',
      selector: '#b',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 100, 150, 100) }),
        sample({ t: 16, frame: 1, screen: rect(0, 100, 180, 100) }),
      ],
    });
    const footer = track({
      key: 'cand-footer',
      kind: 'candidate',
      selector: 'footer',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(200, 200, 220, 0) }),
        sample({ t: 16, frame: 1, screen: rect(260, 200, 280, 0) }),
      ],
    });
    const report = buildReport(recording([a, b, footer]));
    const el = find(report.elements, 'footer');
    expect(el.source).toBe('affected');
    expect(el.affectedBy).toEqual(['va-a', 'va-b']);
    expect(el.impactMode).toContain('layout');
  });

  // Round 5 regression (report-integrity-deep-24): a container that grows together
  // with its own discovered children co-moves with BOTH an external cause and
  // those children. A child cannot push its ancestor, so the node's own
  // descendants are filtered out of `affectedBy` — only the genuine external cause
  // remains (the node never "cites its own descendants").
  test("affectedBy filters out the node's own descendants, keeping external causes", () => {
    const grow = track({
      key: 'va-grow',
      selector: '#grow',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0) }),
        sample({ t: 16, frame: 1, screen: rect(0, 160, 110, 0) }),
      ],
    });
    // A discovered child whose ancestor chain passes through #wrap (same selector
    // as the candidate below — a node's copies share a selector, not a key).
    const child = track({
      key: 'va-child',
      selector: '#child',
      ancestorKeys: ['cand-wrap'],
      samples: [
        sample({ t: 0, frame: 0, screen: rect(10, 310, 60, 290) }),
        sample({ t: 16, frame: 1, screen: rect(10, 370, 60, 350) }),
      ],
    });
    // #wrap co-moves with BOTH the external grower and its own child.
    const wrap = track({
      key: 'cand-wrap',
      kind: 'candidate',
      selector: '#wrap',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 300, 200, 200) }),
        sample({ t: 16, frame: 1, screen: rect(0, 360, 200, 260) }),
      ],
    });
    const wrapEl = find(
      buildReport(recording([grow, child, wrap])).elements,
      '#wrap',
    );
    expect(wrapEl.source).toBe('affected');
    expect(wrapEl.affectedBy).toContain('va-grow'); // genuine external cause kept
    expect(wrapEl.affectedBy).not.toContain('va-child'); // own descendant filtered
  });
});

describe('element bounds in the report', () => {
  test('attaches start/end boxes from the first and last sample, both spaces', () => {
    const el = track({
      key: 'va-1',
      selector: '#mover',
      samples: [
        sample({
          t: 0,
          frame: 0,
          screen: rect(0, 100, 50, 0),
          page: rect(0, 100, 50, 0),
        }),
        sample({
          t: 16,
          frame: 1,
          screen: rect(10, 110, 60, 10),
          page: rect(110, 110, 160, 10),
        }),
      ],
    });
    const mover = find(buildReport(recording([el])).elements, '#mover');
    expect(mover.bounds.screen.start).toEqual(rect(0, 100, 50, 0));
    expect(mover.bounds.screen.end).toEqual(rect(10, 110, 60, 10));
    expect(mover.bounds.page.start).toEqual(rect(0, 100, 50, 0));
    expect(mover.bounds.page.end).toEqual(rect(110, 110, 160, 10));
  });
});

describe('report session metadata', () => {
  test('echoes the recording parameters', () => {
    const el = track({
      key: 'va-1',
      samples: [sample({ t: 0, frame: 0, screen: rect(0, 10, 10, 0) })],
    });
    const report = buildReport(recording([el]));
    expect(report.session.pixelThreshold).toBe(1);
    expect(report.session.segments.length).toBe(1);
  });
});

describe('buildReport degenerate inputs', () => {
  test('an empty recording yields an empty, well-formed report', () => {
    const report = buildReport(recording([]));
    expect(report.elements).toEqual([]);
    expect(report.transitions).toEqual([]);
    expect(report.defects).toEqual([]);
    expect(report.session.segments.length).toBe(1);
  });

  test('a tracked element with no samples is dropped without throwing', () => {
    const report = buildReport(
      recording([track({ key: 'va-1', samples: [] })]),
    );
    expect(report.elements).toEqual([]);
  });
});
