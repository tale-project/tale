import { describe, expect, test } from 'bun:test';

import {
  computeAffected,
  effectivePaint,
  hasLayoutImpact,
  hasPaintImpact,
  paintIntervals,
} from './impact';
import { rect, recording, sample, track } from './test-fixtures';

describe('effectivePaint', () => {
  const base = sample({ t: 0, frame: 0, screen: rect(0, 10, 10, 0) });

  test('true when painting, visible, in viewport, opaque, unoccluded', () => {
    expect(effectivePaint(base)).toBe(true);
  });
  test('false when not painting', () => {
    expect(effectivePaint({ ...base, paints: false })).toBe(false);
  });
  test('false when occluded', () => {
    expect(effectivePaint({ ...base, occluded: true })).toBe(false);
  });
  test('false when outside the viewport', () => {
    expect(effectivePaint({ ...base, inViewport: false })).toBe(false);
  });
  test('false at zero opacity', () => {
    expect(effectivePaint({ ...base, opacity: 0 })).toBe(false);
  });
  test('false when not visible', () => {
    expect(effectivePaint({ ...base, visible: false })).toBe(false);
  });
});

describe('paintIntervals', () => {
  test('merges contiguous painting frames and splits on gaps', () => {
    const el = track({
      key: 'va-1',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 10, 10, 0), paints: true }),
        sample({ t: 10, frame: 1, screen: rect(0, 10, 10, 0), paints: false }),
        sample({ t: 20, frame: 2, screen: rect(0, 10, 10, 0), paints: true }),
        sample({ t: 30, frame: 3, screen: rect(0, 10, 10, 0), paints: true }),
      ],
    });
    expect(paintIntervals(el)).toEqual([
      [0, 0],
      [20, 30],
    ]);
  });
  test('temporal: starts painting only mid-session', () => {
    const el = track({
      key: 'va-1',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 10, 10, 0), paints: false }),
        sample({ t: 16, frame: 1, screen: rect(0, 10, 10, 0), paints: true }),
      ],
    });
    expect(hasPaintImpact(el)).toBe(true);
    expect(paintIntervals(el)).toEqual([[16, 16]]);
  });
  test('no impact when always occluded', () => {
    const el = track({
      key: 'va-1',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 10, 10, 0), occluded: true }),
      ],
    });
    expect(hasPaintImpact(el)).toBe(false);
    expect(paintIntervals(el)).toEqual([]);
  });
});

