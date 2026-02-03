'use client';

import { Textarea } from '@/app/components/ui/forms/textarea';
import { ComponentPropsWithoutRef, useRef, useMemo, useState } from 'react';
import { X, Paperclip } from 'lucide-react';
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { EnterKeyIcon } from '@/app/components/icons/enter-key-icon';
import { LoaderCircleIcon } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import {
  useConvexFileUpload,
  type FileAttachment,
} from '../hooks/use-convex-file-upload';
import { ImagePreviewDialog } from './message-bubble';

interface ChatInputProps extends Omit<
  ComponentPropsWithoutRef<'div'>,
  'onChange'
> {
  onSendMessage: (message: string, attachments?: FileAttachment[]) => void;
  isLoading?: boolean;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
}

export function ChatInput({
  value = '',
  onChange,
  onSendMessage,
  isLoading = false,
  placeholder,
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

  const {
    attachments,
    uploadingFiles,
    uploadFiles,
    removeAttachment,
    clearAttachments,
  } = useConvexFileUpload();

  const defaultPlaceholder = placeholder || tChat('typeMessageHere');

  const handleSendMessage = () => {
    if ((!value.trim() && attachments.length === 0) || isLoading) return;

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
      uploadFiles(imageFiles);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      uploadFiles(Array.from(files));
    }
    e.target.value = '';
  };

  return (
    <div {...restProps} className={cn('bg-background', restProps.className)}>
      <FileUpload.DropZone
        className="relative flex flex-col h-full flex-1 min-h-0"
        onFilesSelected={uploadFiles}
        clickable={false}
      >
        <FileUpload.Overlay className="rounded-t-3xl mx-2" />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.txt,.ppt,.pptx"
          onChange={handleFileInputChange}
          style={{ display: 'none' }}
        />

        <div className="border-muted rounded-t-3xl border-[0.5rem] border-b-0 mx-2">
          <div className="flex relative flex-col gap-2 bg-background rounded-t-2xl pt-3 px-4 border border-muted-foreground/50 border-b-0">
            {(attachments.length > 0 || uploadingFiles.length > 0) && (
              <div className="flex flex-wrap gap-1 mb-2">
                {imageAttachments.map((attachment) => (
                  <div key={attachment.fileId} className="relative group">
                    <button
                      type="button"
                      onClick={() =>
                        attachment.previewUrl &&
                        setPreviewImage({
                          src: attachment.previewUrl,
                          alt: attachment.fileName,
                        })
                      }
                      className="size-11 rounded-lg bg-secondary/20 overflow-hidden cursor-pointer hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    >
                      {attachment.previewUrl ? (
                        <img
                          src={attachment.previewUrl}
                          alt={attachment.fileName}
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="size-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center">
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
                      className="absolute top-0.5 right-0.5 size-5 bg-background rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="size-3 text-muted-foreground" />
                    </button>
                  </div>
                ))}

                {fileAttachments.map((attachment) => (
                  <div
                    key={attachment.fileId}
                    className="relative group bg-secondary/20 rounded-lg px-2 py-1 flex items-center gap-2 max-w-[216px]"
                  >
                    <DocumentIcon fileName={attachment.fileName} />
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate ellipsis ">
                        {attachment.fileName}
                      </div>
                      <div className="text-xs text-muted-foreground/50">
                        {attachment.fileType === 'application/pdf'
                          ? tChat('fileTypes.pdf')
                          : attachment.fileType.includes('word')
                            ? tChat('fileTypes.doc')
                            : attachment.fileType.includes('presentation') ||
                                attachment.fileType.includes('powerpoint')
                              ? tChat('fileTypes.pptx')
                              : attachment.fileType === 'text/plain'
                                ? tChat('fileTypes.txt')
                                : tChat('fileTypes.file')}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={tChat('removeAttachment')}
                      onClick={() => removeAttachment(attachment.fileId)}
                      className="absolute top-0.5 right-0.5 size-5 bg-background rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="size-3 text-muted-foreground" />
                    </button>
                  </div>
                ))}

                {uploadingFiles.map((fileId) => (
                  <div
                    key={fileId}
                    className="bg-secondary/20 rounded-lg p-2 grid place-content-center size-[2.75rem]"
                  >
                    <LoaderCircleIcon className="size-4 animate-spin" />
                  </div>
                ))}
              </div>
            )}

            <div className="relative">
              <Textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                className="min-h-[100px] relative border-0 shadow-none resize-none focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground px-0 py-0 bg-transparent placeholder:text-muted-foreground"
                disabled={isLoading}
                placeholder=""
              />
              {value.length === 0 && (
                <div className="flex items-center gap-1 text-sm text-muted-foreground absolute top-0 left-0 pointer-events-none">
                  {defaultPlaceholder}
                  <div className="flex items-center justify-center size-4 rounded border border-muted-foreground/30 text-muted-foreground">
                    <EnterKeyIcon />
                  </div>
                  {tDialogs('toSend')}
                </div>
              )}
            </div>

            <div className="flex items-center pb-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={tDialogs('attach')}
              >
                <Paperclip className="size-4" />
                <span className="text-xs">{tDialogs('attach')}</span>
              </button>
            </div>
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
