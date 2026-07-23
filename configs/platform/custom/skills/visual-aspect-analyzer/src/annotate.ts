// Pure post-processing the driver applies to a recording before analysis: fold
// in the pixel-noise timeline it measured out-of-band, and the paint
// counterfactual's verdicts. Kept pure (new objects, no mutation) so both are
// unit-testable without a browser.

import type { Recording } from './types';

/** One driver-measured noise reading for an element at a moment. */
export type NoiseSample = { key: string; t: number; noise: number };

/**
 * Write `pixelNoise` onto the sample nearest in time to each measurement (per
 * element key). The driver measures noise at keyframes; this lands it on the
 * rAF samples the dithering detector reads.
 */
export function annotatePixelNoise(
  recording: Recording,
  noise: readonly NoiseSample[],
): Recording {
  if (noise.length === 0) return recording;
  const byKey = new Map<string, NoiseSample[]>();
  for (const ns of noise) {
    const list = byKey.get(ns.key);
    if (list) list.push(ns);
    else byKey.set(ns.key, [ns]);
  }
  const elements = recording.elements.map((el) => {
    const list = byKey.get(el.key);
    if (!list || el.samples.length === 0) return el;
    const noiseByIndex = new Map<number, number>();
    for (const ns of list) {
      let best = 0;
      let bestDt = Infinity;
      el.samples.forEach((s, i) => {
        const dt = Math.abs(s.t - ns.t);
        if (dt < bestDt) {
          bestDt = dt;
          best = i;
        }
      });
      noiseByIndex.set(best, ns.noise);
    }
    const samples = el.samples.map((s, i) => {
      const value = noiseByIndex.get(i);
      return value === undefined ? s : { ...s, pixelNoise: value };
    });
    return { ...el, samples };
  });
  return { ...recording, elements };
}

/**
 * Apply the paint counterfactual's verdicts: an element whose sub-rect actually
 * changed when hidden does paint, so any "occluded" reading on it was wrong —
 * clear it so `effectivePaint` can register the impact.
 */
export function annotatePaint(
  recording: Recording,
  confirmed: ReadonlySet<string>,
): Recording {
  if (confirmed.size === 0) return recording;
  const elements = recording.elements.map((el) => {
    if (!confirmed.has(el.key)) return el;
    const samples = el.samples.map((s) =>
      s.occluded ? { ...s, occluded: false } : s,
    );
    return { ...el, samples };
  });
  return { ...recording, elements };
}
