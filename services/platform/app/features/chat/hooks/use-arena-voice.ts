'use client';

/**
 * Read-aloud for Arena Mode.
 *
 * Two columns stream in parallel, so live per-sentence chunking (the normal
 * voice-mode path) cannot promise an order — B often finishes first. The
 * arena treatment is deterministic instead: once BOTH replies of a round
 * have settled, ONE combined utterance is synthesized onto column A's reply
 * — "A: …" then "B: …" — and chunk order is playback order, so A always
 * reads before B. The "A"/"B" spoken prefixes are deliberate literals, not
 * catalog strings: they name the columns exactly as the arena UI does.
 */

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useConvex } from 'convex/react';
import { useCallback, useRef, useState } from 'react';

import { api } from '@/convex/_generated/api';

import { segmentTextForTts } from '../utils/segment-tts';

export interface ArenaSettledReply {
  readonly messageId: string;
  readonly text: string;
}

export function useArenaVoice(opts: {
  organizationId: string;
  /** Column A's thread — the combined utterance lands on its reply. */
  threadIdA: string;
  /** Voice mode is on and the org can synthesize. */
  enabled: boolean;
}): {
  /** Columns report their round's reply the moment it settles. */
  onReplySettled: (side: 'a' | 'b', reply: ArenaSettledReply) => void;
  /** The message carrying the voice pill (column A's reply), once spoken. */
  voicePillMessageId: string | undefined;
} {
  const { locale } = useLocale();
  const convex = useConvex();
  const [voicePillMessageId, setVoicePillMessageId] = useState<string>();

  // The round's halves and the pairs already spoken. Refs, not state: a half
  // arriving must never re-render the split view.
  const pendingRef = useRef<{ a?: ArenaSettledReply; b?: ArenaSettledReply }>(
    {},
  );
  const spokenRef = useRef(new Set<string>());
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const onReplySettled = useCallback(
    (side: 'a' | 'b', reply: ArenaSettledReply) => {
      const { organizationId, threadIdA, enabled } = optsRef.current;
      if (!enabled || !convex) return;
      pendingRef.current[side] = reply;
      const { a, b } = pendingRef.current;
      if (a === undefined || b === undefined) return;

      const pairKey = `${a.messageId}:${b.messageId}`;
      if (spokenRef.current.has(pairKey)) return;
      spokenRef.current.add(pairKey);
      pendingRef.current = {};

      const chunks = [
        ...segmentTextForTts(`A: ${a.text}`, locale),
        ...segmentTextForTts(`B: ${b.text}`, locale),
      ];
      setVoicePillMessageId(a.messageId);
      chunks.forEach((text, index) => {
        void convex
          .action(api.tts.synthesize.synthesizeChunk, {
            messageId: a.messageId,
            threadId: threadIdA,
            organizationId,
            index,
            text,
            locale,
          })
          .catch((err) => {
            // Provider failures surface on the indicator via the chunk-row
            // error path; log per the no-silent-catch rule.
            console.error('[tts] arena read-aloud synthesis failed', err);
          });
      });
    },
    [convex, locale],
  );

  return { onReplySettled, voicePillMessageId };
}
