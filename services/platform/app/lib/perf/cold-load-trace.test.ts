import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getColdLoadTrace,
  markColdLoad,
  resetColdLoadTraceForTests,
} from './cold-load-trace';

beforeEach(() => {
  resetColdLoadTraceForTests();
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cold-load trace (epic #2386 AC3 — recordable, not just console noise)', () => {
  it('records marks in order with milliseconds since navigation start', () => {
    markColdLoad('module-load');
    markColdLoad('convex-authenticated');

    const trace = getColdLoadTrace();
    expect(trace.map((m) => m.label)).toEqual([
      'module-load',
      'convex-authenticated',
    ]);
    for (const mark of trace) {
      expect(mark.at).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(mark.at)).toBe(true);
    }
  });

  it('records each label once — repeat reaches never rewrite the timeline', () => {
    markColdLoad('module-load');
    markColdLoad('module-load');

    expect(getColdLoadTrace()).toHaveLength(1);
  });

  it('mirrors every mark into the Performance API for E2E/DevTools tooling', () => {
    const perfMark = vi.spyOn(performance, 'mark');

    markColdLoad('convex-preauth');

    expect(perfMark).toHaveBeenCalledWith('cold-load:convex-preauth');
  });

  it('reset clears the timeline so each test observes a fresh page load', () => {
    markColdLoad('module-load');
    resetColdLoadTraceForTests();

    expect(getColdLoadTrace()).toHaveLength(0);
    markColdLoad('module-load');
    expect(getColdLoadTrace()).toHaveLength(1);
  });
});
