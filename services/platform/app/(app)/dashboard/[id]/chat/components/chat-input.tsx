'use client';

import { Textarea } from '@/components/ui/textarea';
import { ComponentPropsWithoutRef, useRef, useState, useMemo, useCallback } from 'react';
import { X, Paperclip } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useGenerateUploadUrl } from '../hooks/use-generate-upload-url';
import { Id } from '@/convex/_generated/dataModel';
import { DocumentIcon } from '@/components/ui/document-icon';
import { EnterKeyIcon } from '@/components/ui/icons';
import { LoaderCircleIcon } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { compressImage } from '@/lib/utils/compress-image';

interface FileAttachment {
  fileId: Id<'_storage'>;
  fileName: string;
  fileType: string;
  fileSize: number;
  previewUrl?: string; // For showing image previews before upload
}

interface ChatInputProps extends Omit<
  ComponentPropsWithoutRef<'div'>,
  'onChange'
> {
  onSendMessage: (message: string, attachments?: FileAttachment[]) => void;
  onAttachFiles?: () => void;
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
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);

  const defaultPlaceholder = placeholder || tChat('typeMessageHere');
  const generateUploadUrl = useGenerateUploadUrl();

  const handleSendMessage = () => {
    if ((!value.trim() && attachments.length === 0) || isLoading) return;

    // Store a copy of attachments before clearing (for passing to parent)
    // DON'T revoke preview URLs - they're needed for optimistic message display
    const attachmentsToSend = attachments.length > 0 ? [...attachments] : undefined;

    // Clear attachments state IMMEDIATELY (before async operations start)
    setAttachments([]);

    // Now send the message with the copied attachments
    onSendMessage(value.trim(), attachmentsToSend);
  };

  // File upload functions
  const uploadFiles = async (files: FileList) => {
    const fileArray = Array.from(files);
    const maxFileSize = 10 * 1024 * 1024; // 10MB limit
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    // Validate files
    const invalidFiles = fileArray.filter(
      (file) => file.size > maxFileSize || !allowedTypes.includes(file.type),
    );

    if (invalidFiles.length > 0) {
      toast({
        title: tChat('invalidFiles'),
        description: tChat('filesNotSupported'),
        variant: 'destructive',
      });
      return;
    }

    const uploadPromises = fileArray.map(async (file) => {
      const fileId = `${file.name}-${Date.now()}`;
      setUploadingFiles((prev) => [...prev, fileId]);

      try {
        // Compress images before upload to stay within server memory limits
        let fileToUpload = file;

        if (file.type.startsWith('image/')) {
          const compressionResult = await compressImage(file);
          fileToUpload = compressionResult.file;

          if (compressionResult.wasCompressed) {
            const savedKB = Math.round(
              (compressionResult.originalSize - compressionResult.finalSize) / 1024,
            );
            console.log(
              `[ChatInput] Compressed image: ${file.name} (${savedKB}KB saved)`,
            );
          }
        }

        // Get upload URL from Convex
        const uploadUrl = await generateUploadUrl();

        // Upload file to Convex storage
        const result = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': fileToUpload.type },
          body: fileToUpload,
        });

        if (!result.ok) {
          throw new Error(tChat('uploadFailed'));
        }

        const { storageId } = await result.json();

        // Create attachment object
        const attachment: FileAttachment = {
          fileId: storageId,
          fileName: fileToUpload.name,
          fileType: fileToUpload.type,
          fileSize: fileToUpload.size,
          previewUrl: fileToUpload.type.startsWith('image/')
            ? URL.createObjectURL(fileToUpload)
            : undefined,
        };

        setAttachments((prev) => [...prev, attachment]);

        toast({
          title: tChat('fileUploaded'),
          description: tChat('uploadedSuccessfully', { filename: file.name }),
        });
      } catch (error) {
        console.error('Upload error:', error);
        toast({
          title: tChat('uploadFailed'),
          description: tChat('failedToUpload', { filename: file.name }),
          variant: 'destructive',
        });
      } finally {
        setUploadingFiles((prev) => prev.filter((id) => id !== fileId));
      }
    });

    await Promise.all(uploadPromises);
  };

  const removeAttachment = useCallback((fileId: Id<'_storage'>) => {
    setAttachments((prev) => {
      const attachment = prev.find((att) => att.fileId === fileId);
      if (attachment?.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
      return prev.filter((att) => att.fileId !== fileId);
    });
  }, []);

  // Memoize filtered attachments to avoid recreating arrays on every render
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

  // Handle paste event for images
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          // Create a meaningful filename with timestamp
          const extension = item.type.split('/')[1] || 'png';
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const renamedFile = new File([file], `pasted-image-${timestamp}.${extension}`, {
            type: file.type,
          });
          imageFiles.push(renamedFile);
        }
      }
    }

    if (imageFiles.length > 0) {
      // Create a DataTransfer to get a FileList
      const dataTransfer = new DataTransfer();
      imageFiles.forEach((file) => dataTransfer.items.add(file));
      uploadFiles(dataTransfer.files);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      uploadFiles(files);
    }
    // Reset input to allow selecting the same file again
    e.target.value = '';
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      uploadFiles(files);
    }
  };

  return (
    <div {...restProps}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx,.txt"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      {/* Main input container */}
      <div className="border-muted rounded-t-3xl border-[0.5rem] border-b-0">
        <div
          className={`flex relative flex-col gap-2 bg-background rounded-t-2xl pt-3 px-4 border border-muted-foreground/50 border-b-0 ${
            isDragOver ? 'border-primary bg-primary/5' : ''
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* File attachments display */}
          {(attachments.length > 0 || uploadingFiles.length > 0) && (
            <div className="flex flex-wrap gap-1 mb-2">
              {/* Image attachments - small square thumbnails */}
              {imageAttachments.map((attachment) => (
                  <div key={attachment.fileId} className="relative group">
                    <div className="size-11 rounded-lg bg-secondary/20 overflow-hidden">
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
                    </div>
                    {/* Remove button - appears on hover */}
                    <button
                      onClick={() => removeAttachment(attachment.fileId)}
                      className="absolute top-0.5 right-0.5 size-5 bg-background rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="size-3 text-muted-foreground" />
                    </button>
                  </div>
                ))}

              {/* File attachments - horizontal cards */}
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
                            : attachment.fileType === 'text/plain'
                              ? tChat('fileTypes.txt')
                              : tChat('fileTypes.file')}
                      </div>
                    </div>
                    {/* Remove button - appears on hover */}
                    <button
                      onClick={() => removeAttachment(attachment.fileId)}
                      className="absolute top-0.5 right-0.5 size-5 bg-background rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="size-3 text-muted-foreground" />
                    </button>
                  </div>
                ))}

              {/* Uploading files */}
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

          {/* Drag overlay */}
          {isDragOver && (
            <div className="absolute inset-0 bg-background/90 backdrop-blur-sm border border-dashed border-primary rounded-t-2xl flex items-center justify-center z-10 border-b-0">
              <div className="text-primary font-medium">
                {tDialogs('dropFilesHere')}
              </div>
            </div>
          )}

          {/* Text input area */}
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
            {/* Placeholder and keyboard shortcuts */}
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

          {/* Action buttons row */}
          <div className="flex items-center pb-3">
            {/* Attachment button */}
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
    </div>
  );
}
