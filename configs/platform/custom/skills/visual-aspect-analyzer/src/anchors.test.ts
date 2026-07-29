import { describe, expect, test } from 'bun:test';

import { computeAnchor, elementBounds } from './anchors';
import { must, rect, sample, track } from './test-fixtures';
import type { ElementTrack } from './types';

function byKey(tracks: readonly ElementTrack[]): Map<string, ElementTrack> {
  return new Map(tracks.map((t) => [t.key, t]));
}

const sorted = (edges: readonly string[]): string[] => [...edges].sort();

describe('computeAnchor', () => {
  test('screen: fixed in the viewport while both axes scroll', () => {
    const bar = track({
      key: 'va-bar',
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
    });
    const result = computeAnchor(bar, byKey([bar]), 1);
    expect(result.anchoredTo).toBe('screen');
    expect(sorted(result.anchoredEdges)).toEqual([
      'bottom',
      'left',
      'right',
      'top',
    ]);
  });

  test('screen: a fixed bar scrolled ONLY vertically (constant horizontal page edges)', () => {
    // The common real case: the page scrolls vertically only, so the fixed bar's
    // left/right page-edges stay constant while top/bottom move. Requiring NO
    // constant page edge would wrongly miss this — top/bottom are the tell.
    const bar = track({
      key: 'va-bar',
      samples: [0, 100, 200].map((y, f) =>
        sample({
          t: f * 16,
          frame: f,
          screen: rect(0, 300, 50, 0),
          page: rect(y, 300, 50 + y, 0),
        }),
      ),
    });
    const result = computeAnchor(bar, byKey([bar]), 1);
    expect(result.anchoredTo).toBe('screen');
    expect(sorted(result.anchoredEdges)).toEqual(['bottom', 'top']);
  });

  // Round 5 regression (scroll-container-deep-24): browser scroll-anchoring holds a
  // STATIC in-flow element's screen position for a frame when content is inserted
  // above it — the same screen-held-while-page-scrolls signature as a real pin.
  // Screen anchoring is gated on `canPin` (the element is fixed/sticky, self or
  // ancestor) so the static case is not a false `screen` anchor; the pinnable case
  // still is. (Samples with no `canPin` keep the prior behaviour — see other tests.)
  test('screen anchoring is gated on canPin: a static scroll-anchored element is not screen', () => {
    const mk = (canPin: boolean) =>
      track({
        key: 'va-el',
        samples: [
          {
            t: 0,
            frame: 0,
            screen: rect(0, 300, 50, 0),
            page: rect(0, 300, 50, 0),
          },
          {
            t: 16,
            frame: 1,
            screen: rect(0, 300, 50, 0),
            page: rect(100, 350, 150, 50),
          },
          {
            t: 32,
            frame: 2,
            screen: rect(0, 300, 50, 0),
            page: rect(200, 400, 250, 100),
          },
        ].map((o) => sample({ ...o, canPin })),
      });
    const staticEl = mk(false);
    expect(computeAnchor(staticEl, byKey([staticEl]), 1).anchoredTo).not.toBe(
      'screen',
    );
    const pinnableEl = mk(true);
    expect(computeAnchor(pinnableEl, byKey([pinnableEl]), 1).anchoredTo).toBe(
      'screen',
    );
  });

  test('screen: a sticky element that pins mid-scroll (tolerates the scroll reset)', () => {
    // In flow its screen edge rides up with the scroll; once stuck it pins at 0
    // while the page scrolls under it. A final reset-to-top un-sticks it (one
    // slipped pair) — the majority of scrolling frames are still pinned.
    const mk = (f: number, scr: number, stuck: boolean) => {
      const top = stuck ? 0 : 200 - scr;
      return sample({
        t: f * 16,
        frame: f,
        screen: rect(top, 100, top + 40, 0),
        page: rect(top + scr, 100, top + 40 + scr, 0),
      });
    };
    const s = track({
      key: 'va-s',
      samples: [
        mk(0, 0, false),
        mk(1, 300, true),
        mk(2, 400, true),
        mk(3, 500, true),
        mk(4, 600, true),
        mk(5, 0, false),
      ],
    });
    const result = computeAnchor(s, byKey([s]), 1);
    expect(result.anchoredTo).toBe('screen');
    expect(result.anchoredEdges).toContain('top');
  });

  test('page: fixed in the document while the page scrolls', () => {
    const article = track({
      key: 'va-article',
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
    });
    const result = computeAnchor(article, byKey([article]), 1);
    expect(result.anchoredTo).toBe('page');
    expect(sorted(result.anchoredEdges)).toEqual([
      'bottom',
      'left',
      'right',
      'top',
    ]);
  });

  test('ancestor: resolves to the highest ancestor preserving the parent set', () => {
    const lockstep = (
      key: string,
      base: ReturnType<typeof rect>,
      selector: string,
    ) =>
      track({
        key,
        kind: 'candidate',
        selector,
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
          }),
        ),
      });

    const child = track({
      key: 'va-child',
      selector: '#badge',
      ancestorKeys: ['anc-parent', 'anc-grand', 'anc-gg'],
      samples: [0, 1, 2].map((f) =>
        sample({
          t: f * 16,
          frame: f,
          screen: rect(10 + 10 * f, 110 + 10 * f, 60 + 10 * f, 10 + 10 * f),
        }),
      ),
    });
    const parent = lockstep('anc-parent', rect(0, 200, 200, 0), '#card-inner');
    const grand = lockstep('anc-grand', rect(-10, 220, 220, -10), '#card');
    const gg = track({
      key: 'anc-gg',
      kind: 'candidate',
      selector: '#page',
      samples: [0, 1, 2].map((f) =>
        sample({ t: f * 16, frame: f, screen: rect(0, 300, 300, 0) }),
      ),
    });

    const result = computeAnchor(child, byKey([child, parent, grand, gg]), 1);
    expect(result.anchoredTo).toBe('#card');
    expect(sorted(result.anchoredEdges)).toEqual([
      'bottom',
      'left',
      'right',
      'top',
    ]);
  });

  test('null: nothing holds a freely moving element with no ancestors', () => {
    const free = track({
      key: 'va-free',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 10, 10, 0) }),
        sample({ t: 16, frame: 1, screen: rect(20, 40, 40, 20) }),
      ],
    });
    const result = computeAnchor(free, byKey([free]), 1);
    expect(result.anchoredTo).toBeNull();
    expect(result.anchoredEdges).toEqual([]);
  });

  test('null for an element with no samples', () => {
    const empty = track({ key: 'va-empty', samples: [] });
    expect(computeAnchor(empty, byKey([empty]), 1).anchoredTo).toBeNull();
  });

  test('a present-but-non-anchoring parent yields null', () => {
    // The parent is a fixed box; the child drifts on all four edges in page
    // space every frame, so no edge keeps a constant offset to the parent and
    // offsetAnchoredEdges() is empty. With no screen-pin and not page-fixed, the
    // resolver falls through `if (base.length > 0)` to anchoredTo: null.
    const parent = track({
      key: 'anc-parent',
      selector: '#card',
      kind: 'candidate',
      samples: [0, 1, 2].map((f) =>
        sample({
          t: f * 16,
          frame: f,
          screen: rect(0, 200, 200, 0),
          page: rect(0, 200, 200, 0),
        }),
      ),
    });
    const child = track({
      key: 'anc-child',
      selector: '#badge',
      ancestorKeys: ['anc-parent'],
      samples: [0, 1, 2].map((f) =>
        sample({
          t: f * 16,
          frame: f,
          // Drifts by 7px/frame on all edges in BOTH spaces: never page-fixed,
          // never screen-pinned, never a constant offset to the parent.
          screen: rect(7 * f, 50 + 7 * f, 30 + 7 * f, 7 * f),
          page: rect(7 * f, 50 + 7 * f, 30 + 7 * f, 7 * f),
        }),
      ),
    });

    const result = computeAnchor(child, byKey([child, parent]), 1);
    expect(result.anchoredTo).toBeNull();
    expect(result.anchoredEdges).toEqual([]);
  });

  test('an ancestor sharing NO sampled frames does not fabricate a 4-edge anchor', () => {
    // The child and its parent are sampled in disjoint frame ranges (late
    // discovery: the parent at 0-2, the child at 10-12). offsetAnchoredEdges has
    // no shared frame to measure an offset on, so each edge's offset series is
    // empty — and isConstant([]) is vacuously true. The resolver must NOT read
    // that as "anchored on all four edges" to the parent: there is zero evidence
    // of any offset relationship, so the honest answer is null (a freely moving
    // element). This mirrors screenAnchoredEdges requiring a real scrolling pair.
    const parent = track({
      key: 'anc-parent',
      selector: '#card',
      kind: 'candidate',
      samples: [0, 1, 2].map((f) =>
        sample({
          t: f * 16,
          frame: f,
          screen: rect(0, 200, 200, 0),
          page: rect(0, 200, 200, 0),
        }),
      ),
    });
    const child = track({
      key: 'anc-child',
      selector: '#badge',
      ancestorKeys: ['anc-parent'],
      // Frames 10-12 (disjoint from the parent's 0-2); drifts 7px/frame in both
      // spaces, so it is neither page-fixed nor screen-pinned and must fall to the
      // ancestor branch — where the no-overlap series must not vacuously anchor.
      samples: [10, 11, 12].map((f) =>
        sample({
          t: f * 16,
          frame: f,
          screen: rect(7 * f, 50 + 7 * f, 30 + 7 * f, 7 * f),
          page: rect(7 * f, 50 + 7 * f, 30 + 7 * f, 7 * f),
        }),
      ),
    });

    const result = computeAnchor(child, byKey([child, parent]), 1);
    expect(result.anchoredTo).toBeNull();
    expect(result.anchoredEdges).toEqual([]);
  });

  test('a single coincidental shared frame is not enough to anchor to an ancestor', () => {
    // The child and parent overlap on exactly ONE frame (frame 2). A constant
    // offset cannot be established from a single observation — its spread is
    // trivially 0 — so one coincidental shared frame must not be promoted to a
    // confident ancestor anchor. A real offset anchor needs the offset to hold
    // across ≥2 frames.
    const parent = track({
      key: 'anc-parent',
      selector: '#card',
      kind: 'candidate',
      samples: [0, 1, 2].map((f) =>
        sample({
          t: f * 16,
          frame: f,
          screen: rect(0, 200, 200, 0),
          page: rect(0, 200, 200, 0),
        }),
      ),
    });
    const child = track({
      key: 'anc-child',
      selector: '#badge',
      ancestorKeys: ['anc-parent'],
      // Frames 2-4 overlap the parent only at frame 2; drifts 7px/frame in both
      // spaces (never page-fixed, never screen-pinned → reaches the ancestor walk).
      samples: [2, 3, 4].map((f) =>
        sample({
          t: f * 16,
          frame: f,
          screen: rect(7 * f, 50 + 7 * f, 30 + 7 * f, 7 * f),
          page: rect(7 * f, 50 + 7 * f, 30 + 7 * f, 7 * f),
        }),
      ),
    });

    const result = computeAnchor(child, byKey([child, parent]), 1);
    expect(result.anchoredTo).toBeNull();
    expect(result.anchoredEdges).toEqual([]);
  });

  test('computes from the most-sampled segment, isolating a minority segment', () => {
    const el = track({
      key: 'va-multi',
      samples: [
        // Segment 0 (the majority): page-anchored — page box held, screen scrolls.
        sample({
          t: 0,
          frame: 0,
          segment: 0,
          screen: rect(100, 300, 200, 0),
          page: rect(100, 300, 200, 0),
        }),
        sample({
          t: 16,
          frame: 1,
          segment: 0,
          screen: rect(50, 300, 150, 0),
          page: rect(100, 300, 200, 0),
        }),
        sample({
          t: 32,
          frame: 2,
          segment: 0,
          screen: rect(0, 300, 100, 0),
          page: rect(100, 300, 200, 0),
        }),
        // Segment 1 (minority): an unrelated box that would break page-constancy
        // if the segments were mixed instead of isolated.
        sample({
          t: 48,
          frame: 3,
          segment: 1,
          screen: rect(0, 999, 0, 999),
          page: rect(0, 999, 0, 999),
        }),
      ],
    });
    const result = computeAnchor(el, byKey([el]), 1);
    expect(result.anchoredTo).toBe('page');
    expect(sorted(result.anchoredEdges)).toEqual([
      'bottom',
      'left',
      'right',
      'top',
    ]);
  });
});

