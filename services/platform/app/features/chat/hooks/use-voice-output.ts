'use client';

import { useAction, useQuery } from 'convex/react';
import { useCallback, useEffect, useRef } from 'react';

import { useLocale } from '@/app/hooks/use-locale';
import { api } from '@/convex/_generated/api';

const MIN_CHUNK_CHARS = 12;
const MAX_CHUNK_CHARS = 1800;
const MAX_IN_FLIGHT = 3;
const RETRYABLE_ERROR_CODES = new Set([
  'RATE_LIMITED',
  'PROVIDER_5XX',
  'TIMEOUT',
  'PROVIDER_ERROR',
]);
const MAX_RETRIES_PER_CHUNK = 2;
const RETRY_BASE_DELAY_MS = 1500;
// Module-level fallback splitter for environments without Intl.Segmenter.
const FALLBACK_SENTENCE_BOUNDARY = /(?<=[.!?。！？])\s+|\n{2,}/g;

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
    let cursor = 0;
    for (const part of seg.segment(text)) {
      const end = part.index + part.segment.length;
      // While the stream is still active, the final partial segment can be
      // an incomplete sentence — skip it; it'll be picked up on the next
      // text tick. When `partial=false` (stream done) include the tail.
      const isLast = end === text.length;
      if (isLast && partial) continue;
      out.push({ end, segment: part.segment });
      cursor = end;
    }
    void cursor;
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
 * with a retryable code (transient provider errors, rate limits, timeouts),
 * the chunker re-invokes `synthesizeChunk` up to `MAX_RETRIES_PER_CHUNK`
 * times with exponential backoff. Terminal codes (NO_PROVIDER, UNKNOWN_*,
 * BUDGET_EXCEEDED, PROVIDER_4XX) are not retried — the client falls back
 * to `speechSynthesis` via the player hook.
 */
export function useVoiceOutputChunker(opts: {
  enabled: boolean;
  messageId: string | undefined;
  threadId: string | undefined;
  organizationId: string | undefined;
  text: string;
  isStreaming: boolean;
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

  // Reset on message change so a new assistant bubble starts at index 0.
  useEffect(() => {
    if (opts.messageId !== lastMessageIdRef.current) {
      cursorRef.current = 0;
      indexRef.current = 0;
      inFlightRef.current = 0;
      queueRef.current = [];
      fenceOpenRef.current = false;
      retryAttemptsRef.current = new Map();
      lastMessageIdRef.current = opts.messageId;
    }
  }, [opts.messageId]);

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
              const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
              retryAttemptsRef.current.set(payload.index, attempt + 1);
              setTimeout(() => {
                // Drop the retry if the message has since unmounted /
                // moved on — `messageId` change resets the maps.
                if (lastMessageIdRef.current !== payload.messageId) return;
                enqueueSynthesis(payload, attempt + 1);
                runNext();
              }, delay);
            }
          })
          .catch((err) => {
            console.error('[tts] synthesize action failed', err);
          })
          .finally(() => {
            inFlightRef.current = Math.max(0, inFlightRef.current - 1);
            runNext();
          });
      });
    },
    [synthesize, runNext],
  );

  useEffect(() => {
    if (!opts.enabled) return;
    if (!opts.messageId || !opts.threadId || !opts.organizationId) return;
    const full = opts.text;
    if (full.length <= cursorRef.current) return;

    const tail = full.slice(cursorRef.current);
    const segments = segmentSentences(tail, locale, opts.isStreaming);

    let consumed = 0;
    for (const { end, segment } of segments) {
      const cleaned = stripMarkdown(segment, fenceOpenRef);
      consumed = end;
      if (cleaned.length < MIN_CHUNK_CHARS && opts.isStreaming) {
        // Don't emit tiny chunks mid-stream; wait for more text. Cursor
        // must NOT advance past this segment yet — once more text arrives
        // the sentence will be re-segmented and emitted properly.
        consumed = Math.max(0, end - segment.length);
        break;
      }
      if (cleaned.length === 0) continue;
      const text =
        cleaned.length > MAX_CHUNK_CHARS
          ? cleaned.slice(0, MAX_CHUNK_CHARS)
          : cleaned;
      const myIndex = indexRef.current++;
      enqueueSynthesis(
        {
          messageId: opts.messageId,
          threadId: opts.threadId,
          organizationId: opts.organizationId,
          index: myIndex,
          text,
          locale,
        },
        0,
      );
    }
    cursorRef.current += consumed;
    runNext();
  }, [
    opts.enabled,
    opts.messageId,
    opts.threadId,
    opts.organizationId,
    opts.text,
    opts.isStreaming,
    enqueueSynthesis,
    locale,
    runNext,
  ]);
}
