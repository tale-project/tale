'use client';

import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Clock, AlertCircle, Paperclip, Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { EmailPreview } from '@/app/components/ui/data-display/email-preview';
import { Image } from '@/app/components/ui/data-display/image';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import {
  formatFileSize,
  middleEllipsis,
} from '@/app/features/shared/files/file-displays';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { Message as MessageType } from '../types';

type Attachment = NonNullable<MessageType['attachments']>[number];

/** A Content-ID with its angle brackets and surrounding space removed, so a
 *  header value and a `cid:` reference compare equal. */
function normalizeCid(cid: string): string {
  return cid.trim().replace(/^<|>$/g, '');
}

/**
 * The Content-IDs an HTML body references, from `src="cid:…"` and
 * `href="cid:…"`.
 *
 * This is the only reliable signal that an attachment is inline. A cid is
 * percent-decoded before comparison, because a reference may be escaped while
 * the header value is not.
 */
function referencedCidsIn(html: string): ReadonlySet<string> {
  const found = new Set<string>();
  for (const match of html.matchAll(
    /(?:src|href)\s*=\s*["']cid:([^"']+)["']/gi,
  )) {
    const raw = match[1];
    if (raw === undefined) continue;
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      // A malformed escape is not a reason to lose the reference; compare raw.
      decoded = raw;
    }
    found.add(normalizeCid(decoded));
  }
  return found;
}

interface MessageProps {
  message: MessageType;
  /** Cancel a queued outbound send inside its undo window. */
  onUndoSend?: (messageId: string) => void;
  /** Re-attempt delivery of a failed outbound send. */
  onRetrySend?: (messageId: string) => void;
  /** Remove a failed outbound message that never delivered. */
  onDiscard?: (messageId: string) => void;
}

function getDeliveryIcon(status: string) {
  switch (status) {
    case 'queued':
      return <Clock className="size-3" />;
    case 'failed':
      // Destructive so a failure never reads like a mere pending clock; the
      // "Not delivered" row below carries the reason and the retry.
      return <AlertCircle className="text-destructive size-3" />;
    default:
      return null;
  }
}

/** Whole seconds until `scheduledSendAt`, or null once passed (or absent). */
function undoSecondsRemaining(scheduledSendAt?: number): number | null {
  if (scheduledSendAt === undefined) return null;
  const ms = scheduledSendAt - Date.now();
  return ms > 0 ? Math.ceil(ms / 1000) : null;
}

/**
 * Live countdown for the undo-send window. Ticks while `scheduledSendAt` is in
 * the future and settles at null when the window closes — the row itself flips
 * to `sent` reactively via the Convex subscription, no polling here.
 */
function useUndoCountdown(scheduledSendAt?: number): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(() =>
    undoSecondsRemaining(scheduledSendAt),
  );

  useEffect(() => {
    setSecondsLeft(undoSecondsRemaining(scheduledSendAt));
    const windowOpen =
      scheduledSendAt !== undefined && scheduledSendAt > Date.now();
    const interval = windowOpen
      ? setInterval(() => {
          const remaining = undoSecondsRemaining(scheduledSendAt);
          setSecondsLeft(remaining);
          if (remaining === null) clearInterval(interval);
        }, 250)
      : undefined;
    return () => {
      if (interval !== undefined) clearInterval(interval);
    };
  }, [scheduledSendAt]);

  return secondsLeft;
}

function getFileIcon(contentType: string, filename: string) {
  if (contentType.startsWith('image/')) return '🖼️';
  if (contentType === 'application/pdf') return '📄';
  if (
    contentType.includes('word') ||
    filename.endsWith('.doc') ||
    filename.endsWith('.docx')
  )
    return '📝';
  if (
    contentType.includes('spreadsheet') ||
    contentType.includes('excel') ||
    filename.endsWith('.xls') ||
    filename.endsWith('.xlsx') ||
    filename.endsWith('.csv')
  )
    return '📊';
  if (
    contentType.includes('presentation') ||
    contentType.includes('powerpoint') ||
    filename.endsWith('.ppt') ||
    filename.endsWith('.pptx')
  )
    return '📊';
  if (contentType.startsWith('text/')) return '📄';
  return '📎';
}

interface AttachmentCardProps {
  attachment: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    storageId?: string;
    url?: string;
  };
}

function AttachmentCard({ attachment }: AttachmentCardProps) {
  const { t } = useT('conversations');

  const icon = getFileIcon(attachment.contentType, attachment.filename);
  // A download is offered ONLY when the message carries a real, servable URL
  // (materialized at sync and presigned at read time). A chip whose bytes were
  // never captured shows metadata alone — no affordance that would 404.
  const downloadUrl = attachment.url;

  return (
    <Row gap={2} className="bg-background rounded-lg border p-2">
      <Row
        gap={0}
        justify="center"
        className="size-8 shrink-0 rounded-lg bg-gray-100"
      >
        <span className="text-sm">{icon}</span>
      </Row>
      <div className="min-w-0 flex-1">
        <Text variant="label-sm" title={attachment.filename}>
          {middleEllipsis(attachment.filename, 28)}
        </Text>
        <Text variant="caption" className="text-[10px]">
          {formatFileSize(attachment.size)}
        </Text>
      </div>
      {downloadUrl ? (
        <button
          type="button"
          onClick={() => {
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = attachment.filename;
            a.click();
          }}
          className="text-muted-foreground hover:text-foreground flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-gray-100"
          aria-label={`${t('attachment.download')} ${attachment.filename}`}
        >
          <Download className="size-3.5" />
        </button>
      ) : null}
    </Row>
  );
}

