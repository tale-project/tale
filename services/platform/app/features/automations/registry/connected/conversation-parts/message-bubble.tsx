'use client';

/**
 * One message bubble — the anatomy promoted from the retired inbox
 * (`message.tsx`), field-map-driven instead of shape-bound: direction-aware
 * alignment (inbound left on the card surface, outbound right on the muted
 * surface), author caption, body as preserved-newline text, markdown (the
 * house `MarkdownContent` renderer) or sanitized HTML (the DOMPurify-backed
 * `EmailPreview` — named for its origin rendering HTML email bodies, but a
 * generic sanitized-HTML renderer; never raw `dangerouslySetInnerHTML` on
 * unsanitized input), timestamp + delivery-state indicator under outbound
 * bubbles, and an attachment card list with a per-attachment action slot.
 */
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { AlertCircle, Clock, Paperclip } from 'lucide-react';
import type { ReactNode } from 'react';

import { EmailPreview } from '@/app/components/ui/data-display/email-preview';
import {
  formatFileSize,
  middleEllipsis,
} from '@/app/features/chat/components/message-bubble/file-displays';
import { MarkdownContent } from '@/app/features/chat/components/message-bubble/markdown-renderer';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

export interface BubbleAttachment {
  key: string;
  filename: string;
  size?: number;
  /** Action slot (e.g. a BoundButton dispatching `attachmentAction`). */
  action?: ReactNode;
}

/** Interpret a `directionField` value: `'outbound'` strings and an explicit
 *  `false` "is inbound/customer" flag both mean an outbound bubble. */
export function isOutboundDirection(value: unknown): boolean {
  return value === 'outbound' || value === false;
}

export interface ConversationMessageBubbleProps {
  author?: string;
  body: string;
  bodyFormat?: 'text' | 'markdown' | 'html';
  /** Pre-formatted time label (e.g. `formatDate(…, 'time')`). */
  timestampLabel?: string;
  outbound?: boolean;
  /** Delivery state of an outbound message (`queued`/`failed` get an icon). */
  deliveryState?: string;
  attachments?: BubbleAttachment[];
}

function deliveryIcon(state: string, label: string): ReactNode {
  if (state === 'queued') {
    return <Clock className="size-3" aria-label={label} />;
  }
  if (state === 'failed') {
    return <AlertCircle className="size-3" aria-label={label} />;
  }
  return null;
}

export function ConversationMessageBubble({
  author,
  body,
  bodyFormat = 'text',
  timestampLabel,
  outbound = false,
  deliveryState,
  attachments,
}: ConversationMessageBubbleProps) {
  const { t } = useT('automations');
  const deliveryLabel =
    deliveryState === 'queued'
      ? t('thread.deliveryQueued')
      : t('thread.deliveryFailed');
  return (
    <div className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
      <div className="relative max-w-[40rem] min-w-0">
        <div
          className={cn(
            'mb-2 overflow-x-auto rounded-2xl p-3 shadow-sm',
            outbound ? 'bg-muted text-foreground' : 'bg-card text-foreground',
          )}
        >
          {author && (
            <Text variant="label-sm" className="text-muted-foreground mb-1">
              {author}
            </Text>
          )}
          {bodyFormat === 'html' ? (
            <EmailPreview html={body} />
          ) : bodyFormat === 'markdown' ? (
            <MarkdownContent content={body} />
          ) : (
            <Text
              as="div"
              variant="body-sm"
              className="leading-5 whitespace-pre-wrap"
            >
              {body}
            </Text>
          )}
          {attachments && attachments.length > 0 && (
            <Stack gap={1} className="mt-3">
              {attachments.map((attachment) => (
                <Row
                  key={attachment.key}
                  gap={2}
                  className="bg-background rounded-lg border p-2"
                >
                  <Paperclip
                    className="text-muted-foreground size-3.5 shrink-0"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <Text variant="label-sm" title={attachment.filename}>
                      {middleEllipsis(attachment.filename, 28)}
                    </Text>
                    {attachment.size !== undefined && (
                      <Text variant="caption" className="text-[10px]">
                        {formatFileSize(attachment.size)}
                      </Text>
                    )}
                  </div>
                  {attachment.action && (
                    <div className="shrink-0">{attachment.action}</div>
                  )}
                </Row>
              ))}
            </Stack>
          )}
        </div>
        {(timestampLabel || (outbound && deliveryState)) && (
          <Text
            as="div"
            variant="caption"
            className={cn(
              'flex items-center gap-1.5 text-nowrap',
              outbound
                ? 'text-muted-foreground/70 justify-end text-right'
                : 'justify-start text-left',
            )}
          >
            {timestampLabel}
            {outbound && deliveryState && (
              <span className="inline-flex items-center">
                {deliveryIcon(deliveryState, deliveryLabel)}
              </span>
            )}
          </Text>
        )}
      </div>
    </div>
  );
}
