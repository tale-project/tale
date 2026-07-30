'use client';

import { useState } from 'react';

/** Animation period of `.animate-thinking-dot` (see locals.css). */
const DOT_PERIOD_MS = 1200;
/** Per-dot phase offset — the wave glides across the three dots. */
const DOT_STAGGER_MS = [0, 150, 300];

/**
 * Three bouncing dots that signal live, in-progress activity next to a header
 * label or timer. Decorative only (`aria-hidden`) — the surrounding label or
 * live region already carries the meaning for screen readers.
 *
 * The animation is anchored to the WALL CLOCK, not to mount time. The dots
 * can remount mid-turn — the pre-first-token body row hands off to the
 * timeline header the instant the first reasoning/tool part lands — and a
 * fresh mount would otherwise restart the 1.2s bounce from phase zero, a
 * visible hitch. Seeding each dot's negative `animation-delay` from
 * `Date.now()` makes a remounted dots element resume at the SAME phase the
 * unmounted one was at, so the handoff is seamless. Computed once via lazy
 * state so re-renders (the per-second timer tick) never restart it.
 * `.animate-thinking-dot` self-neutralizes under prefers-reduced-motion.
 */
export function ThinkingDots() {
  const [delays] = useState(() => {
    const now = Date.now();
    // Negative delay = "start this far into the cycle". `(now - stagger) mod
    // period` is the phase a continuously-running dot would be at right now.
    return DOT_STAGGER_MS.map((stagger) => -((now - stagger) % DOT_PERIOD_MS));
  });

  return (
    <span className="ml-0.5 inline-flex space-x-1" aria-hidden="true">
      {delays.map((delay, i) => (
        <span
          key={i}
          className="bg-muted-foreground animate-thinking-dot h-1 w-1 rounded-full"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
