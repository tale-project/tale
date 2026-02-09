'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  CHAT_UPLOAD_ALLOWED_TYPES,
  CHAT_MAX_FILE_SIZE,
} from '@/lib/shared/file-types';
import { compressImage } from '@/lib/utils/compress-image';
import { isTextBasedFile } from '@/lib/utils/text-file-types';

import { useGenerateUploadUrl } from './use-generate-upload-url';

interface FileAttachment {
  fileId: Id<'_storage'>;
  fileName: string;
  fileType: string;
  fileSize: number;
  previewUrl?: string;
}

interface ConvexFileUploadConfig {
  maxFileSize?: number;
  allowedTypes?: string[];
}

const DEFAULT_CONFIG: Required<ConvexFileUploadConfig> = {
  maxFileSize: CHAT_MAX_FILE_SIZE,
  allowedTypes: [...CHAT_UPLOAD_ALLOWED_TYPES],
};

export function useConvexFileUpload(config?: ConvexFileUploadConfig) {
  const { t } = useT('chat');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
  const generateUploadUrl = useGenerateUploadUrl();

  const mergedConfig = useMemo(
    () => ({ ...DEFAULT_CONFIG, ...config }),
    [config],
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const validFiles: File[] = [];
      const invalidFiles: File[] = [];

      for (const file of files) {
        const isAllowedType =
          mergedConfig.allowedTypes.includes(file.type) ||
          isTextBasedFile(file.name, file.type);

        if (file.size > mergedConfig.maxFileSize || !isAllowedType) {
          invalidFiles.push(file);
        } else {
          validFiles.push(file);
        }
      }

      if (invalidFiles.length > 0) {
        toast({
          title: t('invalidFiles'),
          description: t('filesNotSupported'),
          variant: 'destructive',
        });
      }

      if (validFiles.length === 0) return;

      const uploadPromises = validFiles.map(async (file) => {
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
            headers: {
              'Content-Type': fileToUpload.type || 'application/octet-stream',
            },
            body: fileToUpload,
          });

          if (!result.ok) {
            throw new Error(t('uploadFailed'));
          }

          const { storageId } = await result.json();

          if (!storageId) {
            throw new Error(t('uploadFailed'));
          }

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
    let clearedAttachments: FileAttachment[] = [];
    setAttachments((prev) => {
      clearedAttachments = prev;
      for (const att of prev) {
        if (att.previewUrl) {
          URL.revokeObjectURL(att.previewUrl);
        }
      }
      return [];
    });
    return clearedAttachments;
  }, []);

  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  useEffect(() => {
    return () => {
      for (const att of attachmentsRef.current) {
        if (att.previewUrl) {
          URL.revokeObjectURL(att.previewUrl);
        }
      }
    };
  }, []);

  return {
    attachments,
    uploadingFiles,
    isUploading: uploadingFiles.length > 0,
    uploadFiles,
    removeAttachment,
    clearAttachments,
  };
}

export type { FileAttachment, ConvexFileUploadConfig };
