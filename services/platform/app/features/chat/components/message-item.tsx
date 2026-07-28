'use client';

/**
 * One message of the transcript.
 *
 * The user's turns read as compact right-aligned bubbles (long ones clamp
 * with a Show more toggle; a hover pencil swaps the bubble for the edit
 * form); the assistant's read as the page itself — full width, markdown, the
 * actions toolbar underneath. A forked message carries the ‹ n/m › sibling
 * navigator. Tool and system rows keep their chip presentation. History items
 * rasterize lazily (`content-visibility`) so a long thread costs what the
 * viewport shows, not what the conversation accumulated.
 */

import { Button } from '@tale/ui/button';
import { Pencil, TriangleAlert } from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from 'react';

import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useOnDemandSpeech } from '../hooks/use-on-demand-speech';
import { useVoiceOutputChunker } from '../hooks/use-voice-output';
import { messagePlainText } from '../lib/message-text';
import type { ChatMessageItem, ChatMessageView } from '../types';
import { BranchNavigator } from './branch-navigator';
import { MessageEditForm } from './message-edit-form';
import { MessageMarkdown } from './message-markdown';
import { MessageParts } from './message-parts';
import { MessageToolbar } from './message-toolbar';
import { VoiceOutputIndicator } from './voice-output-indicator';

/** Lazy rasterization for history rows; the intrinsic size keeps the
 * scrollbar honest while off-screen items stay unrendered. */
const HISTORY_CONTENT_VISIBILITY =
  '[content-visibility:auto] [contain-intrinsic-size:auto_200px]';

/** Breathing room between the last revealed segment and the toolbar's
 * arrival, so the chrome never lands inside the settling text. */
const TOOLBAR_REVEAL_DELAY_MS = 450;
/** A reveal that never reports completion still frees the toolbar. */
const REVEAL_SAFETY_TIMEOUT_MS = 10_000;

/** The ‹ n/m › state of the fork point AT this message, when one exists. */
export interface MessageForkGroupView {
  readonly index: number;
  readonly total: number;
  readonly onSelect: (index: number) => void;
}

interface MessageItemProps {
  message: ChatMessageItem;
  isLast: boolean;
  /** The row sits in the history region (above the last user message) —
   * rasterized lazily; the anchored/response rows always render fully. */
  isHistory?: boolean;
  /** The scroll anchor ref — set on the LAST USER row only; the send-snap
   * scrolls this element to the viewport top. */
  rootRef?: Ref<HTMLLIElement>;
  /** The conversation the message belongs to. Absent on surfaces that carry
   * no per-message actions needing it (a shared snapshot). */
  organizationId?: string;
  threadId?: string;
  /** The caller's stored rating for this message, from the thread map. */
  feedbackRating?: 'positive' | 'negative';
  /** The sibling flipper for a fork at this message's sequence. */
  forkGroup?: MessageForkGroupView;
  /** Start an edited sibling of this user message. Absent = not editable. */
  onEditSubmit?: (message: ChatMessageView, text: string) => void;
  /** Re-answer the prompt this assistant reply answered, as a sibling. */
  onRegenerate?: (message: ChatMessageView) => void;
  /** Fork the conversation up to this message into a visible new chat. */
  onFork?: (message: ChatMessageView) => void;
  /** "Read replies aloud" is on — fresh replies synthesize as they stream. */
  voiceEnabled?: boolean;
  /** The org can synthesize — gates the "Speak out loud" action. */
  speakAvailable?: boolean;
  /** The message arrived live during this mount (not with the history). */
  isFreshSinceMount?: boolean;
}

function MessageItemComponent({
  message,
  isLast,
  isHistory,
  rootRef,
  organizationId,
  threadId,
  feedbackRating,
  forkGroup,
  onEditSubmit,
  onRegenerate,
  onFork,
  voiceEnabled,
  speakAvailable,
  isFreshSinceMount,
}: MessageItemProps) {
  const { t } = useT('chat');
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  return (
    <li
      ref={rootRef}
      data-testid="chat-message"
      data-message-role={message.role}
      data-message-key={message.key}
      className={cn(
        'group/message flex min-w-0 flex-col',
        isUser ? 'items-end' : 'items-start',
        isHistory === true && HISTORY_CONTENT_VISIBILITY,
        rootRef !== undefined && 'scroll-mt-6',
      )}
    >
      {isUser ? (
        <UserBubble
          message={message}
          forkGroup={forkGroup}
          onEditSubmit={onEditSubmit}
        />
      ) : isAssistant ? (
        <AssistantBody
          message={message}
          isLast={isLast}
          organizationId={organizationId}
          threadId={threadId}
          feedbackRating={feedbackRating}
          onRegenerate={onRegenerate}
          onFork={onFork}
          voiceEnabled={voiceEnabled}
          speakAvailable={speakAvailable}
          isFreshSinceMount={isFreshSinceMount}
        />
      ) : (
        <MessageParts parts={message.parts} />
      )}

      {message.blockedReason !== undefined && (
        <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-sm">
          <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
          {t('parts.blocked', { reason: message.blockedReason })}
        </p>
      )}
      {message.error !== undefined && (
        <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-sm">
          <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
          {message.error}
        </p>
      )}
    </li>
  );
}

