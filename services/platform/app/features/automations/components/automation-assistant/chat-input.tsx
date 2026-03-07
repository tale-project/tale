'use client';

import { ArrowUp, LoaderCircle, Paperclip, X } from 'lucide-react';

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
}: ChatInputProps) {
  const { t } = useT('automations');
  const { t: tChat } = useT('chat');
  const { t: tDialogs } = useT('dialogs');

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
                      className="bg-secondary/20 focus:ring-ring size-full cursor-pointer transition-opacity hover:opacity-90 focus:ring-2 focus:ring-offset-2 focus:outline-none"
                    >
                      {attachment.previewUrl ? (
                        <img
                          src={attachment.previewUrl}
                          alt={attachment.fileName}
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center bg-linear-to-br from-blue-100 to-blue-200" />
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
                    <LoaderCircle className="size-4 animate-spin" />
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

              <Button
                onClick={onSend}
                disabled={
                  (!inputValue.trim() && attachments.length === 0) || isLoading
                }
                size="icon"
                aria-label={tChat('send')}
              >
                <ArrowUp className="size-4" />
              </Button>
            </HStack>
          </div>
        </div>
      </FileUpload.DropZone>
    </>
  );
}
