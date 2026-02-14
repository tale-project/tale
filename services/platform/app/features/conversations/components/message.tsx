'use client';

import { Clock, AlertCircle, Paperclip, Download, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { EmailPreview } from '@/app/components/ui/data-display/email-preview';
import { Image } from '@/app/components/ui/data-display/image';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { Message as MessageType } from '../types';

interface MessageProps {
  message: MessageType;
  onDownloadAttachments?: (messageId: string) => void;
}

function getDeliveryIcon(status: string) {
  switch (status) {
    case 'queued':
      return <Clock className="size-3" />;
    case 'failed':
      return <AlertCircle className="size-3" />;
    default:
      return null;
  }
}

function formatFileSize(bytes: number, tCommon: (key: string) => string) {
  if (bytes === 0) return `0 ${tCommon('fileSize.bytes')}`;
  const k = 1024;
  const units = [
    tCommon('fileSize.bytes'),
    tCommon('fileSize.kb'),
    tCommon('fileSize.mb'),
    tCommon('fileSize.gb'),
  ];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    units.length - 1,
  );
  return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${units[i]}`;
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
  isDownloading?: boolean;
  onDownload?: () => void;
}

function AttachmentCard({
  attachment,
  isDownloading,
  onDownload,
}: AttachmentCardProps) {
  const { t } = useT('conversations');
  const { t: tCommon } = useT('common');

  const icon = getFileIcon(attachment.contentType, attachment.filename);
  const hasUrl = !!attachment.url;

  return (
    <div className="bg-background flex items-center gap-2 rounded-lg border p-2">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gray-100">
        <span className="text-sm">{icon}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium" title={attachment.filename}>
          {attachment.filename}
        </p>
        <p className="text-muted-foreground text-[10px]">
          {isDownloading
            ? t('attachment.downloading')
            : formatFileSize(attachment.size, tCommon)}
        </p>
      </div>
      {isDownloading ? (
        <div className="text-muted-foreground flex size-6 shrink-0 items-center justify-center">
          <Loader2 className="size-3.5 animate-spin" />
        </div>
      ) : hasUrl || onDownload ? (
        <button
          type="button"
          onClick={() => {
            if (attachment.url) {
              const a = document.createElement('a');
              a.href = attachment.url;
              a.download = attachment.filename;
              a.click();
            } else {
              onDownload?.();
            }
          }}
          className="text-muted-foreground hover:text-foreground flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-gray-100"
          aria-label={`${t('attachment.download')} ${attachment.filename}`}
        >
          <Download className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function Message({ message, onDownloadAttachments }: MessageProps) {
  const { formatDate } = useFormatDate();
  const { t } = useT('conversations');
  const [downloadingMessageId, setDownloadingMessageId] = useState<
    string | null
  >(null);

  // Track which attachment filenames had no URL when download was triggered
  const pendingDownloadFiles = useRef<Set<string>>(new Set());

  const handleDownload = useCallback(
    (messageId: string) => {
      if (!onDownloadAttachments || downloadingMessageId) return;
      // Record filenames that don't have URLs yet
      pendingDownloadFiles.current.clear();
      for (const att of message.attachments ?? []) {
        if (!att.url) {
          pendingDownloadFiles.current.add(att.filename);
        }
      }
      setDownloadingMessageId(messageId);
      onDownloadAttachments(messageId);
    },
    [onDownloadAttachments, downloadingMessageId, message.attachments],
  );

  // When URLs appear on previously-pending attachments, auto-trigger browser download
  useEffect(() => {
    if (!downloadingMessageId || pendingDownloadFiles.current.size === 0)
      return;

    const readyAttachments = (message.attachments ?? []).filter(
      (att) => att.url && pendingDownloadFiles.current.has(att.filename),
    );

    if (readyAttachments.length === 0) return;

    // All pending files now have URLs — trigger downloads and clear state
    for (const att of readyAttachments) {
      pendingDownloadFiles.current.delete(att.filename);
      if (att.url) {
        const a = document.createElement('a');
        a.href = att.url;
        a.download = att.filename;
        a.click();
      }
    }

    if (pendingDownloadFiles.current.size === 0) {
      setDownloadingMessageId(null);
    }
  }, [downloadingMessageId, message.attachments]);

  const isDownloading = downloadingMessageId === message.id;

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          'flex',
          message.isCustomer ? 'justify-start' : 'justify-end',
        )}
      >
        <div className="relative">
          <div
            className={cn(
              'max-w-[40rem] relative overflow-x-auto rounded-2xl shadow-sm mb-2',
              message.isCustomer
                ? 'bg-white text-foreground'
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
            <div className="text-xs leading-5">
              <EmailPreview html={message.content} />
            </div>
            {message.attachments && message.attachments.length > 0 && (
              <div className="flex flex-col gap-1.5 px-3 pb-3">
                <div className="text-muted-foreground flex items-center gap-1 text-[10px]">
                  <Paperclip className="size-3" />
                  <span>
                    {t('attachment.attachments', {
                      count: message.attachments.length,
                    })}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {message.attachments.map((att) => (
                    <AttachmentCard
                      key={att.id}
                      attachment={att}
                      isDownloading={isDownloading && !att.url}
                      onDownload={
                        !att.url && onDownloadAttachments
                          ? () => handleDownload(message.id)
                          : undefined
                      }
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
          <div
            className={cn(
              'text-xs flex items-center gap-1.5 justify-end text-nowrap',
              message.isCustomer
                ? 'text-muted-foreground text-left'
                : 'text-muted-foreground/70 text-right mb-4',
            )}
          >
            {formatDate(message.timestamp, 'time')}
            {!message.isCustomer && message.status && (
              <span className="inline-flex items-center">
                {getDeliveryIcon(message.status)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
