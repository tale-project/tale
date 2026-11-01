/**
 * The spawner times its readings, reservations, places in line and back-offs
 * by the wall clock (`Date.now`), which can step back: an NTP step, a VM
 * resume. A time taken before such a step lies ahead of the clock afterwards,
 * and arithmetic on it would hold a reading, a reservation or a back-off for
 * the length of the step on top of its own. These two helpers keep a step
 * back to no more than one normal span.
 */

/** How long ago `atMs` was at `nowMs`. A time ahead of `nowMs` — taken before
 * the wall clock stepped back — reads as infinitely long ago, so a reading
 * judged by it is stale and read afresh, and a back-off counted from it is
 * over. */
export function msSince(atMs: number, nowMs: number): number {
  return nowMs < atMs ? Number.POSITIVE_INFINITY : nowMs - atMs;
}

/** `atMs`, or `nowMs` when a step back of the wall clock put `atMs` ahead of
 * it: what is counted from it — a reservation that decays, a place in line
 * kept alive — starts over now and runs its normal span from the step, never
 * more. */
export function notAhead(atMs: number, nowMs: number): number {
  return Math.min(atMs, nowMs);
}
