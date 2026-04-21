'use client';

import { X, ArrowUp, CircleStop, Eye, Loader } from 'lucide-react';
import {
  ComponentPropsWithoutRef,
  useCallback,
  useId,
  useRef,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { EnterKeyIcon } from '@/app/components/icons/enter-key-icon';
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { HStack, VStack } from '@/app/components/ui/layout/layout';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useUploadPolicy } from '@/app/features/settings/governance/hooks/use-upload-policy';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { CHAT_UPLOAD_ACCEPT } from '@/lib/shared/file-types';
import { cn } from '@/lib/utils/cn';
import { formatFileSize, middleEllipsis } from '@/lib/utils/format/file';

import type { FileAttachment } from '../hooks/use-convex-file-upload';
import { AgentSelector } from './agent-selector';
import { useArenaModeOptional } from './arena/arena-mode-context';
import { ArenaModelSelector } from './arena/arena-model-selector';
import { ComposerModeMenu } from './composer-mode-menu';
import { DictationButton } from './dictation-button';
import { ImagePreviewDialog } from './message-bubble';
import { ModelSelector } from './model-selector';
import { SavePromptMenu } from './save-prompt-menu';

const LOCALE_TO_BCP47: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  'de-AT': 'de-AT',
  'de-CH': 'de-CH',
};

interface ChatInputProps extends Omit<
  ComponentPropsWithoutRef<'div'>,
  'onChange'
> {
  onSendMessage: (message: string, attachments?: FileAttachment[]) => void;
  onStopGenerating?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  disabledReason?: 'no-agents' | 'pending-approval' | 'archived';
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  organizationId: string;
  attachments: FileAttachment[];
  uploadingFiles: string[];
  uploadFiles: (files: File[]) => Promise<void>;
  removeAttachment: (fileId: Id<'_storage'>) => void;
  clearAttachments: () => FileAttachment[];
  fileUploadDisabled?: boolean;
  isIndexing?: boolean;
  indexingStatuses?: Map<
    Id<'_storage'>,
    { status?: string; error?: string; progress?: string }
  >;
  /** True while any audio attachment is still `queued` or `running`, or the
   * transcription-status query is still resolving. Blocks send so the LLM
   * never sees a "pending" transcript. */
  isTranscribing?: boolean;
  transcriptionStatuses?: Map<
    Id<'_storage'>,
    {
      status?: 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
      error?: string;
      progress?: string;
      transcript?: string;
      durationSec?: number;
      ragStatus?: 'queued' | 'running' | 'completed' | 'failed';
      ragError?: string;
    }
  >;
  onSavePrompt?: (content: string) => void;
  onOpenPromptLibrary?: () => void;
  /**
   * When true, the send button is disabled. Unlike `disabled`, the input
   * itself stays editable so the user can still revise their message — they
   * just can't send it in the current state (e.g. an edit reference is
   * attached but the selected model doesn't support editing). Pair with a
   * visible reason (e.g. the EditingBanner) so it isn't mysterious.
   */
  sendBlocked?: boolean;
  /** Tooltip shown on the send button when `sendBlocked` is true. */
  sendBlockedReason?: string;
}

