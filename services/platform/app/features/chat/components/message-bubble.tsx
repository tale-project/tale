'use client';

import { CopyIcon, CheckIcon, Info, Square } from 'lucide-react';
import {
  ComponentPropsWithoutRef,
  useRef,
  useState,
  useEffect,
  useMemo,
  useCallback,
  memo,
} from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { Message } from './message-bubble/types';

import { useMessageMetadata, useFileUrls } from '../hooks/queries';
import {
  FileAttachmentDisplay,
  FilePartDisplay,
} from './message-bubble/file-displays';
import {
  ImagePreviewDialog,
  type GalleryImage,
} from './message-bubble/image-preview-dialog';
import { MessageInfoDialog } from './message-info-dialog';
import { StructuredMessage } from './structured-message/structured-message';

export { ImagePreviewDialog } from './message-bubble/image-preview-dialog';

interface MessageBubbleProps extends ComponentPropsWithoutRef<'div'> {
  message: Message;
  onSendFollowUp?: (message: string) => void;
}

function useMessageGallery(message: Message) {
  const imageAttachments = useMemo(
    () =>
      message.attachments?.filter((a) => a.fileType.startsWith('image/')) ?? [],
    [message.attachments],
  );

  const imageFileIds = useMemo(
    () => imageAttachments.filter((a) => !a.previewUrl).map((a) => a.fileId),
    [imageAttachments],
  );

  const { data: resolvedUrls } = useFileUrls(imageFileIds);

  const galleryImages = useMemo(() => {
    const images: GalleryImage[] = [];

    // FilePart images first (assistant-generated)
    if (message.fileParts) {
      for (const part of message.fileParts) {
        if (part.mediaType.startsWith('image/')) {
          images.push({
            src: part.url,
            alt: part.filename || 'Image',
          });
        }
      }
    }

    // Then attachment images (user-uploaded)
    for (const attachment of imageAttachments) {
      const url =
        attachment.previewUrl ||
        resolvedUrls?.find((r) => r.fileId === attachment.fileId)?.url;
      if (url) {
        images.push({ src: url, alt: attachment.fileName });
      }
    }

    return images;
  }, [message.fileParts, imageAttachments, resolvedUrls]);

  return galleryImages;
}

function MessageBubbleComponent({
  message,
  className,
  onSendFollowUp,
  ...restProps
}: MessageBubbleProps) {
  const { t } = useT('common');
  const { t: tChat } = useT('chat');
  const isUser = message.role === 'user';
  const isAssistantStreaming =
    message.role === 'assistant' && message.isStreaming;

  const sanitizedContent = message.content
    ? message.content.replace(/\|\|+/g, '|')
    : '';

  const [isCopied, setIsCopied] = useState(false);
  const [isInfoDialogOpen, setIsInfoDialogOpen] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { metadata } = useMessageMetadata(message.id);
  const galleryImages = useMessageGallery(message);

  // Map each filePart/attachment to its gallery index (-1 for non-images)
  const { filePartGalleryIndices, attachmentGalleryIndices } = useMemo(() => {
    let idx = 0;
    const fpIndices =
      message.fileParts?.map((p) =>
        p.mediaType.startsWith('image/') ? idx++ : -1,
      ) ?? [];
    const attIndices =
      message.attachments?.map((a) =>
        a.fileType.startsWith('image/') ? idx++ : -1,
      ) ?? [];
    return {
      filePartGalleryIndices: fpIndices,
      attachmentGalleryIndices: attIndices,
    };
  }, [message.fileParts, message.attachments]);

  const openGallery = useCallback((index: number) => {
    setGalleryIndex(index);
    setIsGalleryOpen(true);
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setIsCopied(true);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleInfoClick = () => {
    setIsInfoDialogOpen(true);
  };

  return (
    <div
      className={cn(
        `flex ${isUser ? 'justify-end' : 'justify-start'}`,
        className,
      )}
      {...restProps}
    >
      <div
        className={`rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-muted text-foreground max-w-xs lg:max-w-md'
            : 'text-foreground bg-background'
        }`}
      >
        {message.fileParts && message.fileParts.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {message.fileParts.map((part, i) => {
              const galleryIdx = filePartGalleryIndices[i];
              return (
                <FilePartDisplay
                  key={part.url}
                  filePart={part}
                  onImageClick={
                    galleryIdx >= 0 ? () => openGallery(galleryIdx) : undefined
                  }
                />
              );
            })}
          </div>
        )}

        {sanitizedContent ? (
          <div className="text-sm leading-5">
            <StructuredMessage
              text={sanitizedContent}
              isStreaming={!!isAssistantStreaming}
              onSendFollowUp={!isUser ? onSendFollowUp : undefined}
            />
          </div>
        ) : (
          message.isAborted && (
            <div className="text-muted-foreground flex items-center gap-1.5 text-sm italic">
              <Square className="size-3" />
              {tChat('generationStopped')}
            </div>
          )
        )}

        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.attachments.map((attachment, i) => {
              const galleryIdx = attachmentGalleryIndices[i];
              return (
                <FileAttachmentDisplay
                  key={attachment.fileId}
                  attachment={attachment}
                  onImageClick={
                    galleryIdx >= 0 ? () => openGallery(galleryIdx) : undefined
                  }
                />
              );
            })}
          </div>
        )}
        {!isUser && !isAssistantStreaming && (
          <div className="flex items-center pt-2">
            <Tooltip
              content={isCopied ? t('actions.copied') : t('actions.copy')}
              side="bottom"
            >
              <Button
                variant="ghost"
                size="icon"
                className="p-1"
                onClick={handleCopy}
              >
                {isCopied ? (
                  <CheckIcon className="text-success size-4" />
                ) : (
                  <CopyIcon className="size-4" />
                )}
              </Button>
            </Tooltip>
            <Tooltip content={t('actions.showInfo')} side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="p-1"
                onClick={handleInfoClick}
              >
                <Info className="size-4" />
              </Button>
            </Tooltip>
          </div>
        )}

        {galleryImages.length > 0 && (
          <ImagePreviewDialog
            isOpen={isGalleryOpen}
            onOpenChange={setIsGalleryOpen}
            src={galleryImages[0].src}
            alt={galleryImages[0].alt}
            images={galleryImages}
            activeIndex={galleryIndex}
            onActiveIndexChange={setGalleryIndex}
          />
        )}

        <MessageInfoDialog
          isOpen={isInfoDialogOpen}
          onOpenChange={setIsInfoDialogOpen}
          messageId={message.id}
          timestamp={message.timestamp}
          metadata={metadata}
        />
      </div>
    </div>
  );
}

export const MessageBubble = memo(
  MessageBubbleComponent,
  (prevProps, nextProps) => {
    return (
      prevProps.message.id === nextProps.message.id &&
      prevProps.message.content === nextProps.message.content &&
      prevProps.message.isStreaming === nextProps.message.isStreaming &&
      prevProps.message.isAborted === nextProps.message.isAborted &&
      prevProps.message.attachments === nextProps.message.attachments &&
      prevProps.message.fileParts === nextProps.message.fileParts &&
      prevProps.className === nextProps.className &&
      prevProps.onSendFollowUp === nextProps.onSendFollowUp
    );
  },
);
