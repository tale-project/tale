'use client';

/**
 * The conversation: every message in `sequence` order, followed by the live
 * turn's status.
 *
 * Rows arrive as `ChatMessageItem`s from the thread-view merge, which owns
 * the streaming facts — each item already knows whether it is live. The transcript
 * is a `role="log"` region (the e2e contract), so assistive technology hears
 * new entries without losing its place; the explicit status region below it
 * narrates the queued/streaming/waiting states.
 *
 * Scrolling: opening a thread lands at the end; while the reader is at the
 * bottom the view follows growth; the moment they scroll up it stops
 * following and a jump-back affordance appears.
 */

import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { ArrowDown, MessageSquare } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useAutoScroll } from '@/app/hooks/use-auto-scroll';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type {
  ChatGenerationView,
  ChatMessageItem,
  ChatMessageView,
} from '../types';
import { MessageItem, type MessageForkGroupView } from './message-item';

/** The catalog key describing each generation status, in one place. */
const GENERATION_STATUS_KEY: Record<ChatGenerationView['status'], string> = {
  queued: 'generation.queued',
  streaming: 'generation.streaming',
  'waiting-approval': 'generation.waitingApproval',
  'waiting-input': 'generation.waitingInput',
};

interface MessageThreadProps {
  messages: readonly ChatMessageItem[];
  /** Present exactly while a turn is in flight. */
  generation?: ChatGenerationView | null;
  /** The conversation being rendered. Absent on surfaces without
   * per-message actions that need it (a shared snapshot). */
  organizationId?: string;
  threadId?: string;
  /** The caller's rating per message id, from the thread-wide feedback map. */
  feedback?: ReadonlyMap<string, 'positive' | 'negative'>;
  /** The sibling flippers of the view path, keyed by message sequence. */
  forkGroups?: ReadonlyMap<number, MessageForkGroupView>;
  /** Start an edited sibling of a user message. Absent = read-only surface. */
  onEditSubmit?: (message: ChatMessageView, text: string) => void;
  /** Re-answer the prompt an assistant reply answered, as a sibling. */
  onRegenerate?: (message: ChatMessageView) => void;
  /** Fork the conversation up to a message into a visible new chat. */
  onFork?: (message: ChatMessageView) => void;
  /** "Read replies aloud" is on for this conversation — fresh assistant
   * replies synthesize and the live message carries the voice pill. */
  voiceEnabled?: boolean;
  /** The org can synthesize at all — gates the "Speak out loud" action. */
  speakAvailable?: boolean;
  className?: string;
}

export function MessageThread({
  messages,
  generation,
  organizationId,
  threadId,
  feedback,
  forkGroups,
  onEditSubmit,
  onRegenerate,
  onFork,
  voiceEnabled,
  speakAvailable,
  className,
}: MessageThreadProps) {
  const { t } = useT('chat');
  const { containerRef, scrollToBottom, isAtBottom } = useAutoScroll();
  const [awayFromBottom, setAwayFromBottom] = useState(false);

  // The ids present when this conversation first rendered. A message NOT in
  // this snapshot arrived live during the mount — the auto-voice chunker
  // reads only those, so revisiting a thread never re-reads old replies.
  const initialIdsRef = useRef<{
    threadId: string | undefined;
    ids: ReadonlySet<string>;
  } | null>(null);
  if (
    messages.length > 0 &&
    (initialIdsRef.current === null ||
      initialIdsRef.current.threadId !== threadId)
  ) {
    initialIdsRef.current = {
      threadId,
      ids: new Set(messages.map((message) => message.id)),
    };
  }
  const isFreshSinceMount = (id: string): boolean =>
    initialIdsRef.current !== null && !initialIdsRef.current.ids.has(id);

  // Follow growth while the reader is at the bottom (and land there on
  // open). `messages` is a fresh array per update, so every appended row or
  // streamed chunk re-runs this; a reader who scrolled up is left alone.
  useEffect(() => {
    if (!awayFromBottom) scrollToBottom();
  }, [messages, awayFromBottom, scrollToBottom]);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={containerRef}
        role="log"
        aria-label={t('aria.messageHistory')}
        onScroll={() => setAwayFromBottom(!isAtBottom())}
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-y-auto',
          className,
        )}
      >
        <Stack as="ol" gap={3} className="mx-auto w-full max-w-3xl px-4 py-6">
          {messages.map((message, index) => (
            <MessageItem
              key={message.key}
              message={message}
              isLast={index === messages.length - 1}
              organizationId={organizationId}
              threadId={threadId}
              feedbackRating={feedback?.get(message.id)}
              forkGroup={
                message.role === 'user'
                  ? forkGroups?.get(message.sequence)
                  : undefined
              }
              onEditSubmit={onEditSubmit}
              onRegenerate={onRegenerate}
              onFork={onFork}
              voiceEnabled={voiceEnabled}
              speakAvailable={speakAvailable}
              isFreshSinceMount={isFreshSinceMount(message.id)}
            />
          ))}
        </Stack>

        {messages.length === 0 && !generation && (
          <EmptyState
            icon={MessageSquare}
            title={t('welcomeEmpty')}
            headingLevel={2}
          />
        )}

        {/* The turn's status. The region is always in the DOM so assistive
            technology has something to watch before the first turn starts. */}
        <div
          role="status"
          aria-live="polite"
          aria-label={t('generation.regionLabel')}
          className="mx-auto w-full max-w-3xl px-4 pb-4"
        >
          {generation && (
            <Text variant="muted" className="text-sm">
              {t(GENERATION_STATUS_KEY[generation.status])}
              {generation.waitingOn
                ? ` ${t('generation.waitingOn', { detail: generation.waitingOn })}`
                : ''}
            </Text>
          )}
        </div>
      </div>

      {awayFromBottom && messages.length > 0 && (
        <Button
          size="icon"
          variant="secondary"
          aria-label={t('scrollToBottom')}
          onClick={() => {
            scrollToBottom();
            setAwayFromBottom(false);
          }}
          className="bg-background/95 absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-md"
        >
          <ArrowDown aria-hidden className="size-4" />
        </Button>
      )}
    </div>
  );
}
