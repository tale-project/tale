import { components, internal } from '../../_generated/api';
import type { GenerateResponseArgs } from './types';

/**
 * How often the abort watcher polls the stream status (ms).
 */
export const ABORT_POLL_INTERVAL_MS = 1500;

export interface AbortWatcher {
  stop: () => void;
  readonly cancelled: boolean;
}

/**
 * Polls for cancellation and aborts the controller when detected.
 * Bridges the gap between the `cancelGeneration` mutation (which sets DB
 * flags) and the running action (which needs an AbortSignal).
 *
 * Two detection methods:
 * - Check 1: new aborted SDK streams (mid-stream cancellation)
 * - Check 2: `cancelledAt` on threadMetadata (early cancellation, before
 *   any SDK stream exists)
 *
 * `baselineAbortedIds` filters out streams aborted before this generation.
 * `generationStartTime` distinguishes stale `cancelledAt` from current.
 */
export function startAbortWatcher(
  ctx: GenerateResponseArgs['ctx'],
  threadId: string,
  abortController: AbortController,
  baselineAbortedIds: Set<string>,
  generationStartTime: number,
): AbortWatcher {
  let stopped = false;
  let cancelledByWatcher = false;

  const check = async () => {
    if (stopped || abortController.signal.aborted) return;
    try {
      // Check 1: new aborted streams (mid-stream cancellation)
      const streams = await ctx.runQuery(components.agent.streams.list, {
        threadId,
        statuses: ['aborted'] as const,
      });
      const hasNewAbort = streams.some(
        (s: { streamId: string }) => !baselineAbortedIds.has(s.streamId),
      );
      if (hasNewAbort) {
        cancelledByWatcher = true;
        abortController.abort();
        return;
      }

      // Check 2: cancelledAt on threadMetadata (early + universal). Anchor on
      // the TURN's start (generationStartTime) so a cancel that landed BEFORE
      // this action began — the front-load / queued window — is still caught.
      // The passed baseline is only the fallback for turns with no thread
      // generationStartTime (resume / sub-agent).
      const meta = await ctx.runQuery(
        internal.threads.internal_queries.getThreadMetadata,
        { threadId },
      );
      const turnStartMs = meta?.generationStartTime ?? generationStartTime;
      if (meta?.cancelledAt && meta.cancelledAt >= turnStartMs) {
        cancelledByWatcher = true;
        abortController.abort();
        return;
      }
    } catch (pollError) {
      console.error('[abortWatcher] Poll failed:', pollError);
    }
    if (!stopped && !abortController.signal.aborted) {
      setTimeout(check, ABORT_POLL_INTERVAL_MS);
    }
  };

  setTimeout(check, ABORT_POLL_INTERVAL_MS);

  return {
    stop: () => {
      stopped = true;
    },
    get cancelled() {
      return cancelledByWatcher;
    },
  };
}

/**
 * The TURN's wall-clock start — `threadMetadata.generationStartTime`, stamped by
 * `markGenerating` BEFORE Auto routing. Used to report the pre-answer "thinking"
 * time the user actually waited (router-classifier latency included). Falls back
 * to `fallbackMs` (this action's start) for resume / sub-agent turns that carry
 * no thread generationStartTime, or if the read fails. Called post-stream only,
 * so it never sits on the time-to-first-token critical path.
 */
export async function resolveTurnStartMs(
  ctx: GenerateResponseArgs['ctx'],
  threadId: string,
  fallbackMs: number,
): Promise<number> {
  try {
    const meta = await ctx.runQuery(
      internal.threads.internal_queries.getThreadMetadata,
      { threadId },
    );
    return meta?.generationStartTime ?? fallbackMs;
  } catch (err) {
    console.warn(
      '[generateAgentResponse] resolveTurnStartMs failed; using action start',
      err instanceof Error ? err.message : err,
    );
    return fallbackMs;
  }
}

/**
 * The pre-answer "thinking" wall-clock the chat "Thought for Ns" summary shows,
 * measured from the turn start (`resolveTurnStartMs`) to the moment the thinking
 * window closes. It closes at the FIRST answer token; a reasoning/tool-only or
 * aborted turn never produces one, so it closes at the turn's end (`nowMs`)
 * instead. Persisting this for those turns keeps the duration on the message
 * after a reload rather than dropping it (`undefined`), which previously left
 * only the "N tools" / "Showed its reasoning" fallback.
 */
export function computeThinkingDurationMs(
  firstTokenTime: number | null,
  turnStartMs: number,
  nowMs: number,
): number {
  return (firstTokenTime ?? nowMs) - turnStartMs;
}