/**
 * The row memo: the identity seam upstream hands back the SAME item reference
 * unless a rendered field changed, so the first check settles almost every
 * row on a streamed tick. The remaining props are scalars or
 * identity-stabilized by the surface; `forkGroup` compares by identity
 * because its map rebuilds only on branch changes, never mid-stream.
 */
export const MessageItem = memo(
  MessageItemComponent,
  (prevProps, nextProps) =>
    prevProps.message === nextProps.message &&
    prevProps.isLast === nextProps.isLast &&
    prevProps.isHistory === nextProps.isHistory &&
    prevProps.rootRef === nextProps.rootRef &&
    prevProps.organizationId === nextProps.organizationId &&
    prevProps.threadId === nextProps.threadId &&
    prevProps.feedbackRating === nextProps.feedbackRating &&
    prevProps.forkGroup === nextProps.forkGroup &&
    prevProps.onEditSubmit === nextProps.onEditSubmit &&
    prevProps.onRegenerate === nextProps.onRegenerate &&
    prevProps.onFork === nextProps.onFork &&
    prevProps.voiceEnabled === nextProps.voiceEnabled &&
    prevProps.speakAvailable === nextProps.speakAvailable &&
    prevProps.isFreshSinceMount === nextProps.isFreshSinceMount,
);

/** The user's turn: a right-aligned bubble, clamped when it runs long, with
 * the edit affordance and the fork navigator underneath. */
function UserBubble({
  message,
  forkGroup,
  onEditSubmit,
}: {
  message: ChatMessageView;
  forkGroup?: MessageForkGroupView;
  onEditSubmit?: (message: ChatMessageView, text: string) => void;
}) {
  const { t } = useT('chat');
  const { formatDateHeader, formatDate } = useFormatDate();
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [editing, setEditing] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // "Today, 14:32" / "Yesterday, 09:15" / a localized date + time — revealed
  // on hover alongside the edit affordance.
  const sentAt = new Date(message.createdAt);
  const sentLabel = `${formatDateHeader(sentAt)}, ${formatDate(sentAt, 'time')}`;

  // Measure the clamp only while clamped — once expanded, scrollHeight equals
  // clientHeight and would read as "fits", hiding the Show less toggle.
  useLayoutEffect(() => {
    if (expanded || editing) return;
    const el = bodyRef.current;
    if (!el) return;
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [expanded, editing, message.parts]);

  if (editing) {
    return (
      <MessageEditForm
        initialText={messagePlainText(message.parts)}
        onSubmit={(text) => {
          setEditing(false);
          onEditSubmit?.(message, text);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="flex max-w-xs flex-col items-end lg:max-w-md">
      <div
        ref={bodyRef}
        className={cn(
          'bg-muted text-foreground rounded-2xl px-4 py-3',
          // ~10 lines of text-sm; anything longer collapses behind Show more.
          !expanded && 'max-h-60 overflow-hidden',
        )}
      >
        <MessageParts parts={message.parts} />
      </div>
      <div className="flex items-center gap-0.5">
        <span className="text-muted-foreground/70 mt-1 text-xs opacity-0 transition-opacity group-hover/message:opacity-100 pointer-coarse:opacity-100">
          {sentLabel}
        </span>
        {(overflowing || expanded) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setExpanded((value) => !value)}
            className="text-muted-foreground mt-1 h-6 px-2 text-xs"
          >
            {expanded ? t('showLess') : t('showMore')}
          </Button>
        )}
        {onEditSubmit !== undefined && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('editMessage')}
            data-testid="message-edit-button"
            onClick={() => setEditing(true)}
            className="text-muted-foreground mt-1 size-6 opacity-0 transition-opacity group-hover/message:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
          >
            <Pencil aria-hidden className="size-3" />
          </Button>
        )}
        {forkGroup !== undefined && (
          <BranchNavigator
            index={forkGroup.index}
            total={forkGroup.total}
            onSelect={forkGroup.onSelect}
          />
        )}
      </div>
    </div>
  );
}

