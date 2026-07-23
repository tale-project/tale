import { describe, expect, test } from 'bun:test';

import { PNG } from 'pngjs';

import { analyzeSession, type PageLike } from './driver';
import { rect, recording, sample, track } from './test-fixtures';

// A canned dump the fake page returns when asked to evaluate `__VA.dump()`.
const dumpJson = JSON.stringify(
  recording([
    track({
      key: 'va-1',
      selector: '#hero',
      samples: [sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0) })],
    }),
  ]),
);

// A dump whose single tracked element is flagged occluded: effectivePaint is
// false for it (so it is dropped from the report) UNLESS the driver's paint
// counterfactual confirms it paints and clears the occlusion.
const occludedDump = JSON.stringify(
  recording([
    track({
      key: 'va-occ',
      selector: '#probe',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 20, 20, 0), occluded: true }),
      ],
    }),
  ]),
);

// One probe target covering the top-left sub-rect of the 40×40 viewport.
const probeTargetsJson = JSON.stringify([
  { key: 'va-occ', rect: { top: 0, right: 20, bottom: 20, left: 0 } },
]);

// A solid w×h PNG filled with byte value `v` — distinct fills give a non-zero
// crop diff, equal fills give zero.
function solidPng(v: number, size = 40): Uint8Array {
  const png = new PNG({ width: size, height: size });
  png.data = Buffer.alloc(size * size * 4, v);
  return PNG.sync.write(png);
}

type Calls = {
  initScripts: string[];
  gotos: string[];
  evaluations: string[];
  waits: number;
};

function fakePage(): { page: PageLike; calls: Calls } {
  const calls: Calls = {
    initScripts: [],
    gotos: [],
    evaluations: [],
    waits: 0,
  };
  const page: PageLike = {
    addInitScript: async (script) => {
      calls.initScripts.push(script);
    },
    goto: async (url) => {
      calls.gotos.push(url);
    },
    waitForTimeout: async () => {
      calls.waits++;
    },
    evaluate: async (expression) => {
      calls.evaluations.push(expression);
      return expression.includes('dump') ? dumpJson : '';
    },
  };
  return { page, calls };
}

