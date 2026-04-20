'use client';

import {
  CopyIcon,
  CheckIcon,
  GitFork,
  Info,
  Pencil,
  Bookmark,
  BookmarkCheck,
  TriangleAlert,
  RotateCcw,
  Square,
} from 'lucide-react';
import {
  ComponentPropsWithoutRef,
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  memo,
} from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useChatLayout } from '../context/chat-layout-context';
import { CitationsContext } from '../context/citations-context';
import {
  useChatAgents,
  useMessageMetadata,
  useFileUrls,
} from '../hooks/queries';
import { useCitations } from '../hooks/use-citations';
import { useEffectiveAgent } from '../hooks/use-effective-agent';
import { injectCitationTags } from '../utils/inject-citation-tags';
import { sanitizeChatError } from '../utils/sanitize-chat-error';
import {
  FileAttachmentDisplay,
  FilePartDisplay,
} from './message-bubble/file-displays';
import {
  ImagePreviewDialog,
  type GalleryImage,
} from './message-bubble/image-preview-dialog';
import { MessageContentContext } from './message-bubble/message-content-context';
import type { Message } from './message-bubble/types';
import { MessageFeedback } from './message-feedback';
import { MessageInfoDialog } from './message-info-dialog';
import { SourceCards } from './source-cards';
import { StructuredMessage } from './structured-message/structured-message';

export { ImagePreviewDialog } from './message-bubble/image-preview-dialog';

