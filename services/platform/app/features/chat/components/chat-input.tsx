'use client';

import { X, Paperclip, ArrowUp, CircleStop } from 'lucide-react';
import { LoaderCircleIcon } from 'lucide-react';
import { ComponentPropsWithoutRef, useRef, useMemo, useState } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { EnterKeyIcon } from '@/app/components/icons/enter-key-icon';
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { HStack, VStack } from '@/app/components/ui/layout/layout';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import {
  CHAT_UPLOAD_ACCEPT,
  getFileTypeLabelKey,
} from '@/lib/shared/file-types';
import { cn } from '@/lib/utils/cn';

import type { FileAttachment } from '../hooks/use-convex-file-upload';

import { AgentSelector } from './agent-selector';
import { ImagePreviewDialog } from './message-bubble';

interface ChatInputProps extends Omit<
  ComponentPropsWithoutRef<'div'>,
  'onChange'
> {
  onSendMessage: (message: string, attachments?: FileAttachment[]) => void;
  onStopGenerating?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  organizationId: string;
  attachments: FileAttachment[];
  uploadingFiles: string[];
  uploadFiles: (files: File[]) => Promise<void>;
  removeAttachment: (fileId: Id<'_storage'>) => void;
  clearAttachments: () => FileAttachment[];
}

export function ChatInput({
  value = '',
  onChange,
  onSendMessage,
  onStopGenerating,
  isLoading = false,
  disabled = false,
  placeholder,
  organizationId,
  attachments,
  uploadingFiles,
  uploadFiles,
  removeAttachment,
  clearAttachments,
  ...restProps
}: ChatInputProps) {
  const { t: tChat } = useT('chat');
  const { t: tDialogs } = useT('dialogs');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewImage, setPreviewImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  const defaultPlaceholder = placeholder || tChat('typeMessageHere');

  const inputDisabled = disabled || isLoading;

  const handleSendMessage = () => {
    if ((!value.trim() && attachments.length === 0) || isLoading || disabled)
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (inputDisabled) return;
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
      >
        <FileUpload.Overlay className="mx-2 rounded-t-3xl" />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={CHAT_UPLOAD_ACCEPT}
          onChange={handleFileInputChange}
          style={{ display: 'none' }}
        />

        <div className="border-muted mx-2 rounded-t-3xl border-[0.5rem] border-b-0">
          <div className="bg-background border-muted-foreground/50 relative flex flex-col gap-2 rounded-t-2xl border border-b-0 px-4 pt-3">
            {(attachments.length > 0 || uploadingFiles.length > 0) && (
              <HStack gap={1} wrap className="mb-2">
                {imageAttachments.map((attachment) => (
                  <div
                    key={attachment.fileId}
                    className="group relative size-11 overflow-hidden rounded-lg shadow-sm"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        attachment.previewUrl &&
                        setPreviewImage({
                          src: attachment.previewUrl,
                          alt: attachment.fileName,
                        })
                      }
                      className="bg-secondary/20 focus:ring-ring size-full cursor-pointer transition-opacity hover:opacity-90 focus:ring-2 focus:ring-offset-2 focus:outline-none"
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
                      className="bg-background absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <X className="text-muted-foreground size-3" />
                    </button>
                  </div>
                ))}

                {fileAttachments.map((attachment) => (
                  <div
                    key={attachment.fileId}
                    className="bg-secondary/20 group relative flex max-w-[216px] items-center gap-2 rounded-lg px-2 py-1"
                  >
                    <DocumentIcon fileName={attachment.fileName} />
                    <VStack className="min-w-0 flex-1">
                      <Text
                        as="div"
                        variant="label"
                        truncate
                        className="ellipsis"
                      >
                        {attachment.fileName}
                      </Text>
                      <Text
                        as="div"
                        variant="caption"
                        className="text-muted-foreground/50"
                      >
                        {tChat(
                          `fileTypes.${getFileTypeLabelKey(attachment.fileType)}`,
                        )}
                      </Text>
                    </VStack>
                    <button
                      type="button"
                      aria-label={tChat('removeAttachment')}
                      onClick={() => removeAttachment(attachment.fileId)}
                      className="bg-background absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <X className="text-muted-foreground size-3" />
                    </button>
                  </div>
                ))}

                {uploadingFiles.map((fileId) => (
                  <div
                    key={fileId}
                    className="bg-secondary/20 grid size-[2.75rem] place-content-center rounded-lg p-2"
                  >
                    <LoaderCircleIcon className="size-4 animate-spin" />
                  </div>
                ))}
              </HStack>
            )}

            <div className="relative">
              <Textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                className="text-foreground placeholder:text-muted-foreground relative min-h-[100px] resize-none border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                disabled={inputDisabled}
                placeholder=""
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
                  {tChat('noAgentsAvailable')}
                </Text>
              )}
            </div>

            <HStack justify="between" align="center" className="pb-3">
              <Tooltip content={tDialogs('attach')} side="top">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={inputDisabled}
                  aria-label={tDialogs('attach')}
                >
                  <Paperclip className="size-4" />
                </Button>
              </Tooltip>
              <HStack gap={2} align="center">
                <AgentSelector organizationId={organizationId} />
                <Button
                  type="button"
                  onClick={isLoading ? onStopGenerating : handleSendMessage}
                  disabled={
                    isLoading
                      ? !onStopGenerating
                      : (!value.trim() && attachments.length === 0) ||
                        inputDisabled
                  }
                  size="icon"
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
              </HStack>
            </HStack>
          </div>
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
    </div>
  );
}
