'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useAction, useQuery } from 'convex/react';
import { useCallback, useEffect, useRef } from 'react';

import { api } from '@/convex/_generated/api';
import {
  MAX_TTS_CHUNK_CHARS,
  MAX_TTS_IN_FLIGHT,
  MAX_TTS_QUEUE_DEPTH,
  MAX_TTS_RETRIES_PER_CHUNK,
  MIN_TTS_CHUNK_CHARS,
  POST_STREAM_BATCH_MAX_CHARS,
  TTS_CONTENTION_BASE_DELAY_MS,
  TTS_RETRY_BASE_DELAY_MS,
} from '@/lib/shared/constants/tts';
import { parseMarkers } from '@/lib/utils/marker-parser';

import { stripMarkdown } from './markdown-strip';
import { useVoicePreReservationErrorSink } from './voice-output-context';

// Codes the client retries on. Retry policy is intentionally client-owned
// per `convex/tts/error_codes.ts` header — the server returns only the
// stable code, the client decides which codes are worth re-billing the
// provider for. Narrowed from the prior {RATE_LIMITED, PROVIDER_5XX,
// TIMEOUT, PROVIDER_ERROR} set per the round-2 audit:
//  - `PROVIDER_5XX` / `TIMEOUT` retries re-bill the provider on a degraded
//    upstream that's likely to keep failing — surface for manual retry.
//  - `PROVIDER_ERROR` is a catch-all (includes non-transient classes like
//    `resolveOrgSlug` failures) so retrying is wasteful.
//  - `RATE_LIMITED` (real quota exhaustion) and `CONTENTION` (limiter
//    shard OCC) are still retryable with different backoff cadences.
const RETRYABLE_ERROR_CODES = new Set(['RATE_LIMITED', 'CONTENTION']);
// Module-level fallback splitter for environments without Intl.Segmenter.
const FALLBACK_SENTENCE_BOUNDARY = /(?<=[.!?。！？])\s+|\n{2,}/g;

/**
 * Extract a Convex error's structured `code` (set via `new ConvexError({
 * code, message })` on the server). Used by the chunker to surface
 * pre-reservation errors to the indicator's error-code path. Returns
 * `undefined` for plain `Error` instances so the catch can fall back to
 * a generic message.
 *
 * Defensive: Convex's typed error object lives on `err.data.code` but
 * actions reserialise it to a plain `Error` across the action boundary,
 * with the structured payload sometimes stringified into `err.message`.
 * Try both shapes.
 */
function extractConvexErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'code' in data) {
      const code = (data as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
  }
  if (err instanceof Error) {
    const match = err.message.match(/"code"\s*:\s*"([A-Z_]+)"/);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

// Threshold: at least 40% of non-ASCII characters must be CJK before we
// override the UI locale. The previous single-character probe
// (`/[一-鿿]/.test(text)`) misclassified mixed strings like
// "中文 with English help" as Chinese on the strength of two CJK glyphs in
// a 22-character chunk — the resolver then picked the wrong voice for
// chunks that were dominantly English.
const CJK_DOMINANT_RATIO = 0.4;
const ZH_RE = /[一-鿿]/g;
const JA_RE = /[぀-ゟ゠-ヿ]/g;
const KO_RE = /[가-힯]/g;

function countMatches(text: string, re: RegExp): number {
  // `re` carries the `g` flag; `String.prototype.match` returns null when
  // there's no match, and an array of matches when there is.
  return text.match(re)?.length ?? 0;
}

/**
 * Honor the requirement's "in the user's or conversation's language" clause:
 * when chunk text is dominantly CJK, override the UI locale so the resolver
 * picks a CJK-appropriate voice (falling through `voicesByLocale` → base →
 * `defaultVoice` if no explicit mapping exists). Otherwise return the UI
 * locale so the user-configured voice stays consistent.
 */
function detectChunkLocale(text: string, fallback: string): string {
  if (text.length === 0) return fallback;
  const zh = countMatches(text, ZH_RE);
  const ja = countMatches(text, JA_RE);
  const ko = countMatches(text, KO_RE);
  const total = zh + ja + ko;
  if (total === 0) return fallback;
  if (total / text.length < CJK_DOMINANT_RATIO) return fallback;
  // Whichever CJK family dominates wins. Ties resolve to ja > ko > zh
  // because mixed-script Japanese commonly contains Han ideographs and
  // would otherwise misclassify as Chinese.
  if (ja >= zh && ja >= ko) return 'ja';
  if (ko >= zh) return 'ko';
  return 'zh';
}

export interface VoiceModeState {
  enabled: boolean;
  // Raw `userPreferences.voiceOutput` from the resolver, surfaced so the
  // chat-header dropdown can hide the per-thread override row when voice
  // output is OFF globally. `enabled` alone can't tell apart "master OFF"
  // from "master ON + thread override OFF".
  userDefault: boolean;
  // `org_policy` indicates the admin-level kill switch
  // (`policyType: 'voice_output'`) overrode the user pref + thread override.
  source: 'thread' | 'preferences' | 'default' | 'org_policy';
}

/**
 * Returns the effective voice-mode state for a thread (thread override
 * winning over user default). Falls back to `{ enabled: false }` while
 * the query is loading so streaming chunkers don't fire prematurely.
 */
export function useVoiceModeEffective(
  threadId: string | undefined,
): VoiceModeState {
  const data = useQuery(
    api.tts.queries.getVoiceModeEffective,
    threadId ? { threadId } : 'skip',
  );
  return data ?? { enabled: false, userDefault: false, source: 'default' };
}

/**
 * Effective {messageId} → ordered array of chunk records (one per
 * sentence/paragraph the chunker has fired). Each chunk knows its play
 * URL when `status: 'ready'`, or its `error` when `status: 'failed'`.
 */
export function useVoiceChunks(
  messageId: string | undefined,
  threadId: string | undefined,
) {
  return useQuery(
    api.tts.queries.getMessageChunks,
    messageId && threadId ? { messageId, threadId } : 'skip',
  );
}

/**
 * Sentence-boundary segmentation. Prefers `Intl.Segmenter` so locale-aware
 * rules apply (no false split on `3.14`, `e.g.`, `Dr.`, etc.) and falls
 * back to a punctuation regex when the runtime lacks the API.
 */
function segmentSentences(
  text: string,
  locale: string,
  partial: boolean,
): Array<{ end: number; segment: string }> {
  const out: Array<{ end: number; segment: string }> = [];
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(locale || undefined, {
      granularity: 'sentence',
    });
    for (const part of seg.segment(text)) {
      const end = part.index + part.segment.length;
      // While the stream is still active, the final partial segment can be
      // an incomplete sentence — skip it; it'll be picked up on the next
      // text tick. When `partial=false` (stream done) include the tail.
      const isLast = end === text.length;
      if (isLast && partial) continue;
      out.push({ end, segment: part.segment });
    }
    return out;
  }
  FALLBACK_SENTENCE_BOUNDARY.lastIndex = 0;
  let match: RegExpExecArray | null;
  let lastEnd = 0;
  while ((match = FALLBACK_SENTENCE_BOUNDARY.exec(text)) !== null) {
    const end = match.index + match[0].length;
    out.push({ end, segment: text.slice(lastEnd, end) });
    lastEnd = end;
  }
  if (!partial && lastEnd < text.length) {
    out.push({ end: text.length, segment: text.slice(lastEnd) });
  }
  return out;
}

/**
 * Watches the assistant's streaming text and fires one `synthesizeChunk`
 * action per sentence/paragraph as boundaries appear. Owns a cursor over
 * already-processed characters and a small in-flight semaphore so the
 * server isn't blasted by a fast streamer.
 *
 * No-ops while `enabled === false`, while text is empty, or while a
 * required arg is missing. Safe to call from every assistant bubble —
 * the (messageId, index) reservation on the server guarantees idempotency
 * across renders and multi-tab races.
 *
 * Retry behaviour: when the action returns `{ status: 'failed', errorCode }`
 * with a retryable code (`RATE_LIMITED` for genuine quota exhaustion,
 * `CONTENTION` for rate-limiter shard OCC), the chunker re-invokes
 * `synthesizeChunk` up to `MAX_TTS_RETRIES_PER_CHUNK` times with jittered
 * exponential backoff. Terminal codes (NO_PROVIDER, UNKNOWN_*,
 * BUDGET_EXCEEDED, MESSAGE_CHAR_LIMIT, HOST_POLICY, PROVIDER_4XX,
 * PROVIDER_5XX, TIMEOUT, PROVIDER_ERROR) are surfaced via the indicator —
 * playback is provider-only, there is no browser-TTS fallback.
 */
export function useVoiceOutputChunker(opts: {
  enabled: boolean;
  messageId: string | undefined;
  threadId: string | undefined;
  organizationId: string | undefined;
  text: string;
  isStreaming: boolean;
  /**
   * True when this message's id was NOT in the chat list's first-render
   * snapshot — i.e. it arrived via subscription during this mount, not as
   * part of thread-history load. Owned by `chat-messages.tsx`; we just
   * gate on it here.
   *
   * Identity-based replacement for the prior wall-clock `messageCreatedAt
   * < mountTimeRef` gate. That gate compared server-set `_creationTime`
   * against client-set `Date.now()`, which always satisfied the inequality
   * for fresh events (server time ≤ client time by at least round-trip
   * latency) — silently skipping every freshly streamed message and
   * causing the symptom this hook exists to handle. The identity-based
   * snapshot is immune to clock skew, multi-tab inconsistency, and
   * server/client time direction.
   *
   * The history-fan-out protection (don't fire N synthesizeChunk actions
   * when navigating to a thread with N old assistant messages) is
   * preserved: every message present in the initial snapshot returns
   * `isFreshSinceMount = false`, so the chunker no-ops.
   */
  isFreshSinceMount: boolean;
}): void {
  const { locale } = useLocale();
  const synthesize = useAction(api.tts.synthesize.synthesizeChunk);
  const cursorRef = useRef(0);
  const indexRef = useRef(0);
  const inFlightRef = useRef(0);
  // Each queued closure carries the cursor delta its enqueueing already
  // committed to `cursorRef`. On toggle-OFF, the streaming-loop's
  // synchronous cursor advance has already moved past text that the
  // queued (but not yet dispatched) closures were going to synthesize;
  // rolling cursor back by their cumulative delta lets re-enable
  // re-segment the dropped range instead of silently skipping it.
  // Retries carry `consumedDelta: 0` because the original enqueue
  // already accounted for the cursor move.
  const queueRef = useRef<Array<{ run: () => void; consumedDelta: number }>>(
    [],
  );
  const lastMessageIdRef = useRef<string | undefined>(undefined);
  const fenceOpenRef = useRef(false);
  const retryAttemptsRef = useRef(new Map<number, number>());
  // Outstanding retry-backoff timer ids so a hook-unmount or message
  // change can clear them. Without this cleanup, the timer fires after
  // unmount and (because `lastMessageIdRef`/`enabledRef` still hold
  // their last values until GC) silently re-invokes `synthesize` on
  // behalf of a component that no longer exists.
  const retryTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  // Mirror `enabled` into a ref so the retry-backoff `setTimeout`
  // callback can drop pending retries when the user toggles voice off
  // mid-backoff. Without this gate, a 1.5s retry timer kept firing
  // synth calls after the indicator stopped, blasting the rate limiter
  // and re-billing the org for chunks the user had explicitly silenced.
  const enabledRef = useRef(opts.enabled);
  useEffect(() => {
    enabledRef.current = opts.enabled;
  }, [opts.enabled]);
  // Pre-reservation error sink: errors that happen BEFORE a chunk row
  // exists (BUDGET_EXCEEDED, MESSAGE_CHAR_LIMIT, forbidden,
  // TTS_CHUNK_LIMIT, etc., raised by `reserveChunk` and thrown out of
  // the action) never reach the indicator's chunk-row `errorCode`
  // path. We surface them via the per-message error sink owned by
  // `voice-output-context`, which the player merges into its
  // `errorCode` projection. See `useVoicePreReservationErrorSink`.
  const errorSink = useVoicePreReservationErrorSink();

  // Reset on message change so a new assistant bubble starts at index 0.
  // Also clear any stale pre-reservation error for the *previous* message
  // — leaving it dangling would surface on the indicator after the user
  // moved on. Pending retry timers for the prior message are cleared so
  // they can't fire a stale `synthesize` after the cursor reset.
  useEffect(() => {
    if (opts.messageId !== lastMessageIdRef.current) {
      const prior = lastMessageIdRef.current;
      cursorRef.current = 0;
      indexRef.current = 0;
      inFlightRef.current = 0;
      queueRef.current = [];
      fenceOpenRef.current = false;
      retryAttemptsRef.current = new Map();
      for (const id of retryTimersRef.current) clearTimeout(id);
      retryTimersRef.current.clear();
      lastMessageIdRef.current = opts.messageId;
      if (prior) errorSink.clear(prior);
      if (opts.messageId) errorSink.clear(opts.messageId);
    }
  }, [opts.messageId, errorSink]);

  // Clear every outstanding retry timer on unmount. Without this, a 1.5s
  // backoff timer can fire after the hook is gone and re-invoke
  // `synthesize` against an already-billed chunk (the lastMessageIdRef
  // / enabledRef gates inside the timer don't reset on unmount).
  useEffect(() => {
    // Capture the ref objects inside the effect closure so the cleanup
    // doesn't dereference `.current` after unmount (lint rule
    // `exhaustive-deps`: the ref instance may have been recreated by
    // then on some bundlers / fast refresh paths).
    const timers = retryTimersRef.current;
    const messageRef = lastMessageIdRef;
    return () => {
      for (const id of timers) clearTimeout(id);
      timers.clear();
      messageRef.current = undefined;
    };
  }, []);

  // Drop every still-queued closure and roll `cursorRef` back by their
  // cumulative `consumedDelta`. In-flight closures (already dispatched
  // to `synthesize`) are NOT rolled back — the server may have already
  // billed for them, so re-emitting their range on re-enable would
  // double-bill. The streaming loop's `if (full.length <=
  // cursorRef.current) return` then resumes on the next text tick from
  // the rolled-back cursor and the dropped range gets re-segmented.
  const drainQueueAndRollbackCursor = useCallback(() => {
    let droppedDelta = 0;
    for (const entry of queueRef.current) {
      droppedDelta += entry.consumedDelta;
    }
    if (droppedDelta > 0) {
      cursorRef.current = Math.max(0, cursorRef.current - droppedDelta);
    }
    queueRef.current = [];
    inFlightRef.current = 0;
  }, []);

  const runNext = useCallback(() => {
    // Toggle-off mid-stream must drain the queue: without this gate, a
    // user who disabled voice while N paragraphs were already queued would
    // still see all N synthesized + billed (the original retry-timer's
    // `enabledRef` check only covered re-enqueues, not the existing
    // closures already in `queueRef`). Round-1 / round-2 HIGH #1.
    if (!enabledRef.current) {
      drainQueueAndRollbackCursor();
      return;
    }
    while (
      inFlightRef.current < MAX_TTS_IN_FLIGHT &&
      queueRef.current.length > 0
    ) {
      const next = queueRef.current.shift();
      if (!next) break;
      inFlightRef.current++;
      next.run();
    }
  }, [drainQueueAndRollbackCursor]);

  // Belt-and-suspenders: flipping `opts.enabled` to false mid-stream
  // drops everything pending. `runNext`'s gate covers the dispatch path,
  // but already-queued closures referenced by `inFlightRef`-style timers
  // can still fire from the retry-loop unless we explicitly clear the
  // queue + timers here. Also rolls `cursorRef` back so the leaked
  // range (queued but never dispatched) is re-segmented on re-enable.
  useEffect(() => {
    if (!opts.enabled) {
      drainQueueAndRollbackCursor();
      for (const id of retryTimersRef.current) clearTimeout(id);
      retryTimersRef.current.clear();
    }
  }, [opts.enabled, drainQueueAndRollbackCursor]);

  const enqueueSynthesis = useCallback(
    (
      payload: {
        messageId: string;
        threadId: string;
        organizationId: string;
        index: number;
        text: string;
        locale: string;
      },
      attempt: number,
      // Cursor delta the streaming loop already committed for this
      // chunk's text range. Used by `drainQueueAndRollbackCursor` to
      // restore `cursorRef` on toggle-OFF so the dropped range is
      // re-emitted on re-enable instead of leaking. Retries pass 0
      // because the original enqueue already accounted for the delta.
      consumedDelta: number,
    ) => {
      // Bounded queue. Without a depth cap, a slow provider plus a fast
      // streamer would let the queue grow without bound while
      // `MAX_TTS_IN_FLIGHT` only throttles concurrent execution. When the
      // queue is full, drop the new task and surface `QUEUE_OVERFLOW`
      // via the error sink so the user sees why playback paused
      // instead of silently leaking the tail of the message.
      if (queueRef.current.length >= MAX_TTS_QUEUE_DEPTH) {
        errorSink.set(payload.messageId, 'QUEUE_OVERFLOW');
        console.warn('[tts] synthesis queue full; dropping enqueue', {
          index: payload.index,
          depth: queueRef.current.length,
        });
        return;
      }
      const run = () => {
        void synthesize(payload)
          .then((result) => {
            if (result.status !== 'failed' || !result.errorCode) return;
            const retryable =
              RETRYABLE_ERROR_CODES.has(result.errorCode) &&
              attempt < MAX_TTS_RETRIES_PER_CHUNK;
            if (retryable) {
              // `CONTENTION` backs off much shorter than `RATE_LIMITED`:
              // the former is shard-OCC noise (50-150ms is enough for the
              // limiter's internal retry to land), the latter signals true
              // quota exhaustion. Both add jitter so a wave of failures
              // doesn't all retry in lock-step and re-trigger the same
              // contention or quota window.
              console.warn('[tts] synthesizeChunk returned retryable failure', {
                messageId: payload.messageId,
                index: payload.index,
                errorCode: result.errorCode,
                attempt,
              });
              const baseDelay =
                result.errorCode === 'CONTENTION'
                  ? TTS_CONTENTION_BASE_DELAY_MS
                  : TTS_RETRY_BASE_DELAY_MS;
              const jitter = 0.5 + Math.random() * 0.5;
              const delay = baseDelay * 2 ** attempt * jitter;
              retryAttemptsRef.current.set(payload.index, attempt + 1);
              const timerId = setTimeout(() => {
                retryTimersRef.current.delete(timerId);
                // Drop the retry if the message has since unmounted /
                // moved on — `messageId` change resets the maps.
                if (lastMessageIdRef.current !== payload.messageId) return;
                // Drop the retry if the user toggled voice off during
                // backoff; otherwise the timer keeps re-billing the org
                // for chunks the user has explicitly silenced.
                if (!enabledRef.current) return;
                // Retries pass `consumedDelta: 0` — the original
                // enqueue already advanced `cursorRef`, so this re-run
                // must not contribute to the OFF rollback total.
                enqueueSynthesis(payload, attempt + 1, 0);
                runNext();
              }, delay);
              retryTimersRef.current.add(timerId);
              return;
            }
            // Non-retryable, or retry budget exhausted. Without surfacing
            // through the error sink the indicator would silently drop —
            // pre-reservation failures (NO_PROVIDER, UNKNOWN_PROVIDER,
            // UNKNOWN_MODEL, UNKNOWN_VOICE, HOST_POLICY) resolve with
            // `{status:'failed', errorCode}` and never throw, so the
            // `.catch` below never fires for them. Routing here lets
            // `errorMessageForCode()` render an actionable message
            // (settings link / retry button / terminal badge per
            // classifyErrorCode).
            console.warn('[tts] synthesizeChunk returned failed (surfacing)', {
              messageId: payload.messageId,
              index: payload.index,
              errorCode: result.errorCode,
              attempt,
            });
            errorSink.set(payload.messageId, result.errorCode);
          })
          .catch((err) => {
            // Pre-reservation throws (BUDGET_EXCEEDED, MESSAGE_CHAR_LIMIT,
            // RATE_LIMITED, forbidden, TTS_CHUNK_LIMIT, …) come out of
            // the action as plain Errors with a `ConvexError`-wrapped
            // `data.code`. Surface the code through the per-message
            // sink so the indicator's `errorMessageForCode()` can show
            // an actionable message — without this, the only signal was
            // a `console.error` no user ever reads. Non-Convex throws
            // (network drop, action timeout) get a generic
            // `UNKNOWN_NETWORK` so the indicator still renders an
            // actionable message instead of leaving the user staring at
            // a stuck spinner with no clue what failed.
            const code = extractConvexErrorCode(err) ?? 'UNKNOWN_NETWORK';
            errorSink.set(payload.messageId, code);
            console.error('[tts] synthesize action failed', err);
          })
          .finally(() => {
            inFlightRef.current = Math.max(0, inFlightRef.current - 1);
            runNext();
          });
      };
      queueRef.current.push({ run, consumedDelta });
    },
    [synthesize, runNext, errorSink],
  );

  useEffect(() => {
    if (!opts.enabled) return;
    if (!opts.messageId || !opts.threadId || !opts.organizationId) {
      console.warn('[tts] chunker skipping (missing required ids)', {
        messageId: opts.messageId,
        threadId: opts.threadId,
        organizationId: opts.organizationId,
      });
      return;
    }
    // Skip messages that were present in the chat list's first-render
    // snapshot — those are history-load artifacts, not fresh assistant
    // output. Without this gate, opening a thread with N old assistant
    // messages would fire N `synthesizeChunk` actions on mount. Server
    // idempotency suppresses duplicate provider calls, but the action
    // count still burns rate limit + observability budget.
    if (!opts.isFreshSinceMount) return;
    // Strip structured-response markers and drop the NEXT_STEPS suggestion-
    // chip section before chunking. parseMarkers buffers partial markers
    // mid-stream via pendingText, so this is safe to call on every tick.
    const parsed = parseMarkers(opts.text, opts.isStreaming);
    const full = parsed.sections
      .filter((s) => s.type === 'plain')
      .map((s) => s.content)
      .join('\n\n');
    if (full.length <= cursorRef.current) return;

    const tail = full.slice(cursorRef.current);

    // Post-stream short-reply path: when the whole remaining tail fits
    // under POST_STREAM_BATCH_MAX_CHARS, emit it as one chunk. This
    // avoids the inter-chunk audio swap gap for short replies and gives
    // the model enough context to handle trailing punctuation/emoji
    // gracefully (isolated `？` / `😊` chunks produce odd vocalizations).
    // Uses a fence-state snapshot so the test doesn't corrupt the live
    // fence tracker if we fall through to per-segment emission.
    if (!opts.isStreaming) {
      const fenceSnapshot = { current: fenceOpenRef.current };
      const cleanedTail = stripMarkdown(tail, fenceSnapshot);
      if (
        cleanedTail.length > 0 &&
        cleanedTail.length <= POST_STREAM_BATCH_MAX_CHARS
      ) {
        fenceOpenRef.current = fenceSnapshot.current;
        const myIndex = indexRef.current++;
        // `tail.length` is the cursor delta this enqueue commits to
        // `cursorRef`. Tracked on the queue entry so OFF rollback can
        // restore cursor if this chunk is dropped before dispatch.
        enqueueSynthesis(
          {
            messageId: opts.messageId,
            threadId: opts.threadId,
            organizationId: opts.organizationId,
            index: myIndex,
            text: cleanedTail,
            locale: detectChunkLocale(cleanedTail, locale),
          },
          0,
          tail.length,
        );
        cursorRef.current = full.length;
        runNext();
        return;
      }
    }

    const segments = segmentSentences(tail, locale, opts.isStreaming);

    // Fence-state snapshot: `stripMarkdown` mutates `fenceOpenRef` per
    // segment to track open/close ``` markers across calls. When the
    // last segment is short-mid-stream and we roll the cursor back to
    // re-segment on the next tick, the fence ref would otherwise stay
    // advanced — the SAME segment then gets re-processed against an
    // already-flipped fence state, producing either code-blocks read
    // aloud (extra toggle) or prose silently swallowed (skipped toggle).
    // Snapshot before the loop; only commit on segments that survive
    // the MIN_TTS_CHUNK_CHARS gate.
    const fenceSnapshot = { current: fenceOpenRef.current };

    let consumed = 0;
    let committedFence = fenceSnapshot.current;
    for (const { end, segment } of segments) {
      const cleaned = stripMarkdown(segment, fenceSnapshot);
      consumed = end;
      if (cleaned.length === 0) {
        // Whitespace-only segment (blank line between paragraphs). The
        // cursor must still advance — waiting for "more text" here would
        // never help, since the segment can never grow. Fence state did
        // not change for whitespace-only content; keep `committedFence`.
        committedFence = fenceSnapshot.current;
        continue;
      }
      if (cleaned.length < MIN_TTS_CHUNK_CHARS && opts.isStreaming) {
        // Non-empty but too short mid-stream: roll cursor back so the
        // sentence is re-segmented once more text arrives. Also roll
        // back the fence ref to the last committed snapshot so the
        // re-segmentation on the next tick sees the same fence state
        // we entered with — without this, the open/close toggles
        // inside the rolled-back segment have already flipped the live
        // fence and would flip it again on retry, desyncing.
        fenceSnapshot.current = committedFence;
        consumed = Math.max(0, end - segment.length);
        break;
      }
      committedFence = fenceSnapshot.current;
      const text =
        cleaned.length > MAX_TTS_CHUNK_CHARS
          ? cleaned.slice(0, MAX_TTS_CHUNK_CHARS)
          : cleaned;
      const myIndex = indexRef.current++;
      // Each per-segment enqueue commits `segment.length` to cursor at
      // line below; tracking it on the queue entry lets OFF rollback
      // restore cursor for each chunk individually instead of all-or-
      // nothing (a partially-dispatched batch keeps the dispatched
      // chunks' cursor advance and rolls back only the queued tail).
      enqueueSynthesis(
        {
          messageId: opts.messageId,
          threadId: opts.threadId,
          organizationId: opts.organizationId,
          index: myIndex,
          text,
          locale: detectChunkLocale(text, locale),
        },
        0,
        segment.length,
      );
    }
    cursorRef.current += consumed;
    // Commit the fence state that corresponds to the content we actually
    // consumed. On break (short-final-segment) the snapshot was already
    // rolled back to `committedFence` above; on full loop completion the
    // snapshot equals committedFence anyway.
    fenceOpenRef.current = fenceSnapshot.current;
    runNext();
  }, [
    opts.enabled,
    opts.messageId,
    opts.threadId,
    opts.organizationId,
    opts.text,
    opts.isStreaming,
    opts.isFreshSinceMount,
    enqueueSynthesis,
    locale,
    runNext,
  ]);
}