export function Message({
  message,
  onUndoSend,
  onRetrySend,
  onDiscard,
}: MessageProps) {
  const { formatDate } = useFormatDate();
  const { t } = useT('conversations');

  const isOutbound = !message.isCustomer;
  const isFailed = isOutbound && message.status === 'failed';
  const undoSecondsLeft = useUndoCountdown(
    isOutbound && message.status === 'queued'
      ? message.scheduledSendAt
      : undefined,
  );

  // Build CID→URL map for inline images that have a servable URL.
  const cidMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const att of message.attachments ?? []) {
      if (att.contentId && att.url) {
        map[normalizeCid(att.contentId)] = att.url;
      }
    }
    return map;
  }, [message.attachments]);

  /** The cids the body actually draws, from its `cid:` references. */
  const referencedCids = useMemo(
    () => referencedCidsIn(message.content),
    [message.content],
  );

  // Hide an attachment only when the body actually draws it.
  //
  // This used to hide anything carrying both a contentId and a url, taking a
  // Content-ID as proof of inline use. It is not: many mail clients stamp
  // Content-ID on ordinary file parts, so a real PDF attachment from such a
  // sender was silently dropped from the list while a self-sent test from a
  // client that omits Content-ID showed up fine.
  //
  // An unreferenced attachment stays visible even with a cid, and an inline
  // image with no url yet stays visible as a fallback so it can still be
  // opened when a servable url is present.
  const displayAttachments = useMemo(
    () =>
      (message.attachments ?? []).filter(
        (att: Attachment) =>
          !(
            att.contentId &&
            att.url &&
            referencedCids.has(normalizeCid(att.contentId))
          ),
      ),
    [message.attachments, referencedCids],
  );

  return (
    <Stack gap={0}>
      <div
        className={cn(
          'flex',
          message.isCustomer ? 'justify-start' : 'justify-end',
        )}
      >
        <div className="relative">
          <div
            className={cn(
              'relative mb-2 max-w-[40rem] overflow-x-auto rounded-2xl shadow-sm',
              message.isCustomer
                ? 'bg-card text-foreground'
                : 'bg-muted text-foreground',
            )}
          >
            {(() => {
              if (
                message.attachment &&
                typeof message.attachment === 'object' &&
                message.attachment !== null &&
                'url' in message.attachment
              ) {
                const attachment = message.attachment as {
                  url: string;
                  type?: string;
                  alt?: string;
                };
                return (
                  <div className="mb-3">
                    <Image
                      src={attachment.url}
                      alt={
                        attachment.type === 'image'
                          ? attachment.alt || t('fallbackImageAttachment')
                          : t('fallbackAttachment')
                      }
                      width={460}
                      height={300}
                      className="h-auto w-full rounded-lg"
                    />
                  </div>
                );
              }
              return null;
            })()}
            <Text as="div" variant="body-sm" className="leading-5">
              <EmailPreview html={message.content} cidMap={cidMap} />
            </Text>
            {displayAttachments.length > 0 && (
              <div className="flex flex-col gap-1.5 px-3 pb-3">
                <Row gap={1}>
                  <Paperclip className="text-muted-foreground size-3" />
                  <Text as="span" variant="caption" className="text-[10px]">
                    {t('attachment.attachments', {
                      count: displayAttachments.length,
                    })}
                  </Text>
                </Row>
                <Stack gap={1}>
                  {displayAttachments.map((att: Attachment) => (
                    <AttachmentCard key={att.id} attachment={att} />
                  ))}
                </Stack>
              </div>
            )}
          </div>
          <Text
            as="div"
            variant="caption"
            className={cn(
              'flex items-center justify-end gap-1.5 text-nowrap',
              message.isCustomer
                ? 'text-left'
                : cn(
                    'text-muted-foreground/70 text-right',
                    !isFailed && 'mb-4',
                  ),
            )}
          >
            {undoSecondsLeft !== null ? (
              <>
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3" aria-hidden="true" />
                  {t('message.sendingIn', { seconds: undoSecondsLeft })}
                </span>
                {onUndoSend && (
                  <button
                    type="button"
                    onClick={() => onUndoSend(message.id)}
                    className="text-foreground cursor-pointer font-medium underline underline-offset-2"
                  >
                    {t('message.undoSend')}
                  </button>
                )}
              </>
            ) : (
              <>
                {formatDate(message.timestamp, 'time')}
                {isOutbound && message.status && (
                  <span className="inline-flex items-center">
                    {getDeliveryIcon(message.status)}
                  </span>
                )}
              </>
            )}
          </Text>
          {isFailed && (
            <Text
              as="div"
              variant="caption"
              className="text-destructive mb-4 flex items-center justify-end gap-1.5 text-right"
              role="status"
            >
              {/* Glance: short label only. Provider errors can be long (stack /
                  timeouts with IPs) — keep the detail on hover via Tooltip. */}
              {message.errorMessage ? (
                <Tooltip
                  content={message.errorMessage}
                  contentClassName="max-w-xs whitespace-normal break-words"
                >
                  <span className="cursor-default underline decoration-dotted underline-offset-2">
                    {t('message.notDelivered')}
                  </span>
                </Tooltip>
              ) : (
                <span>{t('message.notDelivered')}</span>
              )}
              {onRetrySend && (
                <button
                  type="button"
                  onClick={() => onRetrySend(message.id)}
                  className="shrink-0 cursor-pointer font-medium underline underline-offset-2"
                >
                  {t('message.retrySend')}
                </button>
              )}
              {onDiscard && (
                <button
                  type="button"
                  onClick={() => onDiscard(message.id)}
                  className="shrink-0 cursor-pointer font-medium underline underline-offset-2"
                >
                  {t('message.discard')}
                </button>
              )}
            </Text>
          )}
        </div>
      </div>
    </Stack>
  );
}