describe('analyzeSession', () => {
  test('injects, drives keyframes, and returns the analyzed report', async () => {
    const { page, calls } = fakePage();
    const report = await analyzeSession(page, {
      url: 'https://example.test/',
      instrumentBundle: '/* bundle */',
      keyframes: 2,
      settleMs: 0,
    });

    expect(report.elements[0]?.selector).toBe('#hero');
    expect(calls.gotos).toEqual(['https://example.test/']);

    // One init script carrying the bundle + the bootstrap install call.
    expect(calls.initScripts.length).toBe(1);
    expect(calls.initScripts[0]).toContain('installVisualAspectInstrument');

    // Two keyframe sweeps (wait + evaluate) plus the final dump evaluate.
    expect(calls.waits).toBe(2);
    expect(calls.evaluations.filter((e) => e.includes('keyframe')).length).toBe(
      2,
    );
    expect(calls.evaluations.filter((e) => e.includes('dump')).length).toBe(1);
  });

  test('runs the optional interact hook before the keyframe loop', async () => {
    const { page } = fakePage();
    let interacted = false;
    await analyzeSession(page, {
      url: 'https://example.test/',
      instrumentBundle: '',
      keyframes: 0,
      interact: async () => {
        interacted = true;
      },
    });
    expect(interacted).toBe(true);
  });

  test('takes one viewport screenshot per keyframe, then crops in-process', async () => {
    // Three tracked sub-rects: batching means ONE shot per keyframe regardless.
    const rectsJson = JSON.stringify([
      { key: 'a', t: 0, rect: { top: 0, right: 10, bottom: 10, left: 0 } },
      { key: 'b', t: 0, rect: { top: 0, right: 20, bottom: 10, left: 10 } },
      { key: 'c', t: 0, rect: { top: 10, right: 30, bottom: 20, left: 20 } },
    ]);
    let shots = 0;
    const page: PageLike = {
      addInitScript: async () => {},
      goto: async () => {},
      waitForTimeout: async () => {},
      evaluate: async (expression) => {
        if (expression.includes('dump')) return dumpJson;
        if (expression.includes('innerWidth')) return JSON.stringify([40, 40]);
        if (expression.includes('rects()')) return rectsJson;
        if (expression.includes('paintProbeTargets')) return '[]';
        return '';
      },
      screenshot: async () => {
        shots++;
        return shots % 2 === 0 ? solidPng(200) : solidPng(10);
      },
    };
    const report = await analyzeSession(page, {
      url: 'https://example.test/',
      instrumentBundle: '',
      keyframes: 2,
      settleMs: 0,
      capturePixels: true,
    });
    expect(report.elements[0]?.selector).toBe('#hero');
    expect(shots).toBe(2); // one viewport shot per keyframe, not one per rect
  });

  test('tolerates malformed and off-screen sub-rects without crashing', async () => {
    // A good rect, a NaN rect (`right` → NaN), and one entirely below the
    // 40px-tall viewport: only the good one yields a crop, and nothing throws.
    const rectsJson = JSON.stringify([
      { key: 'ok', t: 0, rect: { top: 0, right: 10, bottom: 10, left: 0 } },
      {
        key: 'nan',
        t: 0,
        rect: { top: 0, right: 'oops', bottom: 10, left: 0 },
      },
      {
        key: 'below',
        t: 0,
        rect: { top: 900, right: 10, bottom: 950, left: 0 },
      },
    ]);
    const page: PageLike = {
      addInitScript: async () => {},
      goto: async () => {},
      waitForTimeout: async () => {},
      evaluate: async (expression) => {
        if (expression.includes('dump')) return dumpJson;
        if (expression.includes('innerWidth')) return JSON.stringify([40, 40]);
        if (expression.includes('rects()')) return rectsJson;
        if (expression.includes('paintProbeTargets')) return '[]';
        return '';
      },
      screenshot: async () => solidPng(10),
    };
    const report = await analyzeSession(page, {
      url: 'https://example.test/',
      instrumentBundle: '',
      keyframes: 1,
      settleMs: 0,
      capturePixels: true,
    });
    expect(report.elements[0]?.selector).toBe('#hero');
  });
});

describe('capturePixels off / no-screenshot path', () => {
  test('never screenshots and never reads pixel rects when capturePixels is unset', async () => {
    let shots = 0;
    const evals: string[] = [];
    const page: PageLike = {
      addInitScript: async () => {},
      goto: async () => {},
      waitForTimeout: async () => {},
      evaluate: async (expression) => {
        evals.push(expression);
        return expression.includes('dump') ? dumpJson : '';
      },
      // A screenshot IS available, but the off path must not call it.
      screenshot: async () => {
        shots++;
        return solidPng(10);
      },
    };

    const report = await analyzeSession(page, {
      url: 'https://example.test/',
      instrumentBundle: '',
      keyframes: 3,
      settleMs: 0,
      // capturePixels deliberately omitted.
    });

    expect(report.elements[0]?.selector).toBe('#hero');
    expect(shots).toBe(0);
    // The pixel-only evaluate calls (viewport size, rects(), probe targets) are
    // skipped entirely on the no-screenshot path.
    expect(evals.some((e) => e.includes('innerWidth'))).toBe(false);
    expect(evals.some((e) => e.includes('rects()'))).toBe(false);
    expect(evals.some((e) => e.includes('paintProbeTargets'))).toBe(false);
  });

  test('also skips screenshots when capturePixels is on but the page has no screenshot fn', async () => {
    // No `screenshot` on the surface → `shot` resolves undefined even with
    // capturePixels true, so the pixel frame work is skipped.
    const evals: string[] = [];
    const page: PageLike = {
      addInitScript: async () => {},
      goto: async () => {},
      waitForTimeout: async () => {},
      evaluate: async (expression) => {
        evals.push(expression);
        return expression.includes('dump') ? dumpJson : '';
      },
    };

    const report = await analyzeSession(page, {
      url: 'https://example.test/',
      instrumentBundle: '',
      keyframes: 2,
      settleMs: 0,
      capturePixels: true,
    });

    expect(report.elements[0]?.selector).toBe('#hero');
    expect(evals.some((e) => e.includes('innerWidth'))).toBe(false);
  });
});