describe('computeAffected', () => {
  test('attributes co-moving candidates to the tracked cause', () => {
    const block = track({
      key: 'va-block',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 200, 100, 0) }),
        sample({ t: 16, frame: 1, screen: rect(0, 200, 160, 0) }),
      ],
    });
    const footer = track({
      key: 'cand-footer',
      kind: 'candidate',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(120, 200, 140, 0) }),
        sample({ t: 16, frame: 1, screen: rect(180, 200, 200, 0) }),
      ],
    });
    const { affected, layoutCauses } = computeAffected(
      recording([block, footer]),
    );
    expect(affected.get('cand-footer')?.affectedBy).toEqual(['va-block']);
    expect(layoutCauses.has('va-block')).toBe(true);
  });

  test('never attributes a candidate to a cause with the SAME selector (self, regression)', () => {
    // A self-translating element can be double-registered as BOTH a tracked node
    // and a candidate of the same DOM node (same selector). They co-move
    // identically, but it must never be reported "affected by itself".
    const trackedSelf = track({
      key: 'va-self',
      selector: '#self',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0) }),
        sample({ t: 16, frame: 1, screen: rect(40, 140, 90, 40) }),
      ],
    });
    const candidateSelf = track({
      key: 'cand-self',
      kind: 'candidate',
      selector: '#self', // same DOM element, different registration
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0) }),
        sample({ t: 16, frame: 1, screen: rect(40, 140, 90, 40) }),
      ],
    });
    const { affected } = computeAffected(
      recording([trackedSelf, candidateSelf]),
    );
    expect(affected.has('cand-self')).toBe(false);
  });

  test('does not attribute an unrelated candidate that moves alone', () => {
    const block = track({
      key: 'va-block',
      samples: [sample({ t: 0, frame: 0, screen: rect(0, 200, 100, 0) })],
    });
    const other = track({
      key: 'cand-x',
      kind: 'candidate',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 10, 10, 0) }),
        sample({ t: 16, frame: 1, screen: rect(50, 60, 60, 50) }),
      ],
    });
    const { affected } = computeAffected(recording([block, other]));
    expect(affected.has('cand-x')).toBe(false);
  });

  test('does not attribute an OUT-OF-FLOW candidate that self-moved in the same frame', () => {
    // Regression: an absolutely-positioned element that relocates ITSELF in the
    // same frame an unrelated in-flow element grows must NOT be attributed to it —
    // same-frame co-movement is coincidental here, not causal.
    const grower = track({
      key: 'va-block',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 200, 40, 0) }),
        sample({ t: 16, frame: 1, screen: rect(0, 200, 160, 0) }), // grows in flow
      ],
    });
    const drifter = track({
      key: 'cand-drifter',
      kind: 'candidate',
      samples: [
        sample({
          t: 0,
          frame: 0,
          screen: rect(300, 340, 380, 220),
          outOfFlow: true,
        }),
        sample({
          t: 16,
          frame: 1,
          screen: rect(820, 340, 900, 220),
          outOfFlow: true,
        }),
      ],
    });
    const { affected } = computeAffected(recording([grower, drifter]));
    expect(affected.has('cand-drifter')).toBe(false);
  });

  test('attributes an OUT-OF-FLOW candidate to a co-changing ANCESTOR (containing block), not a sibling', () => {
    // An absolute child is not moved by an unrelated in-flow sibling's growth,
    // but IS moved by its own positioned ancestor (containing block) growing.
    const panel = track({
      key: 'panel',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 300, 100, 0) }),
        sample({ t: 16, frame: 1, screen: rect(0, 300, 400, 0) }), // grows tall
      ],
    });
    const sibling = track({
      key: 'sib',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 50, 20, 0) }),
        sample({ t: 16, frame: 1, screen: rect(0, 50, 80, 0) }), // unrelated grower
      ],
    });
    const pinned = track({
      key: 'cand-pinned',
      kind: 'candidate',
      ancestorKeys: ['panel'],
      samples: [
        sample({
          t: 0,
          frame: 0,
          screen: rect(80, 300, 100, 0),
          outOfFlow: true,
        }),
        sample({
          t: 16,
          frame: 1,
          screen: rect(380, 300, 400, 0),
          outOfFlow: true,
        }),
      ],
    });
    const { affected } = computeAffected(recording([panel, sibling, pinned]));
    // Attributed to its ancestor (panel), and NOT the coincidental sibling.
    expect(affected.get('cand-pinned')?.affectedBy).toEqual(['panel']);
  });

  test('still attributes an IN-FLOW candidate co-moving in the same frame (no over-correction)', () => {
    // The same co-movement, but the candidate is in normal flow → genuinely
    // pushed, so it IS attributed. Guards the out-of-flow skip from over-reaching.
    const grower = track({
      key: 'va-block',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 200, 100, 0) }),
        sample({ t: 16, frame: 1, screen: rect(0, 200, 160, 0) }),
      ],
    });
    const pushed = track({
      key: 'cand-pushed',
      kind: 'candidate',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(120, 200, 140, 0) }),
        sample({ t: 16, frame: 1, screen: rect(180, 200, 200, 0) }),
      ],
    });
    const { affected } = computeAffected(recording([grower, pushed]));
    expect(affected.get('cand-pushed')?.affectedBy).toEqual(['va-block']);
  });

  test('does not attribute a candidate that only RESIZED (a cause, not a victim)', () => {
    const block = track({
      key: 'va-block',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 200, 100, 0) }),
        sample({ t: 16, frame: 1, screen: rect(0, 200, 160, 0) }),
      ],
    });
    // Grows downward in the same frame: top-left fixed, only the bottom moves —
    // a resize, which means it is itself a cause, never "affected".
    const grower = track({
      key: 'cand-grow',
      kind: 'candidate',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 50, 20, 0) }),
        sample({ t: 16, frame: 1, screen: rect(0, 50, 80, 0) }),
      ],
    });
    const { affected } = computeAffected(recording([block, grower]));
    expect(affected.has('cand-grow')).toBe(false);
  });

  test('layout-shift sources co-occurring with a tracked change attribute', () => {
    const block = track({
      key: 'va-block',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 200, 100, 0) }),
        sample({ t: 32, frame: 2, screen: rect(0, 200, 160, 0) }),
      ],
    });
    const footer = track({
      key: 'cand-footer',
      kind: 'candidate',
      samples: [sample({ t: 0, frame: 0, screen: rect(120, 200, 140, 0) })],
    });
    const { affected } = computeAffected(
      recording(
        [block, footer],
        [
          {
            t: 32,
            segment: 0,
            value: 0.2,
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
    expect(affected.get('cand-footer')?.affectedBy).toEqual(['va-block']);
  });

  // Round 8 regression (details-disclosure finding): a layout-shift source is
  // promoted to TRACKED, so when a grower's ONLY victim is that promoted source,
  // Pass 2 used to credit nothing (it required the victim to be a candidate) and
  // the grower read as layout-INERT. The grower must still get layout impact;
  // the tracked victim must NOT gain an `affected` edge (it is `matched`).
  test('a layout-shift source promoted to TRACKED still credits the grower with layout impact', () => {
    const block = track({
      key: 'va-block',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 200, 100, 0) }),
        sample({ t: 32, frame: 2, screen: rect(0, 200, 160, 0) }),
      ],
    });
    const footer = track({
      key: 'va-footer',
      samples: [sample({ t: 0, frame: 0, screen: rect(120, 200, 140, 0) })],
    });
    const { affected, layoutCauses } = computeAffected(
      recording(
        [block, footer],
        [
          {
            t: 32,
            segment: 0,
            value: 0.2,
            hadRecentInput: false,
            sources: [
              {
                key: 'va-footer',
                previousRect: rect(120, 200, 140, 0),
                currentRect: rect(180, 200, 200, 0),
              },
            ],
          },
        ],
      ),
    );
    expect(layoutCauses.has('va-block')).toBe(true);
    expect(hasLayoutImpact(block, layoutCauses)).toBe(true);
    // The tracked victim stays `matched`, never an `affected` edge.
    expect(affected.get('va-footer')).toBeUndefined();
  });

  test('skips layout shifts flagged hadRecentInput', () => {
    const block = track({
      key: 'va-block',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 200, 100, 0) }),
        sample({ t: 32, frame: 2, screen: rect(0, 200, 160, 0) }),
      ],
    });
    const footer = track({
      key: 'cand-footer',
      kind: 'candidate',
      samples: [sample({ t: 0, frame: 0, screen: rect(120, 200, 140, 0) })],
    });
    const { affected } = computeAffected(
      recording(
        [block, footer],
        [
          {
            t: 32,
            segment: 0,
            value: 0.2,
            hadRecentInput: true,
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
    expect(affected.has('cand-footer')).toBe(false);
  });

  test('the invisible counterfactual attributes never-changed elements', () => {
    const bar = track({
      key: 'va-bar',
      samples: [sample({ t: 0, frame: 0, screen: rect(0, 200, 40, 0) })],
      layoutProbe: { affects: true, movedKeys: ['cand-below'] },
    });
    const below = track({
      key: 'cand-below',
      kind: 'candidate',
      samples: [sample({ t: 0, frame: 0, screen: rect(40, 200, 80, 0) })],
    });
    const { affected, layoutCauses } = computeAffected(recording([bar, below]));
    expect(affected.get('cand-below')?.affectedBy).toEqual(['va-bar']);
    expect(layoutCauses.has('va-bar')).toBe(true);
  });
});

describe('hasLayoutImpact', () => {
  test('true when the element is a recorded cause', () => {
    const el = track({ key: 'va-1', samples: [] });
    expect(hasLayoutImpact(el, new Set(['va-1']))).toBe(true);
  });
  test('true when its counterfactual moved others', () => {
    const el = track({
      key: 'va-1',
      samples: [],
      layoutProbe: { affects: true, movedKeys: ['x'] },
    });
    expect(hasLayoutImpact(el, new Set())).toBe(true);
  });
  test('false otherwise', () => {
    const el = track({ key: 'va-1', samples: [] });
    expect(hasLayoutImpact(el, new Set())).toBe(false);
  });
});
