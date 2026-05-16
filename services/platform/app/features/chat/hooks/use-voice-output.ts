'use client';

import { useAction, useQuery } from 'convex/react';
import { useCallback, useEffect, useRef } from 'react';

import { useLocale } from '@/app/hooks/use-locale';
import { api } from '@/convex/_generated/api';
import { MAX_TTS_CHUNK_CHARS } from '@/lib/shared/constants/tts';
import { parseMarkers } from '@/lib/utils/marker-parser';

import { useVoicePreReservationErrorSink } from './voice-output-context';

const MIN_CHUNK_CHARS = 12;
const MAX_IN_FLIGHT = 3;
// Post-stream coalescing: when a reply has finished streaming and the
// remaining text is shorter than this, emit it as a single chunk instead
// of one chunk per sentence. Each chunk is a separate <audio> file load
// with a perceptible swap gap, so short replies otherwise sound choppy
// (and isolated punctuation/emoji confuse the model when sent alone).
const POST_STREAM_BATCH_MAX_CHARS = 300;
// Codes the client retries on. Narrowed from the prior {RATE_LIMITED,
// PROVIDER_5XX, TIMEOUT, PROVIDER_ERROR} set per the round-2 audit:
//  - `PROVIDER_5XX` and `TIMEOUT` retry the *provider* HTTP call, which
//    a) re-bills the chunk against the provider, b) the upstream is often
//    already degraded (5xx) so the chunk stays failed anyway. Surface to
//    the user and let them retry manually via the indicator.
//  - `PROVIDER_ERROR` is a catch-all including non-transient cases like
//    `resolveOrgSlug` failures; the server marks it `retryable: false`,
//    so the client agreeing means no more silent disagreement on the
//    retry contract.
//  - `RATE_LIMITED` (real quota exhaustion) and `CONTENTION` (rate-limiter
//    shard OCC) are still retryable but use different backoff cadences.
const RETRYABLE_ERROR_CODES = new Set(['RATE_LIMITED', 'CONTENTION']);
const MAX_RETRIES_PER_CHUNK = 2;
const RETRY_BASE_DELAY_MS = 1500;
// `CONTENTION` is shard-OCC, not quota — back off much shorter than the
// `RATE_LIMITED` curve. 100ms base with jitter is enough for the
// rate-limiter library's internal retry to land on a free shard.
const CONTENTION_BASE_DELAY_MS = 100;
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

// Honor the requirement's "in the user's or conversation's language" clause:
// when chunk text is dominantly CJK, override the UI locale so the resolver
// picks a CJK-appropriate voice (falling through `voicesByLocale` → base →
// `defaultVoice` if no explicit mapping exists).
function detectChunkLocale(text: string, fallback: string): string {
  if (/[一-鿿]/.test(text)) return 'zh';
  if (/[぀-ゟ゠-ヿ]/.test(text)) return 'ja';
  if (/[가-힯]/.test(text)) return 'ko';
  return fallback;
}

