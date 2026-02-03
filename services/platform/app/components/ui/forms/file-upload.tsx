'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { ImagePlus } from 'lucide-react';
import { toast } from '@/app/hooks/use-toast';
import { useGenerateUploadUrl } from '@/app/features/chat/hooks/use-generate-upload-url';
import { compressImage } from '@/lib/utils/compress-image';
import { cn } from '@/lib/utils/cn';
import { useT } from '@/lib/i18n/client';
import type { Id } from '@/convex/_generated/dataModel';

interface FileAttachment {
  fileId: Id<'_storage'>;
  fileName: string;
  fileType: string;
  fileSize: number;
  previewUrl?: string;
}

interface FileUploadContextValue {
  attachments: FileAttachment[];
  uploadingFiles: string[];
  isDragOver: boolean;
  isUploading: boolean;
  uploadFiles: (files: FileList) => Promise<void>;
  removeAttachment: (fileId: Id<'_storage'>) => void;
  clearAttachments: () => FileAttachment[];
  setIsDragOver: (value: boolean) => void;
}

const FileUploadContext = createContext<FileUploadContextValue | null>(null);

function useFileUploadContext() {
  const context = useContext(FileUploadContext);
  if (!context) {
    throw new Error(
      'FileUpload components must be used within FileUpload.Root',
    );
  }
  return context;
}

interface FileUploadConfig {
  maxFileSize?: number;
  allowedTypes?: string[];
}

const DEFAULT_CONFIG: Required<FileUploadConfig> = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  allowedTypes: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
};

interface RootProps {
  children: ReactNode;
  config?: FileUploadConfig;
}

function Root({ children, config }: RootProps) {
  const { t } = useT('chat');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const generateUploadUrl = useGenerateUploadUrl();

  const mergedConfig = useMemo(
    () => ({ ...DEFAULT_CONFIG, ...config }),
    [config],
  );

  const uploadFiles = useCallback(
    async (files: FileList) => {
      const fileArray = Array.from(files);

      const invalidFiles = fileArray.filter(
        (file) =>
          file.size > mergedConfig.maxFileSize ||
          !mergedConfig.allowedTypes.includes(file.type),
      );

      if (invalidFiles.length > 0) {
        toast({
          title: t('invalidFiles'),
          description: t('filesNotSupported'),
          variant: 'destructive',
        });
        return;
      }

      const uploadPromises = fileArray.map(async (file) => {
        const fileId = `${file.name}-${Date.now()}`;
        setUploadingFiles((prev) => [...prev, fileId]);

        try {
          let fileToUpload = file;

          if (file.type.startsWith('image/')) {
            const compressionResult = await compressImage(file);
            fileToUpload = compressionResult.file;
          }

          const uploadUrl = await generateUploadUrl();

          const result = await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': fileToUpload.type },
            body: fileToUpload,
          });

          if (!result.ok) {
            throw new Error(t('uploadFailed'));
          }

          const { storageId } = await result.json();

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
            title: t('fileUploaded'),
            description: t('uploadedSuccessfully', { filename: file.name }),
          });
        } catch (error) {
          console.error('Upload error:', error);
          toast({
            title: t('uploadFailed'),
            description: t('failedToUpload', { filename: file.name }),
            variant: 'destructive',
          });
        } finally {
          setUploadingFiles((prev) => prev.filter((id) => id !== fileId));
        }
      });

      await Promise.all(uploadPromises);
    },
    [generateUploadUrl, mergedConfig, t],
  );

  const removeAttachment = useCallback((fileId: Id<'_storage'>) => {
    setAttachments((prev) => {
      const attachment = prev.find((att) => att.fileId === fileId);
      if (attachment?.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
      return prev.filter((att) => att.fileId !== fileId);
    });
  }, []);

  const clearAttachments = useCallback(() => {
    const current = attachments;
    current.forEach((att) => {
      if (att.previewUrl) {
        URL.revokeObjectURL(att.previewUrl);
      }
    });
    setAttachments([]);
    return current;
  }, [attachments]);

  const value = useMemo(
    () => ({
      attachments,
      uploadingFiles,
      isDragOver,
      isUploading: uploadingFiles.length > 0,
      uploadFiles,
      removeAttachment,
      clearAttachments,
      setIsDragOver,
    }),
    [
      attachments,
      uploadingFiles,
      isDragOver,
      uploadFiles,
      removeAttachment,
      clearAttachments,
    ],
  );

  return (
    <FileUploadContext.Provider value={value}>
      {children}
    </FileUploadContext.Provider>
  );
}

interface DropZoneProps {
  children: ReactNode;
  className?: string;
}

function DropZone({ children, className }: DropZoneProps) {
  const { setIsDragOver, uploadFiles } = useFileUploadContext();

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(true);
    },
    [setIsDragOver],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
    },
    [setIsDragOver],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        uploadFiles(files);
      }
    },
    [setIsDragOver, uploadFiles],
  );

  return (
    <div
      className={className}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
    </div>
  );
}

interface OverlayProps {
  className?: string;
  label?: string;
}

function Overlay({ className, label }: OverlayProps) {
  const { t } = useT('chat');
  const { isDragOver } = useFileUploadContext();

  if (!isDragOver) return null;

  return (
    <div
      className={cn(
        'absolute inset-0 border-2 border-dashed border-info-foreground flex flex-col items-center justify-center z-50 gap-2 bg-info',
        className,
      )}
    >
      <ImagePlus className="size-8 text-muted-foreground" />
      <span className="text-sm text-muted-foreground">
        {label ?? t('dropFilesToAdd')}
      </span>
    </div>
  );
}

export const FileUpload = {
  Root,
  DropZone,
  Overlay,
  useContext: useFileUploadContext,
};

export type { FileAttachment, FileUploadContextValue };
