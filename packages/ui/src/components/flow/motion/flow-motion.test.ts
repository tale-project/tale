import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { easeOutQuint, FLOW_VIEWPORT_DURATION } from '../flow-canvas';
import {
  FLOW_DURATION,
  FLOW_EASE_OUT_QUINT,
  FLOW_EDGE_ENTER_DELAY,
  FLOW_MOTION_CLASS,
  FLOW_RELAYOUT_SETTLE,
  FLOW_RING_TOTAL,
} from './flow-motion';

const css = readFileSync(
  join(__dirname, '..', '..', '..', 'globals.css'),
  'utf8',
);

/** A token's value as the stylesheet declares it. */
function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (match === null) throw new Error(`no --${name} in globals.css`);
  return (match[1] ?? '').trim();
}

describe('flow motion', () => {
  it('times script motion by the stylesheet’s duration tokens', () => {
    for (const [name, ms] of Object.entries(FLOW_DURATION))
      expect(token(`duration-${name}`), name).toBe(`${ms}ms`);
    expect(token('ease-out-quint')).toBe(FLOW_EASE_OUT_QUINT);
    // The viewport's moves are the same tokens.
    expect(FLOW_VIEWPORT_DURATION.zoom).toBe(FLOW_DURATION.short);
    expect(FLOW_VIEWPORT_DURATION.reveal).toBe(FLOW_DURATION.standard);
    expect(FLOW_VIEWPORT_DURATION.fit).toBe(FLOW_DURATION.medium);
    // The script ease ends where the curve does.
    expect(easeOutQuint(0)).toBe(0);
    expect(easeOutQuint(1)).toBe(1);
  });

  it('waits in script exactly as long as the classes delay', () => {
    // New lines fade in last; the relayout has settled once they are in.
    expect(FLOW_MOTION_CLASS.fadeIn).toContain(`_${FLOW_EDGE_ENTER_DELAY}ms_`);
    expect(FLOW_RELAYOUT_SETTLE).toBe(450);
    // The ring fades in, holds and fades out; script drops it when the
    // animation ends, and it outlasts the relayout it marks.
    expect(FLOW_MOTION_CLASS.ring).toContain(`_${FLOW_RING_TOTAL}ms_`);
    expect(FLOW_RING_TOTAL).toBeGreaterThan(FLOW_RELAYOUT_SETTLE);
    // A node joins once the glide is under way.
    expect(FLOW_MOTION_CLASS.enter).toContain(
      '_var(--duration-standard)_var(--ease-out-quint)_var(--duration-short)_',
    );
  });

  it('fades the ring in over short and out over long, never at once', () => {
    const block = /@keyframes flow-ring \{([\s\S]*?)\n\}/.exec(css)?.[1];
    if (block === undefined) throw new Error('no @keyframes flow-ring');
    const stops = [
      ...block.matchAll(/([\d.]+)%\s*\{\s*opacity:\s*([\d.]+);/g),
    ].map((match) => ({
      at: (Number(match[1]) / 100) * FLOW_RING_TOTAL,
      opacity: Number(match[2]),
    }));
    // It starts and ends unseen: no frame where it switches on or off.
    expect(stops[0]).toEqual({ at: 0, opacity: 0 });
    expect(stops.at(-1)).toEqual({ at: FLOW_RING_TOTAL, opacity: 0 });
    const shown = stops.filter((stop) => stop.opacity === 1);
    expect(shown[0]?.at).toBeCloseTo(FLOW_DURATION.short, 0);
    expect(FLOW_RING_TOTAL - (shown.at(-1)?.at ?? 0)).toBeCloseTo(
      FLOW_DURATION.long,
      0,
    );
    // Fully there until the relayout has settled, so the eye finds it.
    expect(shown.at(-1)?.at).toBeGreaterThan(FLOW_RELAYOUT_SETTLE);
  });

  it('names only keyframes the stylesheet defines', () => {
    for (const [name, className] of Object.entries(FLOW_MOTION_CLASS)) {
      const keyframes = /animate-\[([a-z-]+)_/.exec(className)?.[1];
      expect(keyframes, name).toBeDefined();
      expect(css, `${name}: @keyframes ${keyframes}`).toContain(
        `@keyframes ${keyframes} {`,
      );
    }
  });
});
