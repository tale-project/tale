'use client';

import { useAction, useQuery } from 'convex/react';
import { useCallback, useEffect, useRef } from 'react';

import { useLocale } from '@/app/hooks/use-locale';
import { api } from '@/convex/_generated/api';

const MIN_CHUNK_CHARS = 12;
const MAX_CHUNK_CHARS = 1800;
const SENTENCE_BOUNDARY = /(?<=[.!?。！？])\s+|\n{2,}/g;
const MAX_IN_FLIGHT = 3;

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
 * Watches the assistant's streaming text and fires one `synthesizeChunk`
 * action per sentence/paragraph as boundaries appear. Owns a cursor over
 * already-processed characters and a small in-flight semaphore so the
 * server isn't blasted by a fast streamer.
 *
 * No-ops while `enabled === false`, while text is empty, or while a
 * required arg is missing. Safe to call from every assistant bubble —
 * the (messageId, index) reservation on the server guarantees idempotency
 * across renders and multi-tab races.
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

  // Reset on message change so a new assistant bubble starts at index 0.
  useEffect(() => {
    if (opts.messageId !== lastMessageIdRef.current) {
      cursorRef.current = 0;
      indexRef.current = 0;
      inFlightRef.current = 0;
      queueRef.current = [];
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

  useEffect(() => {
    if (!opts.enabled) return;
    if (!opts.messageId || !opts.threadId || !opts.organizationId) return;
    const full = opts.text;
    if (full.length <= cursorRef.current) return;

    const tail = full.slice(cursorRef.current);
    const boundaries: number[] = [];
    SENTENCE_BOUNDARY.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SENTENCE_BOUNDARY.exec(tail)) !== null) {
      boundaries.push(match.index + match[0].length);
    }
    if (!opts.isStreaming) {
      // Final flush: include the remainder past the last boundary.
      if (
        boundaries.length === 0 ||
        boundaries[boundaries.length - 1] < tail.length
      ) {
        boundaries.push(tail.length);
      }
    }

    let consumed = 0;
    for (const end of boundaries) {
      const slice = tail.slice(consumed, end).trim();
      consumed = end;
      if (slice.length < MIN_CHUNK_CHARS && opts.isStreaming) {
        // Don't emit tiny chunks mid-stream; wait for more text.
        break;
      }
      if (slice.length === 0) continue;
      if (slice.startsWith('```')) continue;
      const text =
        slice.length > MAX_CHUNK_CHARS
          ? slice.slice(0, MAX_CHUNK_CHARS)
          : slice;
      const myIndex = indexRef.current++;
      const messageId = opts.messageId;
      const threadId = opts.threadId;
      const organizationId = opts.organizationId;
      queueRef.current.push(() => {
        void synthesize({
          messageId,
          threadId,
          organizationId,
          index: myIndex,
          text,
          locale,
        })
          .catch((err) => {
            console.error('[tts] synthesize action failed', err);
          })
          .finally(() => {
            inFlightRef.current = Math.max(0, inFlightRef.current - 1);
            runNext();
          });
      });
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
    synthesize,
    locale,
    runNext,
  ]);
}