/** The assistant's turn: full-width markdown, the voice pill when the reply
 * speaks, toolbar underneath. */
function AssistantBody({
  message,
  isLast,
  organizationId,
  threadId,
  feedbackRating,
  onRegenerate,
  onFork,
  voiceEnabled,
  speakAvailable,
  isFreshSinceMount,
}: {
  message: ChatMessageItem;
  isLast: boolean;
  organizationId?: string;
  threadId?: string;
  feedbackRating?: 'positive' | 'negative';
  onRegenerate?: (message: ChatMessageView) => void;
  onFork?: (message: ChatMessageView) => void;
  voiceEnabled?: boolean;
  speakAvailable?: boolean;
  isFreshSinceMount?: boolean;
}) {
  const { text, isStreaming } = message;
  const waitingForFirstToken = isStreaming && text.length === 0;

  // The toolbar waits for the REVEAL to finish, not just the stream: the
  // buffered typewriter keeps writing after the turn settles, and a toolbar
  // mounting mid-drain is pushed down by every revealed segment. History
  // rows mount settled and skip the wait.
  const [revealDone, setRevealDone] = useState(
    () => !message.isStreaming && !message.isFinalReveal,
  );
  const handleRevealComplete = useCallback(() => {
    window.setTimeout(() => setRevealDone(true), TOOLBAR_REVEAL_DELAY_MS);
  }, []);
  useEffect(() => {
    // Safety valve: a settled row whose reveal never reports completion (a
    // hidden tab froze the rAF loop) still gets its toolbar.
    if (revealDone || isStreaming) return undefined;
    const timer = window.setTimeout(
      () => setRevealDone(true),
      REVEAL_SAFETY_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [revealDone, isStreaming]);

  // Auto-voice: reads the reply aloud as it streams (fresh messages only —
  // the fresh gate keeps a revisited thread from re-reading history). The
  // hook renders nothing and idles unless enabled.
  useVoiceOutputChunker({
    enabled: voiceEnabled === true,
    messageId: message.id,
    threadId,
    organizationId,
    text,
    isStreaming,
    isFreshSinceMount: isFreshSinceMount === true,
  });
  // On-demand: the toolbar's "Speak out loud" for a settled reply.
  const onDemand = useOnDemandSpeech({
    messageId: message.id,
    threadId,
    organizationId,
    text,
  });
  // The voice pill mounts only where it can matter — the live/fresh message
  // under voice mode, or after an explicit speak — so a long history never
  // carries per-row chunk subscriptions.
  const showVoicePill =
    (voiceEnabled === true && (isStreaming || isFreshSinceMount === true)) ||
    onDemand.requested;

  return (
    <div className="w-full min-w-0">
      {showVoicePill && (
        <VoiceOutputIndicator
          enabled
          messageId={message.id}
          threadId={threadId}
          isStreaming={isStreaming}
          isFreshSinceMount={isFreshSinceMount === true}
          organizationId={organizationId}
        />
      )}
      {/* One persistent wrapper across the dots → text transition, so the
          swap never collapses the row's box. */}
      <div className="min-h-5 w-full min-w-0">
        {waitingForFirstToken ? (
          <ThinkingDots />
        ) : (
          <MessageMarkdown
            text={text}
            parts={message.parts}
            isStreaming={isStreaming}
            onRevealComplete={revealDone ? undefined : handleRevealComplete}
          />
        )}
      </div>
      {/* The toolbar arrives when the REVEAL settles — the live region below
          the transcript narrates the in-flight states. */}
      {!isStreaming && revealDone && (
        <MessageToolbar
          message={message}
          alwaysVisible={isLast}
          organizationId={organizationId}
          threadId={threadId}
          rating={feedbackRating}
          onRegenerate={onRegenerate}
          onFork={onFork}
          onSpeak={
            speakAvailable === true &&
            threadId !== undefined &&
            organizationId !== undefined &&
            text.length > 0
              ? onDemand.speak
              : undefined
          }
        />
      )}
    </div>
  );
}

/** The reply is on its way but no text has cleared yet. Decorative — the
 * generation live region carries the accessible status. */
function ThinkingDots() {
  return (
    <span aria-hidden className="flex h-5 items-center gap-1">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="bg-muted-foreground/60 size-1.5 animate-pulse rounded-full motion-reduce:animate-none"
          style={{ animationDelay: `${index * 150}ms` }}
        />
      ))}
    </span>
  );
}