export function ChatInput({
  value = '',
  onChange,
  onSendMessage,
  onStopGenerating,
  isLoading = false,
  disabled = false,
  disabledReason,
  placeholder,
  organizationId,
  attachments,
  uploadingFiles,
  uploadFiles,
  removeAttachment,
  clearAttachments,
  fileUploadDisabled = false,
  isIndexing = false,
  indexingStatuses,
  isTranscribing = false,
  transcriptionStatuses,
  onSavePrompt,
  onOpenPromptLibrary,
  sendBlocked = false,
  sendBlockedReason,
  ...restProps
}: ChatInputProps) {
  const { t: tChat } = useT('chat');
  const { t: tDialogs } = useT('dialogs');
  const { i18n } = useTranslation();
  const arenaContext = useArenaModeOptional();
  const isArenaMode = arenaContext?.isArenaMode ?? false;

  const speechLang = LOCALE_TO_BCP47[i18n.language] ?? 'en-US';
  const policyLimits = useUploadPolicy(organizationId);
  const effectiveAccept = useMemo(() => {
    if (
      !policyLimits.policyEnabled ||
      policyLimits.allowedExtensions.length === 0
    ) {
      return CHAT_UPLOAD_ACCEPT;
    }
    return policyLimits.allowedExtensions.map((ext) => `.${ext}`).join(',');
  }, [policyLimits]);

  const textareaId = useId();
  const textareaLabelId = `${textareaId}-label`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewImage, setPreviewImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [previewTranscript, setPreviewTranscript] = useState<{
    fileName: string;
    transcript: string;
    durationSec?: number;
  } | null>(null);
  const defaultPlaceholder = placeholder || tChat('typeMessageHere');

  const isUploading = uploadingFiles.length > 0;
  const inputDisabled = disabled || isLoading;

  const handleSendMessage = () => {
    if (
      (!value.trim() && attachments.length === 0) ||
      isLoading ||
      disabled ||
      isUploading ||
      isIndexing ||
      isTranscribing ||
      sendBlocked
    )
      return;

    const attachmentsToSend =
      attachments.length > 0 ? clearAttachments() : undefined;

    onSendMessage(value.trim(), attachmentsToSend);
  };

  const imageAttachments = useMemo(
    () => attachments.filter((att) => att.fileType.startsWith('image/')),
    [attachments],
  );

  const fileAttachments = useMemo(
    () => attachments.filter((att) => !att.fileType.startsWith('image/')),
    [attachments],
  );

  const handleInputChange = (newValue: string) => {
    onChange?.(newValue);
  };

  const handleTranscript = useCallback(
    (transcript: string) => {
      const separator = value.length > 0 && !value.endsWith(' ') ? ' ' : '';
      onChange?.(value + separator + transcript);
    },
    [value, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (inputDisabled || fileUploadDisabled) return;
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const extension = item.type.split('/')[1] || 'png';
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const renamedFile = new File(
            [file],
            `pasted-image-${timestamp}.${extension}`,
            { type: file.type },
          );
          imageFiles.push(renamedFile);
        }
      }
    }

    if (imageFiles.length > 0) {
      void uploadFiles(imageFiles);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      void uploadFiles(Array.from(files));
    }
    e.target.value = '';
  };

  return (
    <div {...restProps} className={cn('bg-background', restProps.className)}>
      <FileUpload.DropZone
        className="relative flex h-full min-h-0 flex-1 flex-col"
        onFilesSelected={uploadFiles}
        clickable={false}
        disabled={inputDisabled || fileUploadDisabled}
      >
        <FileUpload.Overlay className="mx-2 rounded-t-3xl" />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={effectiveAccept}
          onChange={handleFileInputChange}
          style={{ display: 'none' }}
        />

        <div className="bg-background border-muted-foreground/50 relative mb-3 flex flex-col gap-2 rounded-2xl border px-5 pt-4">
          {(attachments.length > 0 || uploadingFiles.length > 0) && (
            <HStack gap={1} wrap className="mb-2">
              {imageAttachments.map((attachment) => (
                <div
                  key={attachment.fileId}
                  className="ring-border group relative size-9 overflow-hidden rounded-lg ring-1"
                >
                  <button
                    type="button"
                    aria-label={tChat('viewImage')}
                    onClick={() =>
                      attachment.previewUrl &&
                      setPreviewImage({
                        src: attachment.previewUrl,
                        alt: attachment.fileName,
                      })
                    }
                    className="bg-muted focus:ring-ring size-full cursor-pointer transition-opacity hover:opacity-90 focus:ring-2 focus:ring-offset-2 focus:outline-none"
                  >
                    {attachment.previewUrl ? (
                      <img
                        src={attachment.previewUrl}
                        alt={attachment.fileName}
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center bg-gradient-to-br from-blue-100 to-blue-200">
                        <span className="text-xs text-blue-600">
                          {tChat('fileTypes.image')}
                        </span>
                      </div>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={tChat('removeAttachment')}
                    onClick={() => removeAttachment(attachment.fileId)}
                    className="bg-background absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <X className="text-muted-foreground size-3" />
                  </button>
                </div>
              ))}

              {fileAttachments.map((attachment) => {
                const audioInfo = attachment.fileType.startsWith('audio/')
                  ? transcriptionStatuses?.get(attachment.fileId)
                  : undefined;
                const canPreviewTranscript =
                  audioInfo?.status === 'completed' && !!audioInfo.transcript;

                return (
                  <div
                    key={attachment.fileId}
                    className="bg-muted group relative flex max-w-[280px] items-center gap-3 rounded-lg px-3 py-2"
                  >
                    <DocumentIcon fileName={attachment.fileName} />
                    <VStack className="min-w-0 flex-1 gap-1">
                      <Text
                        as="div"
                        variant="label"
                        title={attachment.fileName}
                      >
                        {middleEllipsis(attachment.fileName, 28)}
                      </Text>
                      {(() => {
                        // Audio attachments: show two-phase status
                        // (transcribing → indexing → indexed) instead of the
                        // RAG-indexing status we show for other uploads.
                        if (attachment.fileType.startsWith('audio/')) {
                          const info = transcriptionStatuses?.get(
                            attachment.fileId,
                          );
                          const status = info?.status;
                          const ragStatus = info?.ragStatus;
                          if (status === 'queued' || status === 'running') {
                            return (
                              <HStack gap={1} align="center">
                                <Loader className="text-muted-foreground/50 size-3 animate-spin" />
                                <Text
                                  as="span"
                                  variant="caption"
                                  className="text-muted-foreground/50"
                                >
                                  {info?.progress ||
                                    tChat('transcription.transcribing')}
                                </Text>
                              </HStack>
                            );
                          }
                          if (
                            status === 'completed' &&
                            (ragStatus === 'queued' || ragStatus === 'running')
                          ) {
                            return (
                              <HStack gap={1} align="center">
                                <Loader className="text-muted-foreground/50 size-3 animate-spin" />
                                <Text
                                  as="span"
                                  variant="caption"
                                  className="text-muted-foreground/50"
                                >
                                  {tChat('transcription.indexing')}
                                </Text>
                              </HStack>
                            );
                          }
                          if (status === 'completed') {
                            // `ragStatus` completed → "Indexed" (agent can
                            // retrieve). `ragStatus === 'failed'` → show
                            // "Transcribed" but warn the agent retrieval
                            // will be unavailable.
                            const label =
                              ragStatus === 'completed'
                                ? tChat('transcription.indexed')
                                : ragStatus === 'failed'
                                  ? tChat('transcription.indexingFailed')
                                  : tChat('transcription.transcribed');
                            return (
                              <Text
                                as="span"
                                variant="caption"
                                className={
                                  ragStatus === 'failed'
                                    ? 'text-destructive'
                                    : 'text-muted-foreground/70'
                                }
                              >
                                {label}
                              </Text>
                            );
                          }
                          if (status === 'failed' || status === 'skipped') {
                            return (
                              <Text
                                as="span"
                                variant="caption"
                                className="text-destructive"
                              >
                                {tChat('transcription.couldNotTranscribe')}
                              </Text>
                            );
                          }
                          return (
                            <Text
                              as="div"
                              variant="caption"
                              className="text-muted-foreground/50"
                            >
                              {formatFileSize(attachment.fileSize)}
                            </Text>
                          );
                        }

                        const info = indexingStatuses?.get(attachment.fileId);
                        const ragStatus = info?.status;
                        if (ragStatus === 'queued' || ragStatus === 'running') {
                          const raw = info?.progress;
                          // Convert "extracting 42/108" → "39%"
                          let progressLabel = tChat('indexing');
                          if (raw) {
                            const match = /(\d+)\/(\d+)/.exec(raw);
                            if (match) {
                              const pct = Math.round(
                                (Number(match[1]) / Number(match[2])) * 100,
                              );
                              progressLabel = `${pct}%`;
                            } else {
                              progressLabel = raw;
                            }
                          }
                          return (
                            <HStack gap={1} align="center">
                              <Loader className="text-muted-foreground/50 size-3 animate-spin" />
                              <Text
                                as="span"
                                variant="caption"
                                className="text-muted-foreground/50"
                              >
                                {progressLabel}
                              </Text>
                            </HStack>
                          );
                        }
                        if (ragStatus === 'failed') {
                          return (
                            <Text
                              as="span"
                              variant="caption"
                              className="text-destructive"
                            >
                              {tChat('indexingFailed')}
                            </Text>
                          );
                        }
                        return (
                          <Text
                            as="div"
                            variant="caption"
                            className="text-muted-foreground/50"
                          >
                            {formatFileSize(attachment.fileSize)}
                          </Text>
                        );
                      })()}
                    </VStack>
                    <button
                      type="button"
                      aria-label={tChat('removeAttachment')}
                      onClick={() => removeAttachment(attachment.fileId)}
                      className="bg-background absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <X className="text-muted-foreground size-3" />
                    </button>
                    {canPreviewTranscript && (
                      <button
                        type="button"
                        aria-label={tChat('transcription.viewTranscript')}
                        title={tChat('transcription.viewTranscript')}
                        onClick={() =>
                          setPreviewTranscript({
                            fileName: attachment.fileName,
                            transcript: audioInfo?.transcript ?? '',
                            durationSec: audioInfo?.durationSec,
                          })
                        }
                        className="bg-background text-muted-foreground hover:text-foreground absolute right-0.5 bottom-0.5 flex size-5 items-center justify-center rounded-full transition-colors"
                      >
                        <Eye className="size-3" />
                      </button>
                    )}
                  </div>
                );
              })}

              {uploadingFiles.map((fileId) => (
                <div
                  key={fileId}
                  role="status"
                  aria-label={tChat('uploadingFile')}
                  className="border-border bg-muted flex size-9 items-center justify-center overflow-hidden rounded-lg border"
                >
                  <Loader className="text-muted-foreground size-4 animate-spin" />
                </div>
              ))}
            </HStack>
          )}

          <div className="relative">
            <label
              id={textareaLabelId}
              htmlFor={textareaId}
              className="sr-only"
            >
              {tChat('aria.chatInput')}
            </label>
            <Textarea
              id={textareaId}
              ref={textareaRef}
              value={value}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              className="text-foreground placeholder:text-muted-foreground relative min-h-[100px] resize-none border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              disabled={inputDisabled}
              placeholder=""
              aria-labelledby={textareaLabelId}
            />
            {value.length === 0 && !inputDisabled && (
              <Text
                as="div"
                variant="muted"
                className="pointer-events-none absolute top-0 left-0 flex items-center gap-1"
              >
                {defaultPlaceholder}
                <div className="border-muted-foreground/30 text-muted-foreground flex size-4 items-center justify-center rounded border">
                  <EnterKeyIcon className="size-3" />
                </div>
                {tDialogs('toSend')}
              </Text>
            )}
            {disabled && (
              <Text
                as="div"
                variant="muted"
                className="pointer-events-none absolute top-0 left-0"
              >
                {disabledReason === 'archived'
                  ? tChat('archivedDisabled')
                  : disabledReason === 'pending-approval'
                    ? tChat('pendingApprovalDisabled')
                    : tChat('noAgentsAvailable')}
              </Text>
            )}
          </div>

          <HStack justify="between" align="center" className="flex-1 pb-3">
            <HStack gap={1} align="center">
              <ComposerModeMenu
                organizationId={organizationId}
                onAttachFile={() => fileInputRef.current?.click()}
                fileUploadDisabled={fileUploadDisabled}
                disabled={inputDisabled}
              />
              {onSavePrompt && onOpenPromptLibrary && (
                <SavePromptMenu
                  onSavePromptDraft={() => onSavePrompt(value)}
                  onOpenPromptLibrary={onOpenPromptLibrary}
                  canSavePromptDraft={!inputDisabled && value.trim().length > 0}
                  disabled={inputDisabled}
                />
              )}
              {isArenaMode ? (
                <ArenaModelSelector organizationId={organizationId} />
              ) : (
                <HStack className="px-2" gap={3} align="center">
                  <AgentSelector organizationId={organizationId} />
                  <ModelSelector organizationId={organizationId} />
                </HStack>
              )}
            </HStack>
            <HStack gap={1} align="center">
              <DictationButton
                disabled={inputDisabled}
                lang={speechLang}
                onTranscript={handleTranscript}
              />
              <Tooltip
                content={
                  isTranscribing && !isLoading
                    ? tChat('transcription.inProgressTooltip')
                    : sendBlocked && sendBlockedReason && !isLoading
                      ? sendBlockedReason
                      : ''
                }
                side="top"
              >
                <Button
                  type="button"
                  onClick={isLoading ? onStopGenerating : handleSendMessage}
                  disabled={
                    isLoading
                      ? !onStopGenerating
                      : (!value.trim() && attachments.length === 0) ||
                        inputDisabled ||
                        isUploading ||
                        isIndexing ||
                        isTranscribing ||
                        sendBlocked
                  }
                  size="icon"
                  className="rounded-full"
                  aria-label={
                    isLoading ? tChat('stopGenerating') : tChat('send')
                  }
                >
                  {isLoading ? (
                    <CircleStop className="size-4" />
                  ) : (
                    <ArrowUp className="size-4" />
                  )}
                </Button>
              </Tooltip>
            </HStack>
          </HStack>
        </div>
      </FileUpload.DropZone>

      {previewImage && (
        <ImagePreviewDialog
          isOpen={!!previewImage}
          onOpenChange={(open) => !open && setPreviewImage(null)}
          src={previewImage.src}
          alt={previewImage.alt}
        />
      )}

      {previewTranscript && (
        <ViewDialog
          open={!!previewTranscript}
          onOpenChange={(open) => !open && setPreviewTranscript(null)}
          title={previewTranscript.fileName}
          description={
            previewTranscript.durationSec
              ? tChat('transcription.previewSubtitle', {
                  seconds: Math.round(previewTranscript.durationSec),
                })
              : undefined
          }
          size="lg"
        >
          <Text
            as="div"
            variant="body"
            className="max-h-[60vh] overflow-y-auto leading-relaxed whitespace-pre-wrap"
          >
            {previewTranscript.transcript}
          </Text>
        </ViewDialog>
      )}
    </div>
  );
}
