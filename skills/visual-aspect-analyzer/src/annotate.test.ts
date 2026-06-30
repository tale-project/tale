import { describe, expect, test } from 'bun:test';

import { annotatePaint, annotatePixelNoise } from './annotate';
import { rect, recording, sample, track } from './test-fixtures';

describe('annotatePixelNoise', () => {
  test('lands noise on the sample nearest in time', () => {
    const el = track({
      key: 'va-1',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 10, 10, 0) }),
        sample({ t: 100, frame: 1, screen: rect(0, 10, 10, 0) }),
      ],
    });
    const out = annotatePixelNoise(recording([el]), [
      { key: 'va-1', t: 95, noise: 0.4 },
    ]);
    expect(out.elements[0]?.samples[1]?.pixelNoise).toBe(0.4);
    expect(out.elements[0]?.samples[0]?.pixelNoise).toBeNull();
  });

  test('returns the same recording when there is no noise', () => {
    const r = recording([
      track({
        key: 'va-1',
        samples: [sample({ t: 0, frame: 0, screen: rect(0, 10, 10, 0) })],
      }),
    ]);
    expect(annotatePixelNoise(r, [])).toBe(r);
  });

  test('does not mutate the input recording', () => {
    const r = recording([
      track({
        key: 'va-1',
        samples: [sample({ t: 0, frame: 0, screen: rect(0, 10, 10, 0) })],
      }),
    ]);
    annotatePixelNoise(r, [{ key: 'va-1', t: 0, noise: 0.9 }]);
    expect(r.elements[0]?.samples[0]?.pixelNoise).toBeNull();
  });

  test('skips an element that has no samples', () => {
    const r = recording([track({ key: 'va-1', samples: [] })]);
    const out = annotatePixelNoise(r, [{ key: 'va-1', t: 0, noise: 0.5 }]);
    expect(out.elements[0]?.samples).toEqual([]);
  });

  test('lands each measurement on its own nearest frame', () => {
    const el = track({
      key: 'va-1',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 10, 10, 0) }),
        sample({ t: 50, frame: 1, screen: rect(0, 10, 10, 0) }),
        sample({ t: 100, frame: 2, screen: rect(0, 10, 10, 0) }),
      ],
    });
    const out = annotatePixelNoise(recording([el]), [
      { key: 'va-1', t: 5, noise: 0.2 }, // nearest frame 0
      { key: 'va-1', t: 98, noise: 0.7 }, // nearest frame 2
    ]);
    expect(out.elements[0]?.samples[0]?.pixelNoise).toBe(0.2);
    expect(out.elements[0]?.samples[1]?.pixelNoise).toBeNull();
    expect(out.elements[0]?.samples[2]?.pixelNoise).toBe(0.7);
  });
});

describe('annotatePaint', () => {
  test('clears occluded on confirmed keys so paint can register', () => {
    const el = track({
      key: 'va-1',
      samples: [
        sample({ t: 0, frame: 0, screen: rect(0, 10, 10, 0), occluded: true }),
      ],
    });
    const out = annotatePaint(recording([el]), new Set(['va-1']));
    expect(out.elements[0]?.samples[0]?.occluded).toBe(false);
  });

  test('leaves unconfirmed elements untouched', () => {
    const r = recording([
      track({
        key: 'va-1',
        samples: [
          sample({
            t: 0,
            frame: 0,
            screen: rect(0, 10, 10, 0),
            occluded: true,
          }),
        ],
      }),
    ]);
    expect(annotatePaint(r, new Set())).toBe(r);
  });
});
