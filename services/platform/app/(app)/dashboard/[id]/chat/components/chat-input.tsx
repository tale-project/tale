'use client';

import { Textarea } from '@/components/ui/textarea';
import { ComponentPropsWithoutRef, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { toast } from '@/hooks/use-toast';
import { Id } from '@/convex/_generated/dataModel';
import DocumentIcon from '@/components/ui/document-icon';
import { LoaderCircleIcon } from 'lucide-react';

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

export default function ChatInput({
  value = '',
  onChange,
  onSendMessage,
  isLoading = false,
  placeholder = 'Type your message here…',
  ...restProps
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);

  const generateUploadUrl = useMutation(api.file.generateUploadUrl);

  const handleSendMessage = () => {
    if ((!value.trim() && attachments.length === 0) || isLoading) return;
    onSendMessage(
      value.trim(),
      attachments.length > 0 ? attachments : undefined,
    );
    // Clean up preview URLs
    attachments.forEach((att) => {
      if (att.previewUrl) {
        URL.revokeObjectURL(att.previewUrl);
      }
    });
    setAttachments([]);
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
        title: 'Invalid files',
        description: `Some files are too large (>10MB) or not supported. Supported: images, PDF, Word docs, text files.`,
        variant: 'destructive',
      });
      return;
    }

    const uploadPromises = fileArray.map(async (file) => {
      const fileId = `${file.name}-${Date.now()}`;
      setUploadingFiles((prev) => [...prev, fileId]);

      try {
        // Get upload URL from Convex
        const uploadUrl = await generateUploadUrl();

        // Upload file to Convex storage
        const result = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': file.type },
          body: file,
        });

        if (!result.ok) {
          throw new Error('Upload failed');
        }

        const { storageId } = await result.json();

        // Create attachment object
        const attachment: FileAttachment = {
          fileId: storageId,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          previewUrl: file.type.startsWith('image/')
            ? URL.createObjectURL(file)
            : undefined,
        };

        setAttachments((prev) => [...prev, attachment]);

        toast({
          title: 'File uploaded',
          description: `${file.name} uploaded successfully`,
        });
      } catch (error) {
        console.error('Upload error:', error);
        toast({
          title: 'Upload failed',
          description: `Failed to upload ${file.name}`,
          variant: 'destructive',
        });
      } finally {
        setUploadingFiles((prev) => prev.filter((id) => id !== fileId));
      }
    });

    await Promise.all(uploadPromises);
  };

  const removeAttachment = (fileId: Id<'_storage'>) => {
    setAttachments((prev) => {
      const attachment = prev.find((att) => att.fileId === fileId);
      if (attachment?.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
      return prev.filter((att) => att.fileId !== fileId);
    });
  };

  const handleInputChange = (newValue: string) => {
    onChange?.(newValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
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
              {attachments
                .filter((att) => att.fileType.startsWith('image/'))
                .map((attachment) => (
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
                          <span className="text-xs text-blue-600">IMG</span>
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
              {attachments
                .filter((att) => !att.fileType.startsWith('image/'))
                .map((attachment) => (
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
                          ? 'PDF'
                          : attachment.fileType.includes('word')
                            ? 'DOC'
                            : attachment.fileType === 'text/plain'
                              ? 'TXT'
                              : 'FILE'}
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
                Drop files here to upload
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
              className="min-h-[100px] relative border-0 shadow-none resize-none focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground px-0 py-0 bg-transparent placeholder:text-muted-foreground"
              disabled={isLoading}
              placeholder=""
            />
            {/* Placeholder and keyboard shortcuts */}
            {value.length === 0 && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground absolute top-0 left-0 pointer-events-none">
                {placeholder}
                <div className="flex items-center justify-center size-4 rounded border border-muted-foreground/30">
                  <span>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                    >
                      <path
                        d="M11.3331 0.666687V6.66669C11.3331 7.37393 11.0522 8.05221 10.5521 8.55231C10.052 9.0524 9.37371 9.33335 8.66646 9.33335H2.60913L4.2758 11L3.33313 11.9427L0.0571289 8.66669L3.33313 5.39069L4.2758 6.33335L2.60913 8.00002H8.66646C9.02008 8.00002 9.35922 7.85954 9.60927 7.6095C9.85932 7.35945 9.9998 7.02031 9.9998 6.66669V0.666687H11.3331Z"
                        fill="#9CA3AF"
                      />
                    </svg>
                  </span>
                </div>
                to send or drag files here.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
