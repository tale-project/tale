'use client';

/**
 * The conversation: every message in `sequence` order, followed by the live
 * turn's status.
 *
 * Rows arrive as `ChatMessageItem`s from the thread-view merge, which owns
 * the streaming facts — each item already knows whether it is live. The
 * transcript is a `role="log"` region (the e2e contract), so assistive
 * technology hears new entries without losing its place; the explicit status
 * region below it narrates the queued/streaming/waiting states.
 *
 * Geometry: the list splits into three regions around the LAST USER message —
 * history above it, the anchored user message, and the response area below.
 * The response area carries a slack min-height that fills the viewport, so
 * the send-snap can place the user's message at the top and the reply streams
 * into the space beneath it. Scrolling follows the Gemini doctrine (see
 * use-chat-scroll): generation growth NEVER scrolls; only user actions do.
 */

import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { ArrowDown, MessageSquare } from 'lucide-react';
import { memo, useRef, type MutableRefObject } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useChatScroll } from '../hooks/use-chat-scroll';
import {
  resolveResponseSlackEnabled,
  useResponseSlack,
} from '../hooks/use-response-slack';
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
  /** The conversation being rendered (the resolved sibling). Absent on
   * surfaces without per-message actions that need it (a shared snapshot). */
  organizationId?: string;
  threadId?: string;
  /** The URL's lineage root — the key for per-thread scroll memory. Falls
   * back to `threadId` for single-thread surfaces (arena columns). */
  threadRootId?: string;
  /** A turn is generating or optimistically pending — drives the response
   * slack and the scroll machine's intent lifecycle. */
  isGenerating?: boolean;
  /** The edit-and-branch marker: a branch swap driven by an edit snaps to
   * the edited message instead of preserving the old position. */
  pendingEditedFromThreadId?: string;
  /** The caller-owned force-snap signal (see use-chat-scroll). Absent on
   * read-only surfaces — a local inert ref stands in. */
  scrollIntentRef?: MutableRefObject<boolean | 'smooth'>;
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

/** Index of the last user row — the anchor the three regions split around.
 * The optimistic pending user row counts: the send-snap anchors it. */
function findLastUserIndex(messages: readonly ChatMessageItem[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index;
  }
  return -1;
}

export const MessageThread = memo(function MessageThread({
  messages,
  generation,
  organizationId,
  threadId,
  threadRootId,
  isGenerating,
  pendingEditedFromThreadId,
  scrollIntentRef,
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
  const localIntentRef = useRef<boolean | 'smooth'>(false);
  const intentRef = scrollIntentRef ?? localIntentRef;
  const lastUserMessageRef = useRef<HTMLLIElement | null>(null);
  const responseAreaRef = useRef<HTMLDivElement | null>(null);

  const { containerRef, contentRef, scrollToBottom, showScrollButton } =
    useChatScroll({
      threadId: threadRootId ?? threadId,
      dataThreadId: threadId,
      messagesLength: messages.length,
      isLoading: isGenerating === true,
      pendingEditedMessageId: pendingEditedFromThreadId,
      lastUserMessageRef,
      scrollIntentRef: intentRef,
    });

  const lastUserIdx = findLastUserIndex(messages);
  const beforeItems =
    lastUserIdx >= 0 ? messages.slice(0, lastUserIdx) : messages;
  const lastUserItem = lastUserIdx >= 0 ? messages[lastUserIdx] : undefined;
  const afterItems = lastUserIdx >= 0 ? messages.slice(lastUserIdx + 1) : [];

  // The slack session: active from send until the stream settles, per
  // thread. While active, the response area's min-height fills the viewport
  // so the snap has room to place the user message at the top.
  const slackSessionRef = useRef<{
    threadId: string | undefined;
    active: boolean;
  }>({ threadId, active: false });
  const threadChanged = slackSessionRef.current.threadId !== threadId;
  const { slackEnabled, sessionActive } = resolveResponseSlackEnabled({
    threadChanged,
    isLoading: isGenerating === true,
    prevSessionActive: slackSessionRef.current.active,
    lastUserMessagePending: lastUserItem?.isPendingShell === true,
  });
  slackSessionRef.current = { threadId, active: sessionActive };

  useResponseSlack({
    containerRef,
    contentRef,
    responseAreaRef,
    lastUserMessageRef,
    slackEnabled,
  });

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

  const renderItem = (
    message: ChatMessageItem,
    index: number,
    region: 'history' | 'last-user' | 'response',
  ) => (
    <MessageItem
      key={message.key}
      message={message}
      isLast={index === messages.length - 1}
      isHistory={region === 'history'}
      {...(region === 'last-user' ? { rootRef: lastUserMessageRef } : {})}
      organizationId={organizationId}
      threadId={threadId}
      feedbackRating={feedback?.get(message.id)}
      forkGroup={
        message.role === 'user' ? forkGroups?.get(message.sequence) : undefined
      }
      onEditSubmit={onEditSubmit}
      onRegenerate={onRegenerate}
      onFork={onFork}
      voiceEnabled={voiceEnabled}
      speakAvailable={speakAvailable}
      isFreshSinceMount={isFreshSinceMount(message.id)}
    />
  );

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {/* The dedicated scroller. No CSS scroll-smooth: programmatic pins are
          explicit instant scrolls; the glide animates itself (see
          use-chat-scroll). */}
      <div
        ref={containerRef}
        role="log"
        aria-label={t('aria.messageHistory')}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto will-change-transform"
      >
        {/* The content wrapper's padding-top is the snap/slack inset — the
            surface's className carries the glass-bar clearance. */}
        <div
          ref={contentRef}
          className={cn(
            'mx-auto flex w-full max-w-3xl flex-col px-4 py-6',
            className,
          )}
        >
          <Stack gap={3}>
            {beforeItems.length > 0 && (
              <Stack as="ol" gap={3}>
                {beforeItems.map((message, index) =>
                  renderItem(message, index, 'history'),
                )}
              </Stack>
            )}

            {lastUserItem !== undefined && (
              <ol className="flex flex-col">
                {renderItem(lastUserItem, lastUserIdx, 'last-user')}
              </ol>
            )}

            {/* The response area: the live reply streams into the slack
                beneath the anchored user message. overflow-anchor is off so
                the browser never fights the scroll machine. */}
            <div
              ref={responseAreaRef}
              className="flex shrink-0 flex-col gap-3 [overflow-anchor:none]"
            >
              {afterItems.length > 0 && (
                <Stack as="ol" gap={3}>
                  {afterItems.map((message, index) =>
                    renderItem(message, lastUserIdx + 1 + index, 'response'),
                  )}
                </Stack>
              )}

              {/* The turn's status. Inside the response area so its mount is
                  absorbed by the slack instead of moving the scroller. Always
                  in the DOM so assistive technology has something to watch
                  before the first turn starts. */}
              <div
                role="status"
                aria-live="polite"
                aria-label={t('generation.regionLabel')}
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
          </Stack>

          {messages.length === 0 && !generation && (
            <EmptyState
              icon={MessageSquare}
              title={t('welcomeEmpty')}
              headingLevel={2}
            />
          )}
        </div>
      </div>

      {showScrollButton && messages.length > 0 && (
        <Button
          size="icon"
          variant="secondary"
          aria-label={t('scrollToBottom')}
          onClick={scrollToBottom}
          className="bg-background/95 absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-md"
        >
          <ArrowDown aria-hidden className="size-4" />
        </Button>
      )}
    </div>
  );
});
