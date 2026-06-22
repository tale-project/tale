/**
 * Shared "is this generation still alive?" guard.
 *
 * A thread's `generationStatus === 'generating'` is the lock that blocks the
 * client UI and the new-turn gate. If the server action crashed (or was killed
 * by a deploy / the 30-min action ceiling) without resetting it, the lock would
 * stick forever. These helpers judge liveness against the latest sign of life so
 * three consumers stay in lockstep:
 *   - `isThreadGenerating` (UI unblock),
 *   - the deploy drain count (`control/drain.ts:countActiveGenerations`),
 *   - the recovery watchdog (`agents/recover_stuck_chat_turns.ts`).
 * Keeping them on ONE threshold means the drain never waits on a turn the UI
 * already considers stale, and the watchdog never finalizes one still fresh.
 */

/**
 * Maximum time (ms) a generation is considered active before it's treated as
 * stale. Sized to cover the longest legitimate run: self-hosted Convex actions
 * have a 30-minute Docker ceiling, and the researcher agent runs up to ~25 min.
 * A 5-minute buffer above the hard ceiling avoids killing the UI on slow tails.
 *
 * Staleness is judged against the latest sign of life — `generationStartTime`
 * OR `generationHeartbeatAt` (bumped ~20s by the sandbox runner) — so
 * external-agent turns that legitimately outlive this window via cross-action
 * continuation stay "generating" as long as they keep heartbeating.
 */
export const GENERATION_STALE_THRESHOLD_MS = 30 * 60 * 1000 + 5 * 60 * 1000;

/**
 * A 'generating' thread counts as live when it has no liveness timestamps at
 * all (legacy rows — preserve the historical "no startTime → not stale"
 * semantics) or its most recent sign of life is within the threshold.
 */
export function isGenerationFresh(metadata: {
  generationStartTime?: number;
  generationHeartbeatAt?: number;
}): boolean {
  const lastAliveAt = Math.max(
    metadata.generationStartTime ?? 0,
    metadata.generationHeartbeatAt ?? 0,
  );
  if (lastAliveAt === 0) return true;
  return Date.now() - lastAliveAt <= GENERATION_STALE_THRESHOLD_MS;
}
