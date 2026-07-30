'use client';

/**
 * The transcript boundary: the ONE component that subscribes to the
 * per-chunk stream-text channel. During a streaming turn the 250ms pushes
 * re-render exactly this subtree — the surface above it (composer, thread
 * list, header, canvas) subscribes only to the byte-stable row/status reads
 * and stays still while a reply streams.
 */

import { memo, type MutableRefObject } from 'react';

import { useThreadView } from '../hooks/use-thread-view';
import type { PendingSend } from '../utils/pending-messages';
import { MessageThread, type MessageThreadHandlers } from './message-thread';

interface ChatTranscriptProps extends MessageThreadHandlers {
  organizationId: string;
  /** The rendered sibling. */
  threadId: string | undefined;
  /** The URL's lineage root — hold scope and scroll memory. */
  threadRootId: string | undefined;
  pendingSend: PendingSend | null;
  isGenerating: boolean;
  scrollIntentRef: MutableRefObject<boolean | 'smooth'>;
  forceVoicePillMessageId?: string;
  feedback?: ReadonlyMap<string, 'positive' | 'negative'>;
  voiceEnabled?: boolean;
  speakAvailable?: boolean;
  className?: string;
}

export const ChatTranscript = memo(function ChatTranscript({
  organizationId,
  threadId,
  threadRootId,
  pendingSend,
  isGenerating,
  scrollIntentRef,
  forceVoicePillMessageId,
  feedback,
  voiceEnabled,
  speakAvailable,
  className,
  ...handlers
}: ChatTranscriptProps) {
  const view = useThreadView(
    organizationId,
    threadId,
    pendingSend,
    threadRootId,
  );

  return (
    <MessageThread
      messages={view.items}
      generation={view.generation ?? undefined}
      organizationId={organizationId}
      threadId={threadId}
      threadRootId={threadRootId}
      isGenerating={isGenerating}
      pendingEditedFromThreadId={pendingSend?.editedFromThreadId}
      scrollIntentRef={scrollIntentRef}
      forceVoicePillMessageId={forceVoicePillMessageId}
      feedback={feedback}
      voiceEnabled={voiceEnabled}
      speakAvailable={speakAvailable}
      className={className}
      {...handlers}
    />
  );
});
