import { describe, expect, test } from 'bun:test';

import { must, rect, recording, sample, track } from '../test-fixtures';
import type { ElementTrack } from '../types';
import { analyzeDefects, type Survivor } from './analyze';

function survivor(t: ElementTrack): Survivor {
  return { track: t, testid: t.testid, selector: t.selector };
}

describe('jank', () => {
  test('sustained stutter (repeated teleports) is flagged and lowers quality', () => {
    // Two big jumps among small steps — sustained jank, not a one-off shift.
    const lefts = [0, 5, 10, 15, 20, 210, 215, 220, 225, 415];
    const ts = [0, 16, 32, 48, 64, 128, 144, 160, 176, 192];
    const mover = track({
      key: 'va-move',
      samples: lefts.map((left, f) =>
        sample({
          t: must(ts[f], 't'),
          frame: f,
          screen: rect(0, left + 100, 50, left),
        }),
      ),
    });
    const { defects, transitions } = analyzeDefects(
      [survivor(mover)],
      recording([mover]),
    );
    const jank = must(
      defects.find((d) => d.type === 'jank'),
      'jank',
    );
    expect(jank.metrics.droppedFrames).toBe(1);
    expect(jank.metrics.maxJumpPx).toBe(190);
    const transition = must(transitions[0], 'transition');
    expect(transition.smoothness).toBe('janky');
    expect(transition.quality).toBeLessThan(1);
  });

  test('smooth continuous motion is not jank', () => {
    const mover = track({
      key: 'va-smooth',
      samples: [0, 1, 2, 3, 4].map((f) =>
        sample({
          t: f * 16,
          frame: f,
          screen: rect(0, 100 + 10 * f, 50, 10 * f),
        }),
      ),
    });
    const { defects, transitions } = analyzeDefects(
      [survivor(mover)],
      recording([mover]),
    );
    expect(defects.some((d) => d.type === 'jank')).toBe(false);
    expect(must(transitions[0], 'transition').smoothness).toBe('smooth');
    expect(must(transitions[0], 'transition').kind).toBe('move');
  });

  test('a centre-grow resize never janks, even when its corner teleports (hadMove gate, regression)', () => {
    // The box grows symmetrically about its centre, so opposite edges move in
    // opposite directions: translation is zero (hadMove=false) even though the
    // top-left corner jumps ~85px between frames. Jank is for MOTION, so a resize
    // must never jank — `scoreJank` (which reads the corner) is gated on hadMove.
    const widths = [20, 24, 144, 148, 268];
    const grow = track({
      key: 'va-grow',
      samples: widths.map((w, f) => {
        const half = w / 2;
        return sample({
          t: f * 16,
          frame: f,
          screen: rect(100 - half, 100 + half, 100 + half, 100 - half),
        });
      }),
    });
    const { defects, transitions } = analyzeDefects(
      [survivor(grow)],
      recording([grow]),
    );
    expect(defects.some((d) => d.type === 'jank')).toBe(false);
    expect(must(transitions[0], 'transition').kind).toBe('resize');
  });

  test('pure scrolling is not motion or jank', () => {
    // Screen position changes every frame, page position is constant.
    const scrolled = track({
      key: 'va-scroll',
      samples: [0, 1, 2, 3].map((f) =>
        sample({
          t: f * 16,
          frame: f,
          screen: rect(200 - 100 * f, 300, 250 - 100 * f, 0),
          page: rect(200, 300, 250, 0),
        }),
      ),
    });
    const { defects, transitions } = analyzeDefects(
      [survivor(scrolled)],
      recording([scrolled]),
    );
    expect(transitions).toEqual([]);
    expect(defects).toEqual([]);
  });
});

describe('transition kinds', () => {
  test('resize when only the size changes', () => {
    const el = track({
      key: 'va-resize',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0) }),
        sample({ t: 16, frame: 1, screen: rect(0, 100, 90, 0) }),
      ],
    });
    const { transitions } = analyzeDefects([survivor(el)], recording([el]));
    expect(must(transitions[0], 't').kind).toBe('resize');
  });

  test('fade when only opacity changes', () => {
    const el = track({
      key: 'va-fade',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0), opacity: 1 }),
        sample({ t: 16, frame: 1, screen: rect(0, 100, 50, 0), opacity: 0.5 }),
      ],
    });
    const { transitions } = analyzeDefects([survivor(el)], recording([el]));
    expect(must(transitions[0], 't').kind).toBe('fade');
  });

  test('composite when geometry and opacity change together', () => {
    const el = track({
      key: 'va-composite',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0), opacity: 1 }),
        sample({
          t: 16,
          frame: 1,
          screen: rect(20, 120, 70, 20),
          opacity: 0.5,
        }),
      ],
    });
    const { transitions } = analyzeDefects([survivor(el)], recording([el]));
    expect(must(transitions[0], 't').kind).toBe('composite');
  });

  test('color when only the computed colour changes', () => {
    const el = track({
      key: 'va-color',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0), colorKey: 111 }),
        sample({ t: 16, frame: 1, screen: rect(0, 100, 50, 0), colorKey: 222 }),
      ],
    });
    const { transitions } = analyzeDefects([survivor(el)], recording([el]));
    expect(must(transitions[0], 't').kind).toBe('color');
  });

  test('composite when colour and geometry change together', () => {
    const el = track({
      key: 'va-color-move',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0), colorKey: 1 }),
        sample({ t: 16, frame: 1, screen: rect(20, 120, 70, 20), colorKey: 2 }),
      ],
    });
    const { transitions } = analyzeDefects([survivor(el)], recording([el]));
    expect(must(transitions[0], 't').kind).toBe('composite');
  });
});

