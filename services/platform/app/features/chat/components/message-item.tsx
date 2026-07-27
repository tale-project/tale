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
import { useLayoutEffect, useRef, useState } from 'react';

import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { messagePlainText } from '../lib/message-text';
import type { ChatMessageView } from '../types';
import { BranchNavigator } from './branch-navigator';
import { MessageEditForm } from './message-edit-form';
import { MessageMarkdown } from './message-markdown';
import { MessageParts } from './message-parts';
import { MessageToolbar } from './message-toolbar';

/** Lazy rasterization for history rows; the intrinsic size keeps the
 * scrollbar honest while off-screen items stay unrendered. */
const HISTORY_CONTENT_VISIBILITY =
  '[content-visibility:auto] [contain-intrinsic-size:auto_200px]';

/** The ‹ n/m › state of the fork point AT this message, when one exists. */
export interface MessageForkGroupView {
  readonly index: number;
  readonly total: number;
  readonly onSelect: (index: number) => void;
}

interface MessageItemProps {
  message: ChatMessageView;
  isLast: boolean;
  /** True while the live turn streams into this message. */
  isStreaming: boolean;
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
}

export function MessageItem({
  message,
  isLast,
  isStreaming,
  organizationId,
  threadId,
  feedbackRating,
  forkGroup,
  onEditSubmit,
  onRegenerate,
  onFork,
}: MessageItemProps) {
  const { t } = useT('chat');
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  return (
    <li
      data-testid="chat-message"
      data-message-role={message.role}
      className={cn(
        'group/message flex min-w-0 flex-col',
        isUser ? 'items-end' : 'items-start',
        !isLast && HISTORY_CONTENT_VISIBILITY,
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
          isStreaming={isStreaming}
          organizationId={organizationId}
          threadId={threadId}
          feedbackRating={feedbackRating}
          onRegenerate={onRegenerate}
          onFork={onFork}
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
          !expanded && 'max-h-96 overflow-hidden',
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

/** The assistant's turn: full-width markdown, toolbar underneath. */
function AssistantBody({
  message,
  isLast,
  isStreaming,
  organizationId,
  threadId,
  feedbackRating,
  onRegenerate,
  onFork,
}: {
  message: ChatMessageView;
  isLast: boolean;
  isStreaming: boolean;
  organizationId?: string;
  threadId?: string;
  feedbackRating?: 'positive' | 'negative';
  onRegenerate?: (message: ChatMessageView) => void;
  onFork?: (message: ChatMessageView) => void;
}) {
  const waitingForFirstToken =
    isStreaming && messagePlainText(message.parts).length === 0;

  return (
    <div className="w-full min-w-0">
      {waitingForFirstToken ? (
        <ThinkingDots />
      ) : (
        <MessageMarkdown parts={message.parts} isStreaming={isStreaming} />
      )}
      {/* The toolbar arrives when the turn settles — the live region below
          the transcript narrates the in-flight states. */}
      {!isStreaming && (
        <MessageToolbar
          message={message}
          alwaysVisible={isLast}
          organizationId={organizationId}
          threadId={threadId}
          rating={feedbackRating}
          onRegenerate={onRegenerate}
          onFork={onFork}
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
