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
 */

import { Text } from '@tale/ui/text';
import { memo, useEffect, useRef, type ReactNode } from 'react';

import type { ArenaSettledReply } from '../../hooks/use-arena-voice';
import { useThreadView } from '../../hooks/use-thread-view';
import { MessageThread } from '../message-thread';

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
}

export const ArenaColumn = memo(function ArenaColumn({
  organizationId,
  threadId,
  label,
  headerExtra,
  onReplySettled,
  voicePillMessageId,
}: ArenaColumnProps) {
  const view = useThreadView(organizationId, threadId);

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
        forceVoicePillMessageId={voicePillMessageId}
      />
    </section>
  );
});
