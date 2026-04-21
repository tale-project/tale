import type { TextStreamPart, ToolSet } from 'ai';

import { acquire } from '../lib/moderation/semaphore';
import { runChatFilter } from './chat_filter';
import type { FilterOutcome, GuardrailsDirection } from './filter_outcome';
import { scrubPii } from './pii';
import type { GuardrailsSnapshot } from './sanitize';

/**
 * Injected by the caller (a Node-runtime action) to run the external
 * moderation API call on a buffered chunk. The transform factory itself
 * is V8-safe and has no `ctx`, so it cannot invoke the internal action
 * directly — the caller wires this up via `ctx.runAction(...)` and passes
 * the closure in. Returning `null` lets the caller signal "not today"
 * (e.g. moderation disabled) without forcing an artificial pass outcome.
 */
export type RunModerationForChunk = (text: string) => Promise<{
  outcome: {
    kind: 'pass' | 'modified' | 'flagged' | 'blocked' | 'step_error';
    categoryIds?: string[];
    matchCount?: number;
    text?: string;
  };
} | null>;

/**
 * Output streaming integration for the guardrails pipeline.
 *
 * The Vercel AI SDK calls `experimental_transform` to wrap `streamText`'s
 * event stream. We intercept `text-delta` events, run the local filters
 * (chat_filter + PII) synchronously against a sliding 256-byte lookback
 * buffer (catches matches split across delta boundaries), and fire the
 * external moderation provider asynchronously against a debounced
 * byte-cap buffer (minFlushChars / maxBufferChars / idleFlushMs).
 *
 * Non-text parts (tool-call / tool-result / reasoning / source / etc.)
 * pass through unchanged. Tool-call and tool-result boundaries flush
 * the moderation buffer so accumulated text from one turn doesn't bleed
 * into another.
 *
 * Blocking: when any filter returns `blocked`, the transform:
 *   1. Replaces the triggering delta's text with an empty string so
 *      the raw violating bytes never reach persistence or the UI.
 *   2. Populates `state.blockedReason` so the outer caller
 *      (`persistAssistantMessage`) can write `message_metadata` and
 *      tear down the stream on the DB side.
 *   3. Calls `stopStream()` to terminate the LLM generation itself.
 *
 * The transform has NO direct DB side effects — all mutations flow
 * through the caller after the stream resolves. This keeps the
 * transform easy to test with pure `TransformStream` wiring and
 * avoids awaiting mutations inside the hot path.
 */

const LOCAL_LOOKBACK_BYTES = 256;

export interface BlockedReason {
  code: 'chat_filter.blocked' | 'pii.blocked' | 'moderation_provider.blocked';
  direction: GuardrailsDirection;
  categoryIds: string[];
  sanitizationRunId: string;
}

export interface GuardrailsTransformState {
  /** Set once per stream when any filter blocks. First block wins. */
  blocked: boolean;
  blockedReason: BlockedReason | null;
  /** Total deltas emitted (after mask, before block). */
  deltasEmitted: number;
  /** Bytes held in the moderation accumulator when the stream ended. */
  finalBufferChars: number;
  /** Number of async moderation calls kicked off during the stream. */
  moderationCallsStarted: number;
  /** Number of async moderation calls that completed. */
  moderationCallsCompleted: number;
}

export function makeInitialState(): GuardrailsTransformState {
  return {
    blocked: false,
    blockedReason: null,
    deltasEmitted: 0,
    finalBufferChars: 0,
    moderationCallsStarted: 0,
    moderationCallsCompleted: 0,
  };
}

