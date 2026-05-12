'use client';

import { Button } from '@tale/ui/button';
import { ArrowUp, Eye, Loader, Paperclip, X } from 'lucide-react';
import { useState } from 'react';

import { EnterKeyIcon } from '@/app/components/icons/enter-key-icon';
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { HStack, VStack } from '@/app/components/ui/layout/layout';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Text } from '@/app/components/ui/typography/text';
import { ImagePreviewDialog } from '@/app/features/chat/components/message-bubble';
import {
  formatFileSize,
  middleEllipsis,
} from '@/app/features/chat/components/message-bubble/file-displays';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { isAudioOrVideo } from '@/lib/shared/file-types';

interface ChatAttachment {
  fileId: Id<'_storage'>;
  fileName: string;
  fileType: string;
  fileSize: number;
  previewUrl?: string;
}

interface ChatInputProps {
  inputValue: string;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: React.ClipboardEvent) => void;
  onSend: () => void;
  isLoading: boolean;
  attachments: ChatAttachment[];
  uploadingFiles: string[];
  uploadFiles: (files: File[]) => void;
  removeAttachment: (fileId: Id<'_storage'>) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isIndexing?: boolean;
  indexingStatuses?: Map<
    Id<'_storage'>,
    { status?: string; error?: string; progress?: string }
  >;
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
}

export function ChatInput({
  inputValue,
  onInputChange,
  onKeyDown,
  onPaste,
  onSend,
  isLoading,
  attachments,
  uploadingFiles,
  uploadFiles,
  removeAttachment,
  fileInputRef,
  onFileInputChange,
  isIndexing = false,
  indexingStatuses,
  isTranscribing = false,
  transcriptionStatuses,
}: ChatInputProps) {
  const { t } = useT('automations');
  const { t: tChat } = useT('chat');
  const { t: tDialogs } = useT('dialogs');

  const [previewImage, setPreviewImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [previewTranscript, setPreviewTranscript] = useState<{
    fileName: string;
    transcript: string;
    durationSec?: number;
  } | null>(null);

  const imageAttachments = attachments.filter((att) =>
    att.fileType.startsWith('image/'),
  );
  const fileAttachments = attachments.filter(
    (att) => !att.fileType.startsWith('image/'),
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={onFileInputChange}
        style={{ display: 'none' }}
      />

      <FileUpload.DropZone
        className="relative flex min-h-0 shrink-0 flex-col"
        onFilesSelected={uploadFiles}
        clickable={false}
      >
        <FileUpload.Overlay className="mx-2 rounded-t-3xl" />

        <div className="bg-background border-border relative mx-2 mb-2 flex flex-col gap-2 rounded-2xl border px-5 pt-4">
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
                const audioInfo = isAudioOrVideo(attachment.fileType)
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
                        if (isAudioOrVideo(attachment.fileType)) {
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
            <Textarea
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              className="text-foreground placeholder:text-muted-foreground relative min-h-[100px] resize-none border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              disabled={isLoading}
              placeholder=""
              aria-label={t('assistant.messagePlaceholder')}
            />
            {inputValue.length === 0 && !isLoading && (
              <Text
                as="div"
                variant="muted"
                className="pointer-events-none absolute top-0 left-0 flex items-center gap-1"
              >
                {t('assistant.messagePlaceholder')}
                <div className="border-muted-foreground/30 text-muted-foreground flex size-4 items-center justify-center rounded border">
                  <EnterKeyIcon className="size-3" />
                </div>
                {tDialogs('toSend')}
              </Text>
            )}
          </div>

          <HStack justify="between" align="center" className="pb-3">
            <Tooltip content={tDialogs('attach')} side="top">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                aria-label={tDialogs('attach')}
              >
                <Paperclip className="size-4" />
              </Button>
            </Tooltip>

            <Tooltip
              content={
                isTranscribing && !isLoading
                  ? tChat('transcription.inProgressTooltip')
                  : ''
              }
              side="top"
            >
              <Button
                onClick={onSend}
                disabled={
                  (!inputValue.trim() && attachments.length === 0) ||
                  isLoading ||
                  uploadingFiles.length > 0 ||
                  isIndexing ||
                  isTranscribing
                }
                size="icon"
                className="rounded-full"
                aria-label={tChat('send')}
              >
                <ArrowUp className="size-4" />
              </Button>
            </Tooltip>
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
    </>
  );
}