describe('interact hook + scroll path', () => {
  test('runs interact before the keyframe loop and threads the page through', async () => {
    const order: string[] = [];
    const page: PageLike = {
      addInitScript: async () => {},
      goto: async () => {
        order.push('goto');
      },
      waitForTimeout: async () => {
        order.push('wait');
      },
      evaluate: async (expression) => {
        if (expression.includes('keyframe')) order.push('keyframe');
        return expression.includes('dump') ? dumpJson : '';
      },
    };

    let samePage = false;
    await analyzeSession(page, {
      url: 'https://example.test/',
      instrumentBundle: '',
      keyframes: 1,
      settleMs: 0,
      interact: async (p) => {
        order.push('interact');
        samePage = p === page;
      },
    });

    // interact gets the same page object, and runs after goto but before any
    // keyframe wait/sweep.
    expect(samePage).toBe(true);
    expect(order).toEqual(['goto', 'interact', 'wait', 'keyframe']);
  });
});

describe('probe-rect parsing + paint counterfactual', () => {
  test('confirms paint for an occluded element when hiding it changes its sub-rect', async () => {
    // Screenshot sequence per keyframe: 1st = visible frame, 2nd = hidden frame.
    // Distinct fills make the visible-vs-hidden crop diff exceed PAINT_CONFIRM
    // (0.02), so the element is confirmed to really paint.
    let shots = 0;
    const probeCalls: { key: string; on: boolean }[] = [];
    const page: PageLike = {
      addInitScript: async () => {},
      goto: async () => {},
      waitForTimeout: async () => {},
      evaluate: async (expression) => {
        if (expression.includes('dump')) return occludedDump;
        if (expression.includes('innerWidth')) return JSON.stringify([40, 40]);
        if (expression.includes('rects()')) return '[]';
        if (expression.includes('paintProbeTargets')) return probeTargetsJson;
        if (expression.includes('setProbe')) {
          // setProbe("va-occ", true|false) — record the toggle the driver drove.
          probeCalls.push({
            key: expression.includes('va-occ') ? 'va-occ' : 'other',
            on: expression.includes('true'),
          });
        }
        return '';
      },
      screenshot: async () => {
        shots++;
        return shots % 2 === 1 ? solidPng(220) : solidPng(10);
      },
    };

    const report = await analyzeSession(page, {
      url: 'https://example.test/',
      instrumentBundle: '',
      keyframes: 1,
      settleMs: 0,
      capturePixels: true,
    });

    // Two screenshots: the visible frame and the hidden (probe) frame.
    expect(shots).toBe(2);
    // The probe was hidden then restored for the single target.
    expect(probeCalls).toEqual([
      { key: 'va-occ', on: true },
      { key: 'va-occ', on: false },
    ]);
    // Confirmation cleared the occlusion, so the element now has paint impact
    // and appears in the report (it would be dropped without confirmation).
    const el = report.elements.find((e) => e.selector === '#probe');
    expect(el).toBeDefined();
    expect(el?.impactMode).toContain('paints');
  });

  test('does NOT confirm paint when hiding the element leaves the sub-rect unchanged', async () => {
    // Every screenshot is identical, so the visible-vs-hidden crop diff is 0 (<
    // PAINT_CONFIRM): the occluded element is never confirmed and stays dropped.
    let shots = 0;
    const probeCalls: boolean[] = [];
    const page: PageLike = {
      addInitScript: async () => {},
      goto: async () => {},
      waitForTimeout: async () => {},
      evaluate: async (expression) => {
        if (expression.includes('dump')) return occludedDump;
        if (expression.includes('innerWidth')) return JSON.stringify([40, 40]);
        if (expression.includes('rects()')) return '[]';
        if (expression.includes('paintProbeTargets')) return probeTargetsJson;
        if (expression.includes('setProbe'))
          probeCalls.push(expression.includes('true'));
        return '';
      },
      screenshot: async () => {
        shots++;
        return solidPng(128); // identical visible & hidden frames
      },
    };

    const report = await analyzeSession(page, {
      url: 'https://example.test/',
      instrumentBundle: '',
      keyframes: 1,
      settleMs: 0,
      capturePixels: true,
    });

    // The probe loop still ran (hide then restore), but no confirmation landed.
    expect(shots).toBe(2);
    expect(probeCalls).toEqual([true, false]);
    // Occlusion was never cleared → effectivePaint stays false → dropped.
    expect(
      report.elements.find((e) => e.selector === '#probe'),
    ).toBeUndefined();
  });
});