export interface VoiceModeState {
  enabled: boolean;
  source: 'thread' | 'preferences' | 'default';
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
  return data ?? { enabled: false, source: 'default' };
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
 * Strip markdown decoration that should not be read aloud. Keeps the
 * underlying text content so listeners hear "Hello world" not "asterisk
 * asterisk Hello world asterisk asterisk".
 *
 * Skips fenced code blocks entirely — fence state is tracked across
 * invocations via `fenceOpenRef` because a stream can split mid-fence.
 */
function stripMarkdown(
  slice: string,
  fenceOpenRef: { current: boolean },
): string {
  let working = slice;
  // Drop fenced code blocks. Track open/close across calls because a
  // single emitted slice can contain only the opening fence with the
  // body arriving in a later chunk.
  const lines = working.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      fenceOpenRef.current = !fenceOpenRef.current;
      continue;
    }
    if (fenceOpenRef.current) continue;
    kept.push(line);
  }
  working = kept.join('\n');
  return (
    working
      // images first (longer pattern) so the alt-text remains
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      // links: keep the visible label
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // headings — drop leading hashes
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      // bold/italic markers (greedy enough to handle nested **_x_**)
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(\*|_)(.+?)\1/g, '$2')
      // inline code — keep the contents
      .replace(/`([^`]+)`/g, '$1')
      // blockquote prefix
      .replace(/^\s{0,3}>\s?/gm, '')
      // horizontal rules
      .replace(/^\s*(?:-\s*){3,}$/gm, '')
      // emoji / pictographs — gpt-4o-mini-tts can pronounce isolated
      // emoji as random syllables (the "z dot" artifact users hear at
      // the end of short replies). The Unicode property escape covers
      // every emoji-shaped glyph including transport and supplemental
      // symbols — the previous hand-rolled \u{1F300}-\u{1FAFF}\u{2600}-
      // \u{27BF} ranges missed common pictographs like ⚓ / ⏰. Regional
      // indicators (flag pairs like 🇺🇸), zero-width joiners, and
      // variation selectors are stripped in separate passes because the
      // lint rule rejects combining sequences inside one character class.
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
      .replace(/‍/g, '')
      .replace(/️/g, '')
      // collapse runs of whitespace
      .replace(/\s+/g, ' ')
      .trim()
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
 * `synthesizeChunk` up to `MAX_RETRIES_PER_CHUNK` times with jittered
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
   * Wall-clock timestamp (ms) when this message was created. The chunker
   * compares it against its mount time and skips processing for any
   * message that predates the mount — preventing the "navigate to a
   * thread with 50 prior assistant messages, voice ON, fire 50 chunker
   * actions" history-fan-out hazard (server idempotency catches them,
   * but the action call count matters for rate limiting and observability).
   */
  messageCreatedAt: number;
}): void {
  const { locale } = useLocale();
  const synthesize = useAction(api.tts.synthesize.synthesizeChunk);
  const cursorRef = useRef(0);
  const indexRef = useRef(0);
  const inFlightRef = useRef(0);
  const queueRef = useRef<Array<() => void>>([]);
  const lastMessageIdRef = useRef<string | undefined>(undefined);
  const fenceOpenRef = useRef(false);
  const retryAttemptsRef = useRef(new Map<number, number>());
  // Mirror `enabled` into a ref so the retry-backoff `setTimeout`
  // callback can drop pending retries when the user toggles voice off
  // mid-backoff. Without this gate, a 1.5s retry timer kept firing
  // synth calls after the indicator stopped, blasting the rate limiter
  // and re-billing the org for chunks the user had explicitly silenced.
  const enabledRef = useRef(opts.enabled);
  useEffect(() => {
    enabledRef.current = opts.enabled;
  }, [opts.enabled]);
  // Hook-mount wall-clock so any message with `messageCreatedAt < mount`
  // is treated as history and skipped. Mirrors the player hook's pattern
  // at use-voice-output-player.ts. Set once and never reset — message
  // change inside the same mount keeps the original mount time.
  const mountTimeRef = useRef(Date.now());
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
  // moved on.
  useEffect(() => {
    if (opts.messageId !== lastMessageIdRef.current) {
      const prior = lastMessageIdRef.current;
      cursorRef.current = 0;
      indexRef.current = 0;
      inFlightRef.current = 0;
      queueRef.current = [];
      fenceOpenRef.current = false;
      retryAttemptsRef.current = new Map();
      lastMessageIdRef.current = opts.messageId;
      if (prior) errorSink.clear(prior);
      if (opts.messageId) errorSink.clear(opts.messageId);
    }
  }, [opts.messageId, errorSink]);

  const runNext = useCallback(() => {
    while (inFlightRef.current < MAX_IN_FLIGHT && queueRef.current.length > 0) {
      const next = queueRef.current.shift();
      if (!next) break;
      inFlightRef.current++;
      next();
    }
  }, []);

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
    ) => {
      queueRef.current.push(() => {
        void synthesize(payload)
          .then((result) => {
            if (
              result.status === 'failed' &&
              result.errorCode &&
              RETRYABLE_ERROR_CODES.has(result.errorCode) &&
              attempt < MAX_RETRIES_PER_CHUNK
            ) {
              // `CONTENTION` backs off much shorter than `RATE_LIMITED`:
              // the former is shard-OCC noise (50-150ms is enough for the
              // limiter's internal retry to land), the latter signals true
              // quota exhaustion. Both add jitter so a wave of failures
              // doesn't all retry in lock-step and re-trigger the same
              // contention or quota window.
              const baseDelay =
                result.errorCode === 'CONTENTION'
                  ? CONTENTION_BASE_DELAY_MS
                  : RETRY_BASE_DELAY_MS;
              const jitter = 0.5 + Math.random() * 0.5;
              const delay = baseDelay * 2 ** attempt * jitter;
              retryAttemptsRef.current.set(payload.index, attempt + 1);
              setTimeout(() => {
                // Drop the retry if the message has since unmounted /
                // moved on — `messageId` change resets the maps.
                if (lastMessageIdRef.current !== payload.messageId) return;
                // Drop the retry if the user toggled voice off during
                // backoff; otherwise the timer keeps re-billing the org
                // for chunks the user has explicitly silenced.
                if (!enabledRef.current) return;
                enqueueSynthesis(payload, attempt + 1);
                runNext();
              }, delay);
            }
          })
          .catch((err) => {
            // Pre-reservation throws (BUDGET_EXCEEDED, MESSAGE_CHAR_LIMIT,
            // RATE_LIMITED, forbidden, TTS_CHUNK_LIMIT, …) come out of
            // the action as plain Errors with a `ConvexError`-wrapped
            // `data.code`. Surface the code through the per-message
            // sink so the indicator's `errorMessageForCode()` can show
            // an actionable message — without this, the only signal was
            // a `console.error` no user ever reads.
            const code = extractConvexErrorCode(err);
            if (code) errorSink.set(payload.messageId, code);
            console.error('[tts] synthesize action failed', err);
          })
          .finally(() => {
            inFlightRef.current = Math.max(0, inFlightRef.current - 1);
            runNext();
          });
      });
    },
    [synthesize, runNext, errorSink],
  );

  useEffect(() => {
    if (!opts.enabled) return;
    if (!opts.messageId || !opts.threadId || !opts.organizationId) return;
    // Skip messages that pre-date the chunker's mount — those are
    // history-load artifacts, not fresh assistant output. Without this
    // gate, opening a thread with N old assistant messages would fire N
    // `synthesizeChunk` actions on mount. Server idempotency suppresses
    // duplicate provider calls, but the action count still burns rate
    // limit + observability budget.
    if (opts.messageCreatedAt < mountTimeRef.current) return;
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
    // the MIN_CHUNK_CHARS gate.
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
      if (cleaned.length < MIN_CHUNK_CHARS && opts.isStreaming) {
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
    opts.messageCreatedAt,
    enqueueSynthesis,
    locale,
    runNext,
  ]);
}
