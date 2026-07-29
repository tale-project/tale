// Flicker — rapid visibility reversals (not a clean monotonic fade). A clean
// fade toggles visibility at most once; flicker reverses, so two or more
// toggles inside FLICKER_WINDOW_MS (a visible→hidden→visible round trip) flag.

import { clamp01 } from '../geometry';
import type { GeometrySample, Window } from '../types';

// At or below this opacity an element reads as hidden (for flicker toggles).
const VISIBLE_OPACITY = 0.05;
// Two visibility toggles within this span are a flicker round trip.
export const FLICKER_WINDOW_MS = 100;
// Toggles needed to saturate flicker severity to 1 (4 ≈ two round trips).
const FLICKER_SEVERITY_TOGGLES = 4;

export type FlickerCluster = {
  window: Window;
  toggleCount: number;
  frequencyHz: number;
  minOpacity: number;
  maxOpacity: number;
  severity: number;
};

/** Flag clusters of visibility toggles (see the module comment for the rule). */
export function detectFlicker(
  samples: readonly GeometrySample[],
): FlickerCluster[] {
  const toggles: { t: number; opacity: number }[] = [];
  let prevVisible: boolean | null = null;
  for (const s of samples) {
    const isVisible = s.visible && s.opacity > VISIBLE_OPACITY;
    if (prevVisible !== null && isVisible !== prevVisible) {
      toggles.push({ t: s.t, opacity: s.opacity });
    }
    prevVisible = isVisible;
  }
  const clusters: FlickerCluster[] = [];
  for (let i = 0; i < toggles.length; i++) {
    const start = toggles[i];
    if (!start) continue;
    const inWindow = toggles.filter(
      (g) => g.t >= start.t && g.t - start.t <= FLICKER_WINDOW_MS,
    );
    if (inWindow.length < 2) continue;
    const last = inWindow[inWindow.length - 1];
    if (!last) continue;
    const span = Math.max(1, last.t - start.t);
    const opacities = inWindow.map((g) => g.opacity);
    clusters.push({
      window: [start.t, last.t],
      toggleCount: inWindow.length,
      frequencyHz: (inWindow.length / span) * 1000,
      minOpacity: Math.min(...opacities),
      maxOpacity: Math.max(...opacities),
      severity: clamp01(inWindow.length / FLICKER_SEVERITY_TOGGLES),
    });
    // Skip past the toggles already folded into this cluster.
    i += inWindow.length - 1;
  }
  return clusters;
}
