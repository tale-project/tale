import { describe, expect, test } from 'bun:test';

import { rect, sample } from '../test-fixtures';
import type { GeometrySample } from '../types';
import { detectDithering } from './dithering';
import type { Interval } from './transitions';

const box = rect(0, 100, 50, 0);
const noisyAt = (
  t: number,
  frame: number,
  pixelNoise: number | null,
): GeometrySample => sample({ t, frame, screen: box, pixelNoise });

function interval(samples: GeometrySample[]): Interval {
  return {
    samples,
    hadMove: true,
    hadResize: false,
    hadFade: false,
    hadColor: false,
  };
}

describe('detectDithering', () => {
  test('fewer than two noisy readings is not enough signal', () => {
    expect(detectDithering([noisyAt(0, 0, 0.1)], [])).toEqual([]);
  });

  test('two noisy readings on a static element flag one cluster', () => {
    const clusters = detectDithering(
      [noisyAt(0, 0, 0.1), noisyAt(16, 1, 0.1)],
      [],
    );
    expect(clusters.length).toBe(1);
    expect(clusters[0]?.frames).toBe(2);
    expect(clusters[0]?.window).toEqual([0, 16]);
    expect(clusters[0]?.noiseEnergy).toBeCloseTo(0.1, 5);
    expect(clusters[0]?.severity).toBeCloseTo(0.1, 5);
  });

  test('noise exactly at the threshold is not dithering', () => {
    expect(
      detectDithering([noisyAt(0, 0, 0.05), noisyAt(16, 1, 0.05)], []),
    ).toEqual([]);
    expect(
      detectDithering([noisyAt(0, 0, 0.06), noisyAt(16, 1, 0.06)], []).length,
    ).toBe(1);
  });

  test('frames inside a transition interval are exempt (moving, not dithering)', () => {
    const samples = [noisyAt(0, 0, 0.2), noisyAt(16, 1, 0.2)];
    expect(detectDithering(samples, [interval(samples)])).toEqual([]);
  });

  test('a colour-changing region is a colour transition, not dithering', () => {
    const colored = (
      t: number,
      frame: number,
      colorKey: number,
    ): GeometrySample =>
      sample({ t, frame, screen: box, pixelNoise: 0.2, colorKey });
    // Same pixel noise, but the computed colour changes between frames → the
    // delta is a colour transition, so no dithering is reported.
    expect(
      detectDithering([colored(0, 0, 11), colored(16, 1, 22)], []),
    ).toEqual([]);
    // A constant computed colour (a churning canvas) still flags.
    expect(
      detectDithering([colored(0, 0, 7), colored(16, 1, 7)], []).length,
    ).toBe(1);
  });

  test('a toggling region is a flicker, not dithering', () => {
    const vis = (t: number, frame: number, visible: boolean): GeometrySample =>
      sample({ t, frame, screen: box, pixelNoise: 0.2, visible });
    // Visibility flips between the captures → the noise is the flicker.
    expect(detectDithering([vis(0, 0, true), vis(16, 1, false)], [])).toEqual(
      [],
    );
  });

  test('a colour change between captures suppresses dithering (window extends to prior capture)', () => {
    const s = (
      t: number,
      frame: number,
      pixelNoise: number,
      colorKey: number,
    ) => sample({ t, frame, screen: box, pixelNoise, colorKey });
    // A captured (non-noisy) frame at the OLD colour, then two noisy frames at
    // the NEW colour: the noise reflects the colour transition finishing between
    // captures, so it must not be reported as dithering.
    expect(
      detectDithering(
        [s(0, 0, 0, 11), s(100, 6, 0.2, 22), s(116, 7, 0.2, 22)],
        [],
      ),
    ).toEqual([]);
    // Control: same colour at the prior capture → genuine dithering still flags.
    expect(
      detectDithering(
        [s(0, 0, 0, 22), s(100, 6, 0.2, 22), s(116, 7, 0.2, 22)],
        [],
      ).length,
    ).toBe(1);
  });

  test('a region that moved between captures is motion, not dithering', () => {
    const moved = sample({
      t: 16,
      frame: 1,
      screen: rect(40, 140, 90, 40),
      pixelNoise: 0.2,
    });
    const still = sample({ t: 0, frame: 0, screen: box, pixelNoise: 0.2 });
    // The box translated ~40px across the window → the noise is the motion.
    expect(detectDithering([still, moved], [])).toEqual([]);
  });

  test('frames with no pixel sample (null) never count', () => {
    expect(
      detectDithering([noisyAt(0, 0, null), noisyAt(16, 1, null)], []),
    ).toEqual([]);
  });

  test('the window extends back to the previous captured frame', () => {
    // Frame 0 has a non-null (quiet) reading in a DIFFERENT colour; frames 1 and
    // 2 are noisy. The back-extension reaches frame 0, pulling its differing
    // colorKey into the window, so the region is NOT stable and dithering is
    // correctly suppressed.
    const samples: GeometrySample[] = [
      sample({ t: 0, frame: 0, screen: box, pixelNoise: 0.0, colorKey: 1 }),
      sample({ t: 16, frame: 1, screen: box, pixelNoise: 0.2, colorKey: 0 }),
      sample({ t: 32, frame: 2, screen: box, pixelNoise: 0.3, colorKey: 0 }),
    ];
    expect(detectDithering(samples, [])).toEqual([]);
  });

  test('a null-noise prior frame is skipped, not pulled into the window', () => {
    // Frame 0 has pixelNoise === null (no capture there), so the back-extension
    // finds no earlier captured frame and the window starts at the first noisy
    // frame. The region is stable across that window, so a cluster is produced
    // whose window begins at the first noisy sample, not the null frame.
    const samples: GeometrySample[] = [
      sample({ t: 0, frame: 0, screen: box, pixelNoise: null, colorKey: 0 }),
      sample({ t: 16, frame: 1, screen: box, pixelNoise: 0.2, colorKey: 0 }),
      sample({ t: 32, frame: 2, screen: box, pixelNoise: 0.3, colorKey: 0 }),
    ];
    const clusters = detectDithering(samples, []);
    expect(clusters.length).toBe(1);
    expect(clusters[0]?.window).toEqual([16, 32]);
  });

  test('without the prior-capture colour change, the same noise IS dithering', () => {
    // Identical noisy frames, but the frame-0 capture shares the colorKey: the
    // back-extension still runs yet the window stays stable, so a cluster is
    // emitted — proving the back-extension governs the outcome.
    const samples: GeometrySample[] = [
      sample({ t: 0, frame: 0, screen: box, pixelNoise: 0.0, colorKey: 0 }),
      sample({ t: 16, frame: 1, screen: box, pixelNoise: 0.2, colorKey: 0 }),
      sample({ t: 32, frame: 2, screen: box, pixelNoise: 0.3, colorKey: 0 }),
    ];
    const clusters = detectDithering(samples, []);
    expect(clusters.length).toBe(1);
    expect(clusters[0]?.frames).toBe(2);
    expect(clusters[0]?.window).toEqual([16, 32]);
  });
});
