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
  FLOW_RING_DELAY,
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
    // The ring shows through the glide, then fades: gone at 700 ms.
    expect(FLOW_RING_DELAY).toBe(FLOW_DURATION.medium);
    expect(FLOW_MOTION_CLASS.ring).toContain(
      '_var(--duration-long)_var(--ease-default)_var(--duration-medium)_',
    );
    expect(FLOW_RING_TOTAL).toBe(700);
    // A node joins once the glide is under way.
    expect(FLOW_MOTION_CLASS.enter).toContain(
      '_var(--duration-standard)_var(--ease-out-quint)_var(--duration-short)_',
    );
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