describe('motion detector ignores size-only changes', () => {
  // Each case is a pure resize: it must read as `resize`, never trigger motion,
  // and never be scored as jank.
  const expectResizeNotMotion = (
    a: ReturnType<typeof rect>,
    b: ReturnType<typeof rect>,
  ) => {
    const el = track({
      key: 'va-size',
      samples: [
        sample({ t: 0, frame: 0, screen: a }),
        sample({ t: 16, frame: 1, screen: b }),
      ],
    });
    const { defects, transitions } = analyzeDefects(
      [survivor(el)],
      recording([el]),
    );
    const t = must(transitions[0], 't');
    expect(t.kind).toBe('resize');
    expect(t.smoothness).toBe('smooth');
    expect(defects.some((d) => d.type === 'jank')).toBe(false);
  };

  test('grow anchored at the top-left corner', () => {
    expectResizeNotMotion(rect(0, 100, 50, 0), rect(0, 140, 90, 0));
  });
  test('grow anchored at the bottom-right corner', () => {
    expectResizeNotMotion(rect(0, 100, 50, 0), rect(-40, 100, 50, -40));
  });
  test('symmetric grow about the centre', () => {
    expectResizeNotMotion(rect(10, 90, 90, 10), rect(0, 100, 100, 0));
  });
});

describe('flicker', () => {
  test('visible→hidden→visible within 100ms is flagged', () => {
    const el = track({
      key: 'va-flicker',
      selector: '.overlay',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0), opacity: 1 }),
        sample({ t: 30, frame: 1, screen: rect(0, 100, 50, 0), opacity: 0 }),
        sample({ t: 60, frame: 2, screen: rect(0, 100, 50, 0), opacity: 1 }),
      ],
    });
    const { defects, transitions } = analyzeDefects(
      [survivor(el)],
      recording([el]),
    );
    const flicker = must(
      defects.find((d) => d.type === 'flicker'),
      'flicker',
    );
    expect(flicker.metrics.toggleCount).toBe(2);
    expect(transitions.some((t) => t.smoothness === 'flicker')).toBe(true);
  });

  test('a flicker docks the overlapping transition quality and links the defect', () => {
    // Geometry is constant and frames stay within budget (no jank), so quality
    // is driven purely by the flat 0.5 flicker penalty: 1 − 0 − 0.5 = 0.5.
    const el = track({
      key: 'va-flicker2',
      selector: '.overlay',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0), opacity: 1 }),
        sample({ t: 16, frame: 1, screen: rect(0, 100, 50, 0), opacity: 0 }),
        sample({ t: 32, frame: 2, screen: rect(0, 100, 50, 0), opacity: 1 }),
      ],
    });
    const { defects, transitions } = analyzeDefects(
      [survivor(el)],
      recording([el]),
    );
    const flicker = must(
      defects.find((d) => d.type === 'flicker'),
      'flicker',
    );
    const transition = must(
      transitions.find((t) => t.smoothness === 'flicker'),
      'flicker transition',
    );
    expect(transition.quality).toBeCloseTo(0.5, 5);
    expect(transition.defects).toContain(flicker.id);
  });

  test('a slow monotonic fade does not flicker', () => {
    const el = track({
      key: 'va-fade',
      samples: [0, 1, 2, 3].map((f) =>
        sample({
          t: f * 40,
          frame: f,
          screen: rect(0, 100, 50, 0),
          opacity: 1 - f * 0.25,
        }),
      ),
    });
    const { defects } = analyzeDefects([survivor(el)], recording([el]));
    expect(defects.some((d) => d.type === 'flicker')).toBe(false);
  });
});

