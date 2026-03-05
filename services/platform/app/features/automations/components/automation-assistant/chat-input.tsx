'use client';

import { LoaderCircle, Paperclip, Send, X } from 'lucide-react';

import type { Id } from '@/convex/_generated/dataModel';

import { PanelFooter } from '@/app/components/layout/panel-footer';
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { HStack, VStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { TEXT_FILE_ACCEPT } from '@/lib/utils/text-file-types';

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

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={TEXT_FILE_ACCEPT}
        onChange={onFileInputChange}
        style={{ display: 'none' }}
      />

      <PanelFooter className="mx-2">
        <FileUpload.DropZone
          className="border-muted rounded-t-3xl border-[0.5rem] border-b-0"
          onFilesSelected={uploadFiles}
          clickable={false}
        >
          <FileUpload.Overlay className="rounded-t-2xl" />
          <div className="bg-background border-muted-foreground/50 relative rounded-t-[0.875rem] border border-b-0 p-1">
            {(attachments.length > 0 || uploadingFiles.length > 0) && (
              <HStack gap={2} wrap className="p-1">
                {uploadingFiles.map((fileId) => (
                  <HStack
                    key={fileId}
                    gap={1}
                    className="bg-muted rounded-lg px-2 py-1"
                  >
                    <LoaderCircle className="size-3 animate-spin" />
                    <Text as="span" variant="caption">
                      {t('assistant.upload.uploading')}
                    </Text>
                  </HStack>
                ))}

                {attachments
                  .filter((att) => att.fileType.startsWith('image/'))
                  .map((attachment) => (
                    <div key={attachment.fileId} className="group relative">
                      <img
                        src={attachment.previewUrl}
                        alt={attachment.fileName}
                        className="border-border size-8 rounded-lg border object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeAttachment(attachment.fileId)}
                        className="bg-destructive text-destructive-foreground absolute -top-1 -right-1 rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}

                {attachments
                  .filter((att) => !att.fileType.startsWith('image/'))
                  .map((attachment) => (
                    <div
                      key={attachment.fileId}
                      className="group bg-secondary/20 relative flex max-w-[150px] items-center gap-2 rounded-lg px-2 py-1"
                    >
                      <DocumentIcon fileName={attachment.fileName} />
                      <VStack className="min-w-0 flex-1">
                        <Text as="div" variant="label-sm" truncate>
                          {attachment.fileName}
                        </Text>
                      </VStack>
                      <button
                        type="button"
                        onClick={() => removeAttachment(attachment.fileId)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
              </HStack>
            )}

            <div className="h-[5rem] overflow-y-auto transition-all duration-300 ease-in-out">
              <Textarea
                value={inputValue}
                onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                placeholder={t('assistant.messagePlaceholder')}
                className="resize-none border-0 bg-transparent p-2 text-sm outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                disabled={isLoading}
              />
            </div>
            <HStack justify="between" className="px-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                title={t('assistant.attachFiles')}
              >
                <Paperclip className="size-4" />
              </button>

              <Button
                onClick={onSend}
                disabled={
                  (!inputValue.trim() && attachments.length === 0) || isLoading
                }
                size="icon"
              >
                <Send className="size-4" />
              </Button>
            </HStack>
          </div>
        </FileUpload.DropZone>
      </PanelFooter>
    </>
  );
}
