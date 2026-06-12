'use client';

import { useEffect, useState } from 'react';

import { WORKING_STALL_MS } from './activity-label';

/**
 * True once the turn's agent has been silent (no stream events) past
 * WORKING_STALL_MS. Owns its own coarse tick so the flip happens even on
 * surfaces with no other re-render source — during a silent stretch nothing
 * streams, so neither the subscription nor the 1s thinking timer (which stops
 * once the answer starts) re-renders the host component.
 */
export function useStalledSilence(
  lastEventAt: number | undefined,
  enabled: boolean,
): boolean {
  const [now, setNow] = useState(() => Date.now());
  const active = enabled && lastEventAt !== undefined;
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, [active]);
  return active && now - lastEventAt > WORKING_STALL_MS;
}
