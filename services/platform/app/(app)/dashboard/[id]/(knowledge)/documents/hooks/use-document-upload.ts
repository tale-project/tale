'use client';

import { useState, useRef } from 'react';
import { toast } from '@/hooks/use-toast';
import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';

// File size limits
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

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
  const [isUploading, setIsUploading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const uploadFileAction = useAction(api.documents.uploadFile);

  const uploadFiles = async (files: File[]): Promise<UploadResult> => {
    if (isUploading) {
      toast({
        title: 'Upload in progress',
        description: 'Please wait for the current upload to complete',
      });
      return { success: false, error: 'Upload already in progress' };
    }

    // Validate files
    if (!files || files.length === 0) {
      const error = 'No files selected';
      toast({
        title: 'Upload failed',
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
        const error = `File ${file.name} exceeds ${maxSizeMB}MB limit. Current size: ${fileSizeMB}MB`;
        toast({
          title: 'File too large',
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
        title: 'Upload started',
        description: `Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`,
      });

      // Upload files using Convex
      const uploadPromises = files.map(async (file) => {
        const arrayBuffer = await file.arrayBuffer();
        return uploadFileAction({
          organizationId: options.organizationId as string,
          fileName: file.name,
          fileData: arrayBuffer,
          contentType: file.type || 'application/octet-stream',
          metadata: {
            size: file.size,
            sourceProvider: 'upload',
            sourceMode: 'manual',
          },
        });
      });

      const results = await Promise.all(uploadPromises);

      // Check if all uploads were successful
      const failedUploads = results.filter((result) => !result.success);
      if (failedUploads.length > 0) {
        throw new Error(failedUploads[0].error || 'Upload failed');
      }

      // Show success toast
      toast({
        title: 'Upload successful',
        description: `${files.length} file${files.length > 1 ? 's' : ''} uploaded successfully`,
        variant: 'success',
      });

      // Call success callback for the first file
      const firstResult = results[0];
      if (firstResult.success && firstResult.fileId) {
        const fileInfo: FileInfo = {
          name: files[0].name,
          storagePath: `documents/${firstResult.fileId}`,
          size: files[0].size,
        };
        options.onSuccess?.(fileInfo);
      }

      return {
        success: true,
        fileInfo: {
          name: files[0].name,
          storagePath: `documents/${firstResult.fileId}`,
          size: files[0].size,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Upload failed';

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
          error: 'Upload cancelled',
        };
      }

      // Show error toast for actual failures
      toast({
        title: 'Upload failed',
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
