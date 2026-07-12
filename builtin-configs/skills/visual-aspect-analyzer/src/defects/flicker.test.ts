import { describe, expect, test } from 'bun:test';

import { rect, sample } from '../test-fixtures';
import { detectFlicker } from './flicker';

// A "hidden" sample drops below the opacity threshold; "visible" sits at 1.
const box = rect(0, 100, 50, 0);
const visible = (t: number, frame: number) =>
  sample({ t, frame, screen: box, opacity: 1 });
const hidden = (t: number, frame: number) =>
  sample({ t, frame, screen: box, opacity: 0 });

describe('detectFlicker', () => {
  test('no toggles → no clusters', () => {
    const samples = [visible(0, 0), visible(16, 1), visible(32, 2)];
    expect(detectFlicker(samples)).toEqual([]);
  });

  test('a single sample cannot toggle', () => {
    expect(detectFlicker([visible(0, 0)])).toEqual([]);
  });

  test('exactly two toggles within the window flag one cluster', () => {
    // visible → hidden → visible: two reversals 40ms apart (< 100ms window).
    const samples = [visible(0, 0), hidden(20, 1), visible(40, 2)];
    const clusters = detectFlicker(samples);
    expect(clusters.length).toBe(1);
    expect(clusters[0]?.toggleCount).toBe(2);
    expect(clusters[0]?.window).toEqual([20, 40]);
    expect(clusters[0]?.severity).toBeCloseTo(0.5, 5); // 2 of 4 saturating toggles
  });

  test('a clean monotonic fade is not flicker', () => {
    // Opacity only ever decreases — it crosses the visibility threshold once,
    // so there is a single toggle and no reversal.
    const samples = [
      sample({ t: 0, frame: 0, screen: box, opacity: 1 }),
      sample({ t: 50, frame: 1, screen: box, opacity: 0.5 }),
      sample({ t: 100, frame: 2, screen: box, opacity: 0.2 }),
      sample({ t: 150, frame: 3, screen: box, opacity: 0 }),
    ];
    expect(detectFlicker(samples)).toEqual([]);
  });

  test('severity saturates at four toggles in a window', () => {
    const samples = [
      visible(0, 0),
      hidden(20, 1),
      visible(40, 2),
      hidden(60, 3),
      visible(80, 4),
    ];
    const clusters = detectFlicker(samples);
    expect(clusters[0]?.toggleCount).toBe(4);
    expect(clusters[0]?.severity).toBe(1);
  });
});
