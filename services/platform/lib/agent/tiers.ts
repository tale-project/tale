/**
 * Execution tiers — where the work behind a tool call runs.
 *
 * An agent turn decides what it needs by the tools it calls, and every tool
 * belongs to exactly one tier:
 *
 *  - `none`  — the platform answers the call itself: a search, a page fetch,
 *    a file whose content the model writes out, an image from the image
 *    model, a skill's instructions. Nothing starts.
 *  - `light` — code runs in a light sandbox: a small, hardened, throwaway
 *    session with the document toolchain built in, started on the first call
 *    and gone a few minutes after the last. No coding agent runs in it; the
 *    turn's own model writes the code.
 *  - `full`  — a coding agent works in a full sandbox: a persistent
 *    workspace, a shell with network access, long-running autonomy.
 *
 * The order is the cost order: a turn should reach for the cheapest tier that
 * can do the work, and the platform starts a tier only when a call needs it.
 *
 * Layer A: pure data.
 */

export const EXECUTION_TIERS = ['none', 'light', 'full'] as const;

export type ExecutionTier = (typeof EXECUTION_TIERS)[number];

/** Whether `tier` costs more than `than` — the order the ladder reads. */
export function tierAbove(tier: ExecutionTier, than: ExecutionTier): boolean {
  return EXECUTION_TIERS.indexOf(tier) > EXECUTION_TIERS.indexOf(than);
}

/** The most expensive tier among `tiers` (`none` for an empty list): what a
 * turn that called these tools ended up needing. */
export function highestTier(tiers: Iterable<ExecutionTier>): ExecutionTier {
  let highest: ExecutionTier = 'none';
  for (const tier of tiers) {
    if (tierAbove(tier, highest)) highest = tier;
  }
  return highest;
}