describe('screenshot failure (catch path)', () => {
  test('skips the visible frame entirely when the screenshot throws', async () => {
    // The visible-frame screenshot rejects: the catch warns and returns null, so
    // capturePixelFrame bails before reading rects() or probe targets.
    const evals: string[] = [];
    const page: PageLike = {
      addInitScript: async () => {},
      goto: async () => {},
      waitForTimeout: async () => {},
      evaluate: async (expression) => {
        evals.push(expression);
        if (expression.includes('dump')) return dumpJson;
        if (expression.includes('innerWidth')) return JSON.stringify([40, 40]);
        return '';
      },
      screenshot: async () => {
        throw new Error('boom');
      },
    };

    const report = await analyzeSession(page, {
      url: 'https://example.test/',
      instrumentBundle: '',
      keyframes: 1,
      settleMs: 0,
      capturePixels: true,
    });

    // The session still completes and returns a report.
    expect(report.elements[0]?.selector).toBe('#hero');
    // Viewport size was read (it precedes the failing shot), but the frame bailed
    // before reading the tracked rects or probe targets.
    expect(evals.some((e) => e.includes('innerWidth'))).toBe(true);
    expect(evals.some((e) => e.includes('rects()'))).toBe(false);
    expect(evals.some((e) => e.includes('paintProbeTargets'))).toBe(false);
  });

  test('skips the paint counterfactual when the hidden-frame screenshot throws', async () => {
    // The visible frame succeeds; the SECOND screenshot (hidden frame) throws.
    // The catch returns null → the probe is still restored, but no confirmation
    // is attempted, so the occluded element stays dropped.
    let shots = 0;
    const probeCalls: boolean[] = [];
    const page: PageLike = {
      addInitScript: async () => {},
      goto: async () => {},
      waitForTimeout: async () => {},
      evaluate: async (expression) => {
        if (expression.includes('dump')) return occludedDump;
        if (expression.includes('innerWidth')) return JSON.stringify([40, 40]);
        if (expression.includes('rects()')) return '[]';
        if (expression.includes('paintProbeTargets')) return probeTargetsJson;
        if (expression.includes('setProbe'))
          probeCalls.push(expression.includes('true'));
        return '';
      },
      screenshot: async () => {
        shots++;
        if (shots === 2) throw new Error('hidden shot failed');
        return solidPng(220);
      },
    };

    const report = await analyzeSession(page, {
      url: 'https://example.test/',
      instrumentBundle: '',
      keyframes: 1,
      settleMs: 0,
      capturePixels: true,
    });

    expect(shots).toBe(2);
    // The probe was hidden and restored even though the hidden shot failed.
    expect(probeCalls).toEqual([true, false]);
    // No confirmation → occlusion intact → element dropped.
    expect(
      report.elements.find((e) => e.selector === '#probe'),
    ).toBeUndefined();
  });
});
