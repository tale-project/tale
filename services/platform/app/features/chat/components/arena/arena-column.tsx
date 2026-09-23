'use client';

/**
 * One column of the arena split view: its own conversation, streaming
 * through the ordinary message/generation watches. Exactly two extra
 * subscriptions per column — the composer, catalog, and thread list stay
 * single-instance on the surface.
 *
 * The transcript is deliberately action-less (no edit, regenerate, fork, or
 * feedback): during a comparison the VERDICT is the feedback, and mutating
 * one column would desynchronize the pair.
 *
 * A send reads here as it does in a normal chat: the round the composer fans
 * out becomes this column's own optimistic send (the bubble and the thinking
 * shell, adopted by the real rows), and the send-snap glides the bubble to
 * the top with the reply streaming beneath it.
 */

import { Text } from '@tale/ui/text';
import { memo, useEffect, useRef, type ReactNode } from 'react';

import type { ArenaSettledReply } from '../../hooks/use-arena-voice';
import { useThreadView } from '../../hooks/use-thread-view';
import type { ChatMessageItem } from '../../types';
import {
  baselineSequenceOf,
  createPendingSend,
  type PendingSend,
} from '../../utils/pending-messages';
import { MessageThread } from '../message-thread';

/** One prompt the composer fanned into the pair — what each column turns
 * into its own optimistic send. */
export interface ArenaRound {
  readonly text: string;
  readonly sentAt: number;
}

interface ArenaColumnProps {
  organizationId: string;
  threadId: string;
  /** The column's heading ("Model A" / "Model B"). */
  label: string;
  /** The model identity line, or the column's own picker (column B). */
  headerExtra?: ReactNode;
  /** Fires once per round when this column's reply settles — the arena
   * read-aloud sequencer collects both halves before speaking. */
  onReplySettled?: (reply: ArenaSettledReply) => void;
  /** The reply carrying the arena voice pill (column A only). */
  voicePillMessageId?: string;
  /** When the pair formed (epoch ms): only a reply written after it can be
   * judged — the history copied at pairing is not this column's answer. */
  judgedSince?: number;
  /** Reports whether this column holds a reply the verdict can rate — the
   * split view gates the verdict buttons on both columns saying yes. */
  onJudgeableChange?: (judgeable: boolean) => void;
  /** The round just sent, until the pair's turn resolves. */
  round?: ArenaRound;
}

export const ArenaColumn = memo(function ArenaColumn({
  organizationId,
  threadId,
  label,
  headerExtra,
  onReplySettled,
  voicePillMessageId,
  judgedSince,
  onJudgeableChange,
  round,
}: ArenaColumnProps) {
  // The round's overlay, made once per round against the rows on screen
  // when it was sent — the baseline keeps an earlier prompt with the same
  // words from adopting it. The send-snap intent is armed with it, so the
  // commit that paints the bubble is the tick that glides it to the top.
  const itemsRef = useRef<readonly ChatMessageItem[]>([]);
  const pendingRef = useRef<PendingSend | null>(null);
  const scrollIntentRef = useRef<boolean | 'smooth'>(false);
  if (round === undefined) {
    pendingRef.current = null;
  } else if (pendingRef.current?.sentAt !== round.sentAt) {
    pendingRef.current = createPendingSend({
      text: round.text,
      sentAt: round.sentAt,
      threadId,
      baselineSequence: baselineSequenceOf(itemsRef.current),
    });
    scrollIntentRef.current = 'smooth';
  }
  const pending = pendingRef.current;
  const view = useThreadView(organizationId, threadId, pending);
  itemsRef.current = view.items;
  // Live from Send until the stream settles — the overlay covers the gap
  // before the generation row exists, as it does for a normal send.
  const isGenerating =
    view.generation !== null || (pending !== null && !view.pendingConsumed);

  // Report the round's settled reply exactly once. `isFinalReveal` gates to
  // replies that STREAMED during this mount, so opening an old pair never
  // reads history aloud.
  const last = view.items.at(-1);
  const settledTail =
    last !== undefined &&
    last.role === 'assistant' &&
    !last.isStreaming &&
    last.isFinalReveal &&
    last.text.length > 0
      ? last
      : undefined;
  const reportedRef = useRef<string | null>(null);
  useEffect(() => {
    if (settledTail === undefined || onReplySettled === undefined) return;
    if (reportedRef.current === settledTail.id) return;
    reportedRef.current = settledTail.id;
    onReplySettled({ messageId: settledTail.id, text: settledTail.text });
  }, [settledTail, onReplySettled]);

  // Whether there is a reply to judge: the newest row is a finished,
  // error-free assistant reply written since the pair formed. An
  // unanswered prompt, an error row (a side the fan-out could not start),
  // or only the copied history reads as "nothing to rate" — the same rule
  // the settle door enforces.
  const judgeable =
    last !== undefined &&
    last.role === 'assistant' &&
    !last.isStreaming &&
    last.error === undefined &&
    last.status !== 'pending' &&
    (judgedSince === undefined || last.createdAt > judgedSince);
  useEffect(() => {
    onJudgeableChange?.(judgeable);
  }, [judgeable, onJudgeableChange]);

  return (
    <section
      aria-label={label}
      data-testid="arena-column"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <div className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <Text variant="muted" className="text-xs font-medium tracking-wide">
          {label}
        </Text>
        {headerExtra}
      </div>
      <MessageThread
        messages={view.items}
        generation={view.generation ?? undefined}
        organizationId={organizationId}
        threadId={threadId}
        isGenerating={isGenerating}
        scrollIntentRef={scrollIntentRef}
        forceVoicePillMessageId={voicePillMessageId}
      />
    </section>
  );
});