export interface CreateGuardrailsTransformOptions {
  configs: GuardrailsSnapshot;
  direction: GuardrailsDirection;
  sanitizationRunId: string;
  streamId: string;
  orgSlug: string;
  organizationId: string;
  state: GuardrailsTransformState;
  stopStream: () => void;
  /**
   * Mask replacement for local filters. The chat_filter config carries its
   * own `maskReplacement`; we fall back to this when chat_filter is off
   * but PII is masking. PII preserves its own per-pattern replacement
   * tokens via `scrubPii` internally.
   */
  defaultMaskReplacement: string;
  /**
   * Optional callback to run the external moderation provider on a
   * buffered chunk. The caller (a Node-runtime action) builds this via
   * `ctx.runAction(internal.governance.moderation_provider
   * .internal_actions.runModerationProviderAction, …)`. Omitting this
   * callback disables mid-stream moderation; local filters still run.
   */
  runModerationForChunk?: RunModerationForChunk;
}

function localFiltersSync(
  combined: string,
  opts: CreateGuardrailsTransformOptions,
): FilterOutcome {
  const { configs, direction } = opts;

  if (
    configs.chatFilter?.enabled &&
    configs.chatFilter.config.appliesTo.includes(direction)
  ) {
    const cf = runChatFilter({
      text: combined,
      config: configs.chatFilter.config,
      policyDocId: configs.chatFilter.policyDocId,
      updatedAt: configs.chatFilter.updatedAt,
    });
    if (cf.kind !== 'pass') return cf;
  }

  if (configs.pii?.enabled) {
    const pii = scrubPii(combined, configs.pii.config);
    if (pii.kind !== 'pass') return pii;
  }

  return { kind: 'pass' };
}

