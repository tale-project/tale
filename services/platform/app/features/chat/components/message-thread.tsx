'use client';

/**
 * The conversation: every message in `sequence` order, followed by the live
 * turn's status.
 *
 * Generation state comes from ONE fact — a generation object exists for the
 * thread, or it does not. There is no per-message "is streaming" flag to keep
 * in sync, because the backing row is deleted the moment a turn settles. The
 * status renders into a polite live region so a screen reader hears the turn
 * start, wait for an approval, and finish without the reader losing its
 * place in the transcript.
 */

import { EmptyState } from '@tale/ui/empty-state';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { MessageSquare, TriangleAlert } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { ChatGenerationView, ChatMessageView } from '../types';
import { MessageParts } from './message-parts';

/** The catalog key describing each generation status, in one place. */
const GENERATION_STATUS_KEY: Record<ChatGenerationView['status'], string> = {
  queued: 'generation.queued',
  streaming: 'generation.streaming',
  'waiting-approval': 'generation.waitingApproval',
  'waiting-input': 'generation.waitingInput',
};

interface MessageThreadProps {
  messages: readonly ChatMessageView[];
  /** Present exactly while a turn is in flight. */
  generation?: ChatGenerationView | null;
  className?: string;
}

export function MessageThread({
  messages,
  generation,
  className,
}: MessageThreadProps) {
  const { t } = useT('chat');

  return (
    <div
      className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto', className)}
    >
      <Stack
        as="ol"
        gap={5}
        aria-label={t('aria.messageHistory')}
        className="mx-auto w-full max-w-3xl px-4 py-6"
      >
        {messages.map((message) => (
          <li key={message.id} className="flex min-w-0 flex-col gap-1.5">
            <Text
              variant="muted"
              className="text-xs font-medium tracking-wide uppercase"
            >
              {t(`roles.${message.role}`)}
            </Text>
            <MessageParts parts={message.parts} />
            {message.blockedReason && (
              <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                {t('parts.blocked', { reason: message.blockedReason })}
              </p>
            )}
            {message.error && (
              <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                {message.error}
              </p>
            )}
          </li>
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
  );
}
