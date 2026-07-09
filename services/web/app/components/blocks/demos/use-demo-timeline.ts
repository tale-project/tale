import { useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

export interface UseDemoTimelineOptions {
  /**
   * Millisecond offsets, ascending from 0, at which each beat begins.
   * Pass a module-level constant — the array identity is an effect dep.
   */
  beats: readonly number[];
  /** Begin playback: `true` on mount for the hero, an in-view flag below the fold. */
  start: boolean;
}

/**
 * The single timing driver behind the animated product demos. Returns the
 * index of the current beat; components derive what to show from it. Motion
 * policy lives here alone:
 *
 *   - SSR renders the FINAL beat, so prerendered HTML carries the complete,
 *     informative end state for crawlers and no-JS readers.
 *   - `prefers-reduced-motion` pins the final beat — the demo becomes a
 *     static illustration.
 *   - Playback pauses while the tab is hidden and resumes where it left off.
 */
export function useDemoTimeline({
  beats,
  start,
}: UseDemoTimelineOptions): number {
  const finalBeat = beats.length - 1;
  const reduceMotion = useReducedMotion();
  const [beat, setBeat] = useState(() =>
    typeof window === 'undefined' ? finalBeat : 0,
  );
  const elapsedRef = useRef(0);

  useEffect(() => {
    if (reduceMotion) {
      setBeat(finalBeat);
      return undefined;
    }
    if (!start) return undefined;

    let raf = 0;
    let origin = performance.now() - elapsedRef.current;

    const tick = (now: number) => {
      const elapsed = now - origin;
      elapsedRef.current = elapsed;
      let next = 0;
      for (let i = 0; i < beats.length; i += 1) {
        if (elapsed >= beats[i]) next = i;
      }
      setBeat(next);
      if (next < finalBeat) raf = requestAnimationFrame(tick);
    };

    const onVisibilityChange = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && elapsedRef.current < beats[finalBeat]) {
        origin = performance.now() - elapsedRef.current;
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [beats, finalBeat, reduceMotion, start]);

  return beat;
}