interface MessageBubbleProps extends ComponentPropsWithoutRef<'div'> {
  message: Message;
  organizationId?: string;
  hideFeedback?: boolean;
  onSendFollowUp?: (message: string) => void;
  onRetry?: () => void;
  onEdit?: (messageId: string, content: string) => void;
  onFork?: (messageId: string) => void;
  onSavePrompt?: (messageId: string, content: string) => void;
  onUnsavePrompt?: (messageId: string) => void;
  isSavedPrompt?: boolean;
  /** Extra content rendered in the user message toolbar (e.g. BranchNavigator). */
  toolbarExtra?: React.ReactNode;
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
        resolvedUrls?.find(
          (r: { fileId: string; url: string | null }) =>
            r.fileId === attachment.fileId,
        )?.url;
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
  organizationId,
  hideFeedback,
  onSendFollowUp,
  onRetry,
  onEdit,
  onFork,
  onSavePrompt,
  onUnsavePrompt,
  isSavedPrompt,
  toolbarExtra,
  ...restProps
}: MessageBubbleProps) {
  const { t } = useT('common');
  const { t: tChat } = useT('chat');
  const isUser = message.role === 'user';
  const isAssistantStreaming =
    message.role === 'assistant' && message.isStreaming;

  const handleEditClick = useCallback(() => {
    if (onEdit) onEdit(message.id, message.content);
  }, [onEdit, message.id, message.content]);

  const handleForkClick = useCallback(() => {
    if (onFork) onFork(message.id);
  }, [onFork, message.id]);

  const [unsaveConfirmOpen, setUnsaveConfirmOpen] = useState(false);

  const handleBookmarkClick = useCallback(() => {
    if (isSavedPrompt) {
      setUnsaveConfirmOpen(true);
    } else if (onSavePrompt) {
      onSavePrompt(message.id, message.content);
    }
  }, [isSavedPrompt, onSavePrompt, message.id, message.content]);

  const handleConfirmUnsave = useCallback(() => {
    if (onUnsavePrompt) onUnsavePrompt(message.id);
    setUnsaveConfirmOpen(false);
  }, [onUnsavePrompt, message.id]);

  const [isCopied, setIsCopied] = useState(false);
  const [isInfoDialogOpen, setIsInfoDialogOpen] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { metadata } = useMessageMetadata(message.id, message.threadId);
  const { citations, hasCitations } = useCitations(metadata?.citations);

  // Image-generation agents show a ↻ Edit button on assistant image parts.
  const { agent: effectiveAgentForEdit } = useEffectiveAgent(
    organizationId ?? '',
  );
  const { agents: agentsForEdit } = useChatAgents(organizationId ?? '');
  const isImageGenAgent =
    agentsForEdit?.find((a) => a.name === effectiveAgentForEdit?.name)
      ?.primaryBehavior === 'image-generation';
  const { setEditingImageRef, setDismissedImageKey } = useChatLayout();
  const handleEditImagePart = useCallback(
    (part: { url: string; mediaType: string; filename?: string }) => {
      let fileId = '';
      try {
        fileId = new URL(part.url).searchParams.get('id') ?? '';
      } catch {
        // Non-storage URL (e.g. data URL); edit reference won't resolve server-side
      }
      setEditingImageRef({
        fileId,
        url: part.url,
        mimeType: part.mediaType,
        fileName: part.filename,
      });
      setDismissedImageKey(null);
    },
    [setEditingImageRef, setDismissedImageKey],
  );
  const citationNumbers = useMemo(() => new Set(citations.keys()), [citations]);
  const citationsContextValue = useMemo(() => ({ citations }), [citations]);
  const messageContentContextValue = useMemo(
    () => ({
      messageId: message.id,
      messageContent: message.content,
      threadId: message.threadId,
    }),
    [message.id, message.content, message.threadId],
  );
  const galleryImages = useMessageGallery(message);

  const displayContent = message.content ?? '';
  // Only normalize pipes for assistant messages (markdown table rendering);
  // user messages must be rendered verbatim to preserve content integrity.
  const normalizedContent = displayContent.replace(/\|\|+/g, '|');
  // Inject citation tags for known citation numbers so [N] renders as interactive components
  const assistantContent = useMemo(
    () => injectCitationTags(normalizedContent, citationNumbers),
    [normalizedContent, citationNumbers],
  );

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

  // Synchronous initial overflow check — runs before paint so the "Show More"
  // button is included in the first layout commit (no two-frame cascade).
  useLayoutEffect(() => {
    if (!isUser || !contentRef.current || isExpanded) return;
    setIsOverflowing(
      contentRef.current.scrollHeight > contentRef.current.clientHeight,
    );
  }, [isUser, isExpanded, displayContent]);

  // Debounced ResizeObserver for subsequent resize events (e.g. window resize).
  useEffect(() => {
    if (!isUser || !contentRef.current || isExpanded) return undefined;
    const el = contentRef.current;
    let frameId: number;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        setIsOverflowing(el.scrollHeight > el.clientHeight);
      });
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [isUser, isExpanded, displayContent]);

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
        isUser ? 'flex flex-col items-end' : 'flex justify-start',
        className,
      )}
      {...restProps}
    >
      <div
        className={cn(
          'rounded-2xl',
          isUser
            ? 'bg-muted text-foreground max-w-xs lg:max-w-md'
            : 'text-foreground bg-background min-w-0',
          (displayContent || message.isAborted) && 'px-4 py-3',
        )}
      >
        {displayContent ? (
          <div className="text-sm leading-5">
            <div
              ref={isUser ? contentRef : undefined}
              className={cn(
                isUser && !isExpanded && 'max-h-96 overflow-hidden',
              )}
            >
              {isUser ? (
                <p className="break-words whitespace-pre-wrap">
                  {displayContent}
                </p>
              ) : (
                <MessageContentContext.Provider
                  value={messageContentContextValue}
                >
                  <CitationsContext.Provider value={citationsContextValue}>
                    <StructuredMessage
                      text={assistantContent}
                      isStreaming={!!isAssistantStreaming}
                      onSendFollowUp={onSendFollowUp}
                    />
                  </CitationsContext.Provider>
                </MessageContentContext.Provider>
              )}
            </div>
            {isUser && (isOverflowing || isExpanded) && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setIsExpanded((v) => !v)}
                  className="text-muted-foreground hover:text-foreground mt-1 text-xs"
                >
                  {isExpanded ? tChat('showLess') : tChat('showMore')}
                </button>
              </div>
            )}
            {message.isFailed && (
              <div
                className="mt-3 flex flex-col gap-2"
                role="alert"
                aria-live="polite"
              >
                <div className="text-destructive flex items-center gap-2">
                  <TriangleAlert className="size-4 shrink-0" />
                  <span className="text-sm font-medium">
                    {tChat('errorGenerating')}
                  </span>
                </div>
                {(() => {
                  const sanitized = sanitizeChatError(message.error);
                  return (
                    <>
                      <p className="text-muted-foreground text-[13px]">
                        {tChat(sanitized.i18nKey)}
                      </p>
                      {sanitized.rawMessage && (
                        <p className="text-muted-foreground text-xs break-all whitespace-pre-wrap opacity-70">
                          {sanitized.rawMessage}
                        </p>
                      )}
                    </>
                  );
                })()}
                {onRetry && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="text-foreground w-fit gap-1.5 rounded-lg border-[#E5E7EB] bg-transparent px-3 py-1.5 text-[13px] font-medium"
                    onClick={onRetry}
                  >
                    <RotateCcw className="size-3.5" />
                    {tChat('retryGeneration')}
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
          message.isAborted &&
          (message.error ? (
            <div
              className="mt-3 flex flex-col gap-2"
              role="alert"
              aria-live="polite"
            >
              <div className="text-destructive flex items-center gap-2">
                <TriangleAlert className="size-4 shrink-0" />
                <span className="text-sm font-medium">
                  {tChat('errorGenerating')}
                </span>
              </div>
              {(() => {
                const sanitized = sanitizeChatError(message.error);
                return (
                  <>
                    <p className="text-muted-foreground text-[13px]">
                      {tChat(sanitized.i18nKey)}
                    </p>
                    {sanitized.rawMessage && (
                      <p className="text-muted-foreground text-xs break-all whitespace-pre-wrap opacity-70">
                        {sanitized.rawMessage}
                      </p>
                    )}
                  </>
                );
              })()}
              {onRetry && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-foreground w-fit gap-1.5 rounded-lg border-[#E5E7EB] bg-transparent px-3 py-1.5 text-[13px] font-medium"
                  onClick={onRetry}
                >
                  <RotateCcw className="size-3.5" />
                  {tChat('retryGeneration')}
                </Button>
              )}
            </div>
          ) : (
            <div className="text-muted-foreground flex items-center gap-1.5 text-sm italic">
              <Square className="size-3" />
              {tChat('generationStopped')}
            </div>
          ))
        )}

        {message.fileParts && message.fileParts.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {message.fileParts.map((part, i) => {
              const galleryIdx = filePartGalleryIndices[i];
              const isAssistantImage =
                message.role === 'assistant' &&
                part.mediaType.startsWith('image/');
              return (
                <FilePartDisplay
                  key={part.url}
                  filePart={part}
                  organizationId={organizationId}
                  onImageClick={
                    galleryIdx >= 0 ? () => openGallery(galleryIdx) : undefined
                  }
                  onEditImage={
                    isImageGenAgent && isAssistantImage
                      ? () => handleEditImagePart(part)
                      : undefined
                  }
                />
              );
            })}
          </div>
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
        {!isUser &&
          !isAssistantStreaming &&
          (!!displayContent ||
            (message.fileParts && message.fileParts.length > 0)) &&
          (!hideFeedback && organizationId && message.threadId ? (
            <MessageFeedback
              messageId={message.id}
              threadId={message.threadId}
              organizationId={organizationId}
              before={
                <>
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
                </>
              }
              after={
                onFork ? (
                  <Tooltip content={tChat('forkChat')} side="bottom">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="p-1"
                      onClick={handleForkClick}
                    >
                      <GitFork className="size-4" />
                    </Button>
                  </Tooltip>
                ) : undefined
              }
            />
          ) : (
            <div className="flex items-start gap-1 pt-2">
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
              {onFork && (
                <Tooltip content={tChat('forkChat')} side="bottom">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="p-1"
                    onClick={handleForkClick}
                  >
                    <GitFork className="size-4" />
                  </Button>
                </Tooltip>
              )}
            </div>
          ))}

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

        {!isUser && hasCitations && !isAssistantStreaming && (
          <SourceCards citations={citations} organizationId={organizationId} />
        )}

        <MessageInfoDialog
          isOpen={isInfoDialogOpen}
          onOpenChange={setIsInfoDialogOpen}
          messageId={message.id}
          timestamp={message.timestamp}
          metadata={metadata}
        />
      </div>
      {isUser && (onEdit || onSavePrompt || toolbarExtra) && (
        <div className="flex items-center justify-end gap-0.5 pt-0.5">
          {(onSavePrompt || isSavedPrompt) && !!displayContent && (
            <Tooltip
              content={
                isSavedPrompt ? tChat('unsavePrompt') : tChat('savePrompt')
              }
              side="bottom"
            >
              <Button
                variant="ghost"
                size="icon"
                className="size-6 p-1"
                onClick={handleBookmarkClick}
              >
                {isSavedPrompt ? (
                  <BookmarkCheck className="text-primary size-3.5" />
                ) : (
                  <Bookmark className="size-3.5" />
                )}
              </Button>
            </Tooltip>
          )}
          {onEdit && !!displayContent && (
            <Tooltip content={tChat('editMessage')} side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="size-6 p-1"
                onClick={handleEditClick}
              >
                <Pencil className="size-3.5" />
              </Button>
            </Tooltip>
          )}
          {toolbarExtra}
        </div>
      )}

      <ConfirmDialog
        open={unsaveConfirmOpen}
        onOpenChange={setUnsaveConfirmOpen}
        title={tChat('unsavePrompt')}
        description={tChat('unsavePromptConfirm')}
        confirmText={tChat('unsavePromptAction')}
        onConfirm={handleConfirmUnsave}
        variant="destructive"
      />
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
      prevProps.message.isFailed === nextProps.message.isFailed &&
      prevProps.message.attachments === nextProps.message.attachments &&
      prevProps.message.fileParts === nextProps.message.fileParts &&
      prevProps.message.threadId === nextProps.message.threadId &&
      prevProps.className === nextProps.className &&
      prevProps.organizationId === nextProps.organizationId &&
      prevProps.hideFeedback === nextProps.hideFeedback &&
      prevProps.onSendFollowUp === nextProps.onSendFollowUp &&
      prevProps.onRetry === nextProps.onRetry &&
      prevProps.onEdit === nextProps.onEdit &&
      prevProps.onFork === nextProps.onFork &&
      prevProps.isSavedPrompt === nextProps.isSavedPrompt &&
      prevProps.toolbarExtra === nextProps.toolbarExtra
    );
  },
);