describe('dithering', () => {
  test('pixel noise on a NON-media element is not dithering (only media churns)', () => {
    const el = track({
      key: 'va-div',
      selector: '#box',
      tag: 'DIV',
      samples: [0, 1, 2].map((f) =>
        sample({
          t: f * 16,
          frame: f,
          screen: rect(0, 100, 50, 0),
          pixelNoise: 0.2,
        }),
      ),
    });
    const { defects } = analyzeDefects([survivor(el)], recording([el]));
    expect(defects.some((d) => d.type === 'dithering')).toBe(false);
  });

  test('pixel noise in a static region is flagged', () => {
    const el = track({
      key: 'va-dither',
      selector: '.gradient',
      tag: 'CANVAS',
      samples: [0, 1, 2].map((f) =>
        sample({
          t: f * 16,
          frame: f,
          screen: rect(0, 100, 50, 0),
          pixelNoise: 0.2,
        }),
      ),
    });
    const { defects } = analyzeDefects([survivor(el)], recording([el]));
    const dither = must(
      defects.find((d) => d.type === 'dithering'),
      'dither',
    );
    expect(dither.metrics.frames).toBe(3);
    expect(dither.severity).toBeCloseTo(0.2, 5);
  });

  test('a namespaced inline <svg> (lowercase tag) can dither (regression)', () => {
    // The media gate keys on uppercase 'SVG' but a real <svg>.tag is 'svg';
    // without normalising the case the host never reaches detectDithering.
    const el = track({
      key: 'va-svg',
      selector: '#svg',
      tag: 'svg',
      samples: [0, 1, 2].map((f) =>
        sample({
          t: f * 16,
          frame: f,
          screen: rect(0, 100, 50, 0),
          pixelNoise: 0.2,
        }),
      ),
    });
    const { defects } = analyzeDefects([survivor(el)], recording([el]));
    expect(defects.some((d) => d.type === 'dithering')).toBe(true);
  });

  test('null pixelNoise frames produce no dithering', () => {
    const el = track({
      key: 'va-clean',
      samples: [0, 1, 2].map((f) =>
        sample({ t: f * 16, frame: f, screen: rect(0, 100, 50, 0) }),
      ),
    });
    const { defects } = analyzeDefects([survivor(el)], recording([el]));
    expect(defects.some((d) => d.type === 'dithering')).toBe(false);
  });
});

describe('layout-shift', () => {
  const footer = track({
    key: 'cand-footer',
    kind: 'candidate',
    selector: 'footer',
    samples: [
      sample({ t: 0, frame: 0, screen: rect(120, 200, 140, 0) }),
      sample({ t: 16, frame: 1, screen: rect(120, 200, 140, 0) }),
      sample({ t: 32, frame: 2, screen: rect(180, 200, 200, 0) }),
    ],
  });
  const shift = {
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
  };

  test('reports the shift and links it to the overlapping transition', () => {
    const { defects, transitions } = analyzeDefects(
      [survivor(footer)],
      recording([footer], [shift]),
    );
    const defect = must(
      defects.find((d) => d.type === 'layout-shift'),
      'shift',
    );
    expect(defect.severity).toBeCloseTo(0.18, 5);
    expect(defect.selector).toBe('footer');
    const moved = must(
      transitions.find((t) => t.smoothness === 'shift'),
      'shift transition',
    );
    expect(moved.defects).toContain(defect.id);
  });

  test('user-initiated shifts (hadRecentInput) are ignored', () => {
    const { defects } = analyzeDefects(
      [survivor(footer)],
      recording([footer], [{ ...shift, hadRecentInput: true }]),
    );
    expect(defects.some((d) => d.type === 'layout-shift')).toBe(false);
  });

  test('an unattributed (null-source) perceptible shift is surfaced at page level', () => {
    const nullShift = {
      t: 32,
      segment: 0,
      value: 0.04,
      hadRecentInput: false,
      sources: [
        {
          key: null,
          previousRect: rect(0, 0, 0, 0),
          currentRect: rect(0, 0, 0, 0),
        },
      ],
    };
    const { defects } = analyzeDefects(
      [survivor(footer)],
      recording([footer], [nullShift]),
    );
    const d = must(
      defects.find((x) => x.type === 'layout-shift'),
      'page shift',
    );
    expect(d.selector).toBe('(page)');
    expect(d.severity).toBeCloseTo(0.04, 5);
  });

  test('a sub-threshold unattributed shift is dropped (no reflow noise)', () => {
    const tiny = {
      t: 32,
      segment: 0,
      value: 0.002,
      hadRecentInput: false,
      sources: [
        {
          key: null,
          previousRect: rect(0, 0, 0, 0),
          currentRect: rect(0, 0, 0, 0),
        },
      ],
    };
    const { defects } = analyzeDefects(
      [survivor(footer)],
      recording([footer], [tiny]),
    );
    expect(defects.some((d) => d.type === 'layout-shift')).toBe(false);
  });

  test('many sub-threshold unattributed shifts sum to one cumulative page shift (regression)', () => {
    // Each individual shift is below the 0.01 floor, but their sum is real
    // cumulative CLS that death-by-a-thousand-cuts would otherwise hide.
    const shifts = [0, 1, 2, 3, 4, 5].map((i) => ({
      t: i * 16,
      segment: 0,
      value: 0.004,
      hadRecentInput: false,
      sources: [
        {
          key: null,
          previousRect: rect(0, 0, 0, 0),
          currentRect: rect(0, 0, 0, 0),
        },
      ],
    }));
    const { defects } = analyzeDefects(
      [survivor(footer)],
      recording([footer], shifts),
    );
    const page = defects.filter(
      (d) => d.type === 'layout-shift' && d.selector === '(page)',
    );
    expect(page.length).toBe(1);
    const d = must(page[0], 'cumulative page shift');
    expect(d.metrics.cumulative).toBe(true);
    expect(d.metrics.shiftCount).toBe(6);
    expect(d.severity).toBeCloseTo(0.024, 5);
  });
});