export function createGuardrailsTransform<TOOLS extends ToolSet>(
  opts: CreateGuardrailsTransformOptions,
): TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>> {
  const {
    configs,
    direction,
    sanitizationRunId,
    streamId,
    orgSlug,
    organizationId,
    state,
    stopStream,
  } = opts;

  const bufferPolicy = configs.moderation?.config.endpoint.bufferPolicy ?? {
    minFlushChars: 120,
    maxBufferChars: 800,
    idleFlushMs: 400,
    perStreamMaxConcurrent: 2,
  };

  // Per-delta sliding lookback for local filters (catches matches that
  // span a chunk boundary). Kept small — we only need enough to cover
  // the longest reasonable banned word / PII pattern (~256 bytes).
  let lookback = '';
  // Moderation accumulator.
  let modBuffer = '';
  let lastDeltaAt = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function recordBlock(reason: BlockedReason): void {
    if (state.blocked) return;
    state.blocked = true;
    state.blockedReason = reason;
    // Do NOT call any mutation from here; the outer caller handles DB
    // side effects after the stream resolves. `stopStream` is safe to
    // call multiple times but we only need one.
    try {
      stopStream();
    } catch (err) {
      console.warn(
        `[guardrails] stopStream threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async function flushModeration(
    reason: 'size' | 'idle' | 'boundary' | 'end',
  ): Promise<void> {
    const runModerationForChunk = opts.runModerationForChunk;
    if (!runModerationForChunk) return;
    if (!configs.moderation?.enabled) return;
    if (!configs.moderation.config.appliesTo.includes(direction)) return;
    if (modBuffer.length === 0) return;
    if (state.blocked) return;

    const snapshot = modBuffer;
    if (reason !== 'end') modBuffer = '';

    const maxConcurrent = bufferPolicy.perStreamMaxConcurrent;
    const release = await acquire(streamId, maxConcurrent);
    state.moderationCallsStarted += 1;
    try {
      const result = await runModerationForChunk(snapshot);
      if (result === null) return;
      const { outcome } = result;
      if (outcome.kind === 'blocked') {
        recordBlock({
          code: 'moderation_provider.blocked',
          direction,
          categoryIds: outcome.categoryIds ?? [],
          sanitizationRunId,
        });
      }
    } catch (err) {
      console.warn(
        `[guardrails] moderation flush failed (${reason}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      state.moderationCallsCompleted += 1;
      release();
    }
  }

  function scheduleIdleFlush(): void {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (
        modBuffer.length >= bufferPolicy.minFlushChars &&
        Date.now() - lastDeltaAt >= bufferPolicy.idleFlushMs
      ) {
        void flushModeration('idle');
      }
    }, bufferPolicy.idleFlushMs);
  }

  return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
    async transform(part, controller) {
      // Drop everything after a block has been recorded — stopStream()
      // cancels the source but in-flight parts may still arrive.
      if (state.blocked) return;

      // Tool boundaries: flush moderation buffer so one turn's text
      // doesn't affect classification of the next. Tool parts themselves
      // pass through unchanged.
      if (part.type === 'tool-call' || part.type === 'tool-result') {
        await flushModeration('boundary');
        controller.enqueue(part);
        return;
      }

      if (part.type !== 'text-delta') {
        controller.enqueue(part);
        return;
      }

      const originalDelta = part.text;
      if (!originalDelta) {
        controller.enqueue(part);
        return;
      }

      const combined = lookback + originalDelta;

      const outcome = localFiltersSync(combined, opts);
      let safeDelta = originalDelta;

      if (outcome.kind === 'blocked') {
        const code =
          configs.chatFilter?.enabled &&
          configs.chatFilter.config.appliesTo.includes(direction)
            ? 'chat_filter.blocked'
            : 'pii.blocked';
        recordBlock({
          code,
          direction,
          categoryIds: outcome.categoryIds,
          sanitizationRunId,
        });
        // Emit an empty text-delta to preserve part shape without leaking
        // the violating bytes. Downstream `saveStreamDeltas` will persist
        // the zero-length delta but the outer flow will tombstone the
        // message with `blockedReason` and clear the stream rows.
        controller.enqueue({ ...part, text: '' });
        return;
      }

      if (outcome.kind === 'modified') {
        // `combined` may include bytes already emitted in an earlier delta
        // (the `lookback` prefix). When the mask lands STRICTLY inside the
        // new bytes, we can emit the masked suffix safely.
        //
        // When the mask crosses the boundary — i.e. the masked text
        // diverges from `combined` at an offset <= lookback.length —
        // the already-streamed lookback bytes are wrong and we can't
        // retroactively rewrite them via a forward-only transform. In
        // that case we fall back to "best-effort": emit the raw delta
        // unchanged here, and rely on `finalizeSanitize` to rewrite the
        // saved message text so reload / history show the masked version.
        const maskedCombined = outcome.text;
        let divergeAt = 0;
        const cmpLen = Math.min(combined.length, maskedCombined.length);
        while (
          divergeAt < cmpLen &&
          combined.charAt(divergeAt) === maskedCombined.charAt(divergeAt)
        ) {
          divergeAt += 1;
        }
        if (divergeAt >= lookback.length) {
          safeDelta = maskedCombined.slice(lookback.length);
        } else {
          // Cross-boundary mask: forward-stream fallback. Finalize fixes
          // the persisted copy at end-of-turn.
          safeDelta = originalDelta;
        }
      }

      controller.enqueue({ ...part, text: safeDelta });
      state.deltasEmitted += 1;

      // Advance lookback: retain the last LOCAL_LOOKBACK_BYTES of what we
      // just emitted. This ensures cross-chunk words are detectable on
      // the next delta without scanning old text twice.
      const emittedSoFar = lookback + safeDelta;
      lookback = emittedSoFar.slice(-LOCAL_LOOKBACK_BYTES);

      // Moderation accumulator — only the user-facing (post-mask) text.
      modBuffer += safeDelta;
      lastDeltaAt = Date.now();

      const shouldSizeFlush = modBuffer.length >= bufferPolicy.maxBufferChars;
      if (shouldSizeFlush) {
        if (idleTimer !== null) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
        // Fire-and-forget — semaphore acquisition and HTTP call happen
        // in the background while the stream continues. Blocked
        // outcomes flip state.blocked which causes subsequent deltas
        // to short-circuit.
        void flushModeration('size');
      } else {
        scheduleIdleFlush();
      }
    },

    async flush() {
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      state.finalBufferChars = modBuffer.length;
      // End-of-stream moderation sweep synchronously — we need the final
      // verdict before `persistAssistantMessage` commits the saved
      // message text.
      if (!state.blocked && modBuffer.length > 0) {
        await flushModeration('end');
      }
    },
  });
}