describe('elementBounds', () => {
  test('takes start/end from the first and last sample of the primary segment', () => {
    const el = track({
      key: 'va-1',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0) }),
        sample({ t: 16, frame: 1, screen: rect(5, 105, 55, 5) }),
        sample({ t: 32, frame: 2, screen: rect(20, 120, 70, 20) }),
      ],
    });
    const b = must(elementBounds(el) ?? undefined, 'bounds');
    expect(b.screen.start).toEqual(rect(0, 100, 50, 0));
    expect(b.screen.end).toEqual(rect(20, 120, 70, 20));
  });

  test('screen and page boxes diverge under scroll', () => {
    const el = track({
      key: 'va-1',
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
          screen: rect(0, 100, 50, 0),
          page: rect(200, 100, 250, 0),
        }),
      ],
    });
    const b = must(elementBounds(el) ?? undefined, 'bounds');
    expect(b.screen.end).toEqual(rect(0, 100, 50, 0));
    expect(b.page.end).toEqual(rect(200, 100, 250, 0));
  });

  test('uses the most-sampled segment, ignoring a minority-segment outlier', () => {
    const el = track({
      key: 'va-1',
      samples: [
        sample({ t: 0, frame: 0, segment: 0, screen: rect(0, 100, 50, 0) }),
        sample({ t: 16, frame: 1, segment: 0, screen: rect(10, 110, 60, 10) }),
        sample({
          t: 32,
          frame: 2,
          segment: 1,
          screen: rect(999, 999, 999, 999),
        }),
      ],
    });
    const b = must(elementBounds(el) ?? undefined, 'bounds');
    expect(b.screen.start).toEqual(rect(0, 100, 50, 0));
    // Last of segment 0, not the segment-1 outlier.
    expect(b.screen.end).toEqual(rect(10, 110, 60, 10));
  });

  test('null for a sample-less track', () => {
    expect(elementBounds(track({ key: 'va-empty', samples: [] }))).toBeNull();
  });
});
