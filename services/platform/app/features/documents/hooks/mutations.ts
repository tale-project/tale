'use client';

import { useState, useRef } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import {
  DOCUMENT_MAX_FILE_SIZE,
  resolveFileType,
} from '@/lib/shared/file-types';

/**
 * Calculate SHA-256 hash of a file using Web Crypto API
 */
async function calculateFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

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

interface UploadFilesOptions {
  teamId?: string;
  folderId?: string;
}

interface CreateDocumentResult {
  success: boolean;
  documentId: Id<'documents'>;
}

interface UploadOptions {
  organizationId: string;
  onSuccess?: (fileInfo: FileInfo) => void;
  onError?: (error: string) => void;
}

export interface UploadProgress {
  completedFiles: number;
  totalFiles: number;
  /** Aggregate bytes loaded across all files */
  bytesLoaded: number;
  /** Aggregate bytes total across all files */
  bytesTotal: number;
}

/**
 * Upload a file via XMLHttpRequest to get byte-level progress.
 * Returns a promise that resolves with the parsed JSON response.
 */
function uploadWithProgress(
  url: string,
  file: File,
  contentType: string,
  signal: AbortSignal | undefined,
  onProgress: (loaded: number, total: number) => void,
): Promise<{ storageId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', contentType);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded, e.total);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Failed to parse upload response'));
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.statusText}`));
      }
    });

    xhr.addEventListener('error', () =>
      reject(new Error('Upload failed: network error')),
    );
    xhr.addEventListener('abort', () => {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    });

    signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    xhr.send(file);
  });
}

export function useDocumentUpload(options: UploadOptions) {
  const { t } = useT('documents');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(
    null,
  );
  const abortControllerRef = useRef<AbortController | null>(null);
  const perFileLoadedRef = useRef<number[]>([]);
  const { mutateAsync: generateUploadUrl } = useConvexMutation(
    api.files.mutations.generateUploadUrl,
  );
  const { mutateAsync: createDocumentFromUpload } = useConvexMutation(
    api.documents.mutations.createDocumentFromUpload,
  );

  const uploadFiles = async (
    files: File[],
    uploadOptions?: UploadFilesOptions,
  ): Promise<UploadResult> => {
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
      if (file.size > DOCUMENT_MAX_FILE_SIZE) {
        const maxSizeMB = DOCUMENT_MAX_FILE_SIZE / (1024 * 1024);
        const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
        const error = t('upload.fileSizeExceeded', {
          name: file.name,
          maxSize: maxSizeMB,
          currentSize: fileSizeMB,
        });
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

      const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
      perFileLoadedRef.current = new Array(files.length).fill(0);
      setUploadProgress({
        completedFiles: 0,
        totalFiles: files.length,
        bytesLoaded: 0,
        bytesTotal: totalBytes,
      });

      // Show upload started toast
      toast({
        title: t('upload.uploadStarted'),
        description: t('upload.uploadingCount', { count: files.length }),
      });

      let completedFiles = 0;

      // Upload files using XHR for byte-level progress
      const uploadPromises = files.map(async (file, fileIndex) => {
        const resolvedType =
          resolveFileType(file.name, file.type) || 'application/octet-stream';

        // Step 1: Calculate content hash for deduplication
        const contentHash = await calculateFileHash(file);

        // Step 2: Get upload URL from Convex
        const uploadUrl = await generateUploadUrl({});

        // Step 3: Upload file with progress tracking
        const { storageId } = await uploadWithProgress(
          uploadUrl,
          file,
          resolvedType,
          abortControllerRef.current?.signal,
          (loaded) => {
            perFileLoadedRef.current[fileIndex] = loaded;
            const bytesLoaded = perFileLoadedRef.current.reduce(
              (sum, v) => sum + v,
              0,
            );
            setUploadProgress((prev) =>
              prev ? { ...prev, bytesLoaded } : prev,
            );
          },
        );

        // Step 4: Create document record in database
        const result = await createDocumentFromUpload({
          organizationId: options.organizationId,
          fileId: toId<'_storage'>(storageId),
          fileName: file.name,
          contentType: resolvedType,
          contentHash,
          metadata: {
            size: file.size,
            sourceProvider: 'upload',
            sourceMode: 'manual',
          },
          teamId: uploadOptions?.teamId,
          folderId: uploadOptions?.folderId
            ? toId<'folders'>(uploadOptions.folderId)
            : undefined,
          fileSize: file.size,
        });

        completedFiles++;
        setUploadProgress((prev) =>
          prev ? { ...prev, completedFiles } : prev,
        );

        return result;
      });

      const results = await Promise.all(uploadPromises);

      // Check if all uploads were successful
      const failedUploads = results.filter(
        (result: CreateDocumentResult) => !result.success,
      );
      if (failedUploads.length > 0) {
        throw new Error(t('upload.uploadFailed'));
      }

      // Show success toast
      toast({
        title: t('upload.uploadSuccessful'),
        description: t('upload.filesUploadedSuccessfully', {
          count: files.length,
        }),
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
      console.error('Failed to upload document:', error);

      // Check if the error is due to cancellation
      const isCancellationError =
        (error instanceof Error && error.name === 'AbortError') ||
        (error instanceof DOMException && error.name === 'AbortError');

      if (isCancellationError) {
        return {
          success: false,
          error: t('upload.uploadCancelled'),
        };
      }

      const errorMessage = t('upload.uploadFailed');

      toast({
        title: errorMessage,
        variant: 'destructive',
      });

      options.onError?.(errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
      perFileLoadedRef.current = [];
      abortControllerRef.current = null;
    }
  };

  const uploadFile = async (
    file: File,
    uploadOptions?: UploadFilesOptions,
  ): Promise<UploadResult> => {
    return uploadFiles([file], uploadOptions);
  };

  const uploadMultipleFiles = async (
    files: File[],
    uploadOptions?: UploadFilesOptions,
  ): Promise<UploadResult> => {
    return uploadFiles(files, uploadOptions);
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
    uploadProgress,
    cancelUpload,
  };
}

export function useCreateFolder() {
  return useConvexMutation(api.folders.mutations.createFolder);
}

export function useDeleteFolder() {
  return useConvexMutation(api.folders.mutations.deleteFolder);
}

export function useDeleteDocument() {
  return useConvexMutation(api.documents.mutations.deleteDocument);
}

export function useUpdateDocument() {
  return useConvexMutation(api.documents.mutations.updateDocument);
}

export function useUpdateFolderTeams() {
  return useConvexMutation(api.folders.mutations.updateFolderTeams);
}
