'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useConvex } from 'convex/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/convex/_generated/api';

import { segmentTextForTts } from '../utils/segment-tts';

interface UseOnDemandSpeechOpts {
  messageId: string | undefined;
  threadId: string | undefined;
  organizationId: string | undefined;
  /** The assistant message's full text to read aloud. */
  text: string;
}

interface OnDemandSpeech {
  /**
   * Synthesize the whole message via the provider TTS pipeline and reveal
   * the voice-output indicator (whose player auto-plays the fresh chunks).
   * Idempotent per mount — repeated calls only re-reveal the indicator.
   */
  speak: () => void;
  /**
   * True once `speak()` has been invoked for the current message. The
   * message bubble force-enables `<VoiceOutputIndicator>` on this so the
   * play/stop affordance appears even when thread voice mode is off.
   */
  requested: boolean;
}

/**
 * On-demand "Speak out loud" for a single assistant message, independent of
 * thread voice mode. Reuses the existing provider TTS pipeline:
 * `synthesizeChunk` (no voice-mode gate server-side) creates the chunk rows
 * that the message's own `<VoiceOutputIndicator>` player then plays.
 *
 * The streaming voice-output chunker (`use-voice-output.ts`) owns the
 * live-generation path; this hook is the explicit, after-the-fact path for
 * a finished message the user taps to hear.
 */
export function useOnDemandSpeech(opts: UseOnDemandSpeechOpts): OnDemandSpeech {
  const { locale } = useLocale();
  // Provider-safe action handle — surfaces without a ConvexProvider reject
  // into the ordinary error path instead of crashing the render.
  const convex = useConvex();
  const synthesize = useCallback(
    (request: {
      messageId: string;
      threadId: string;
      organizationId: string;
      index: number;
      text: string;
      locale: string;
    }) => {
      if (!convex) {
        return Promise.reject(new Error('no convex client'));
      }
      return convex.action(api.tts.synthesize.synthesizeChunk, request);
    },
    [convex],
  );
  const [requested, setRequested] = useState(false);
  // Guards re-synthesis: a second tap should just keep the indicator up and
  // let its player's Play control take over, not re-fire the actions.
  const synthesizedRef = useRef(false);

  // Reset when the bubble is reused for a different message (defensive — the
  // list keys by message, but memoized bubbles can swap identity).
  useEffect(() => {
    synthesizedRef.current = false;
    setRequested(false);
  }, [opts.messageId]);

  const speak = useCallback(() => {
    const { messageId, threadId, organizationId, text } = opts;
    if (!messageId || !threadId || !organizationId) return;
    setRequested(true);
    if (synthesizedRef.current) return;
    synthesizedRef.current = true;

    const chunks = segmentTextForTts(text, locale);
    chunks.forEach((chunkText, index) => {
      void synthesize({
        messageId,
        threadId,
        organizationId,
        index,
        text: chunkText,
        locale,
      }).catch((err) => {
        // Pre-reservation / provider failures surface on the indicator via
        // the chunk-row error path; log here per the no-silent-catch rule.
        console.error('[tts] speak-out-loud synthesis failed', err);
      });
    });
  }, [opts, locale, synthesize]);

  return { speak, requested };
}
