'use client';

import { useState, useRef } from 'react';
import { toast } from '@/hooks/use-toast';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import type { Id } from '@/convex/_generated/dataModel';

// File size limits
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

interface FileInfo {
  name: string;
  storagePath: string;
  size: number;
  url?: string;
}

interface UploadResult {
  success: boolean;
  fileInfo?: FileInfo;
  error?: string;
}

interface UploadOptions {
  organizationId: string;
  onSuccess?: (fileInfo: FileInfo) => void;
  onError?: (error: string) => void;
}

export function useDocumentUpload(options: UploadOptions) {
  const { t } = useT('documents');
  const [isUploading, setIsUploading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const generateUploadUrl = useMutation(api.file.generateUploadUrl);
  const createDocumentFromUpload = useMutation(api.documents.createDocumentFromUpload);

  const uploadFiles = async (files: File[]): Promise<UploadResult> => {
    if (isUploading) {
      toast({
        title: t('upload.uploadInProgress'),
        description: t('upload.pleaseWaitForUpload'),
      });
      return { success: false, error: 'Upload already in progress' };
    }

    // Validate files
    if (!files || files.length === 0) {
      const error = t('upload.noFilesSelected');
      toast({
        title: t('upload.uploadFailed'),
        description: error,
        variant: 'destructive',
      });
      return { success: false, error };
    }

    // Check file sizes
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        const maxSizeMB = MAX_FILE_SIZE_BYTES / (1024 * 1024);
        const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
        const error = t('upload.fileSizeExceeded', { name: file.name, maxSize: maxSizeMB, currentSize: fileSizeMB });
        toast({
          title: t('upload.fileTooLarge'),
          description: error,
          variant: 'destructive',
        });
        return { success: false, error };
      }
    }

    // Create abort controller for this upload
    abortControllerRef.current = new AbortController();

    try {
      setIsUploading(true);

      // Show upload started toast
      toast({
        title: t('upload.uploadStarted'),
        description: t('upload.uploadingCount', { count: files.length }),
      });

      // Upload files using direct HTTP upload to Convex storage
      const uploadPromises = files.map(async (file) => {
        // Step 1: Get upload URL from Convex
        const uploadUrl = await generateUploadUrl();

        // Step 2: Upload file directly to Convex storage via HTTP
        const uploadResponse = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
          body: file,
          signal: abortControllerRef.current?.signal,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed: ${uploadResponse.statusText}`);
        }

        const { storageId } = await uploadResponse.json() as { storageId: string };

        // Step 3: Create document record in database
        const result = await createDocumentFromUpload({
          organizationId: options.organizationId,
          fileId: storageId as Id<'_storage'>,
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          metadata: {
            size: file.size,
            sourceProvider: 'upload',
            sourceMode: 'manual',
          },
        });

        return result;
      });

      const results = await Promise.all(uploadPromises);

      // Check if all uploads were successful
      const failedUploads = results.filter((result) => !result.success);
      if (failedUploads.length > 0) {
        throw new Error(failedUploads[0].error || t('upload.uploadFailed'));
      }

      // Show success toast
      toast({
        title: t('upload.uploadSuccessful'),
        description: t('upload.filesUploadedSuccessfully', { count: files.length }),
        variant: 'success',
      });

      // Call success callback for the first file
      const firstResult = results[0];
      if (firstResult.success && firstResult.documentId) {
        const fileInfo: FileInfo = {
          name: files[0].name,
          storagePath: `documents/${firstResult.documentId}`,
          size: files[0].size,
        };
        options.onSuccess?.(fileInfo);
      }

      return {
        success: true,
        fileInfo: {
          name: files[0].name,
          storagePath: `documents/${firstResult.documentId}`,
          size: files[0].size,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : t('upload.uploadFailed');

      // Check if the error is due to cancellation
      const isCancellationError =
        (error instanceof Error && error.name === 'AbortError') ||
        (error instanceof DOMException && error.name === 'AbortError') ||
        // Fallback for non-standard environments
        errorMessage.includes('cancelled') ||
        errorMessage.includes('aborted');

      if (isCancellationError) {
        // Don't show error toast for user-initiated cancellations
        return {
          success: false,
          error: t('upload.uploadCancelled'),
        };
      }

      // Show error toast for actual failures
      toast({
        title: t('upload.uploadFailed'),
        description: errorMessage,
        variant: 'destructive',
      });

      // Call error callback
      options.onError?.(errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    } finally {
      setIsUploading(false);
      abortControllerRef.current = null;
    }
  };

  const uploadFile = async (file: File): Promise<UploadResult> => {
    return uploadFiles([file]);
  };

  const uploadMultipleFiles = async (files: File[]): Promise<UploadResult> => {
    return uploadFiles(files);
  };

  const cancelUpload = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  return {
    uploadFile,
    uploadMultipleFiles,
    uploadFiles,
    isUploading,
    cancelUpload,
  };
}
