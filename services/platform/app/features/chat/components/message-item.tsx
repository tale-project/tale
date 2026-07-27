'use client';

/**
 * One message of the transcript.
 *
 * The user's turns read as compact right-aligned bubbles (long ones clamp
 * with a Show more toggle); the assistant's read as the page itself — full
 * width, markdown, the actions toolbar underneath. Tool and system rows keep
 * their chip presentation. History items rasterize lazily
 * (`content-visibility`) so a long thread costs what the viewport shows, not
 * what the conversation accumulated.
 */

import { Button } from '@tale/ui/button';
import { TriangleAlert } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { messagePlainText } from '../lib/message-text';
import type { ChatMessageView } from '../types';
import { MessageMarkdown } from './message-markdown';
import { MessageParts } from './message-parts';
import { MessageToolbar } from './message-toolbar';

/** Lazy rasterization for history rows; the intrinsic size keeps the
 * scrollbar honest while off-screen items stay unrendered. */
const HISTORY_CONTENT_VISIBILITY =
  '[content-visibility:auto] [contain-intrinsic-size:auto_200px]';

interface MessageItemProps {
  message: ChatMessageView;
  isLast: boolean;
  /** True while the live turn streams into this message. */
  isStreaming: boolean;
}

export function MessageItem({
  message,
  isLast,
  isStreaming,
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
        <UserBubble message={message} />
      ) : isAssistant ? (
        <AssistantBody
          message={message}
          isLast={isLast}
          isStreaming={isStreaming}
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

/** The user's turn: a right-aligned bubble, clamped when it runs long. */
function UserBubble({ message }: { message: ChatMessageView }) {
  const { t } = useT('chat');
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Measure the clamp only while clamped — once expanded, scrollHeight equals
  // clientHeight and would read as "fits", hiding the Show less toggle.
  useLayoutEffect(() => {
    if (expanded) return;
    const el = bodyRef.current;
    if (!el) return;
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [expanded, message.parts]);

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
    </div>
  );
}

/** The assistant's turn: full-width markdown, toolbar underneath. */
function AssistantBody({
  message,
  isLast,
  isStreaming,
}: {
  message: ChatMessageView;
  isLast: boolean;
  isStreaming: boolean;
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
        <MessageToolbar message={message} alwaysVisible={isLast} />
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
