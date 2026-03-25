'use client';

import { useState, useRef, useCallback } from 'react';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import {
  DOCUMENT_MAX_FILE_SIZE,
  resolveFileType,
} from '@/lib/shared/file-types';
import { calculateFileHash } from '@/lib/utils/file-hash';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileUploadStatus = 'pending' | 'uploading' | 'completed' | 'failed';

export interface TrackedFile {
  id: string;
  file: File;
  status: FileUploadStatus;
  bytesLoaded: number;
  bytesTotal: number;
  error?: string;
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

export interface UploadFilesOptions {
  teamIds?: string[];
  folderId?: string;
}

interface UploadOptions {
  organizationId: string;
  onSuccess?: (fileInfo: FileInfo) => void;
  onError?: (error: string) => void;
}

// ---------------------------------------------------------------------------
// Upload with XHR for byte-level progress
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Unique ID generator for tracked files
// ---------------------------------------------------------------------------

let fileIdCounter = 0;
function generateFileId(): string {
  return `file-${Date.now()}-${++fileIdCounter}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDocumentUpload(options: UploadOptions) {
  const { t } = useT('documents');
  const [isUploading, setIsUploading] = useState(false);
  const [trackedFiles, setTrackedFiles] = useState<TrackedFile[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const { mutateAsync: generateUploadUrl } = useConvexMutation(
    api.files.mutations.generateUploadUrl,
  );
  const { mutateAsync: createDocumentFromUpload } = useConvexMutation(
    api.documents.mutations.createDocumentFromUpload,
  );

  const updateFileStatus = useCallback(
    (fileId: string, updates: Partial<TrackedFile>) => {
      setTrackedFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, ...updates } : f)),
      );
    },
    [],
  );

  const removeTrackedFile = useCallback((fileId: string) => {
    setTrackedFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, []);

  const clearTrackedFiles = useCallback(() => {
    setTrackedFiles([]);
  }, []);

  const uploadSingleFile = useCallback(
    async (
      tracked: TrackedFile,
      uploadOptions: UploadFilesOptions | undefined,
    ): Promise<boolean> => {
      const { file, id: fileId } = tracked;

      updateFileStatus(fileId, { status: 'uploading' });

      try {
        const resolvedType =
          resolveFileType(file.name, file.type) || 'application/octet-stream';

        const contentHash = await calculateFileHash(file);
        const uploadUrl = await generateUploadUrl({});

        const { storageId } = await uploadWithProgress(
          uploadUrl,
          file,
          resolvedType,
          abortControllerRef.current?.signal,
          (loaded, total) => {
            updateFileStatus(fileId, {
              bytesLoaded: loaded,
              bytesTotal: total,
            });
          },
        );

        // Create document records — one per team, or one org-wide
        const teamIds = uploadOptions?.teamIds;
        if (teamIds && teamIds.length > 0) {
          for (const teamId of teamIds) {
            await createDocumentFromUpload({
              organizationId: options.organizationId,
              fileId: toId<'_storage'>(storageId),
              fileName: file.name,
              contentType: resolvedType,
              contentHash,
              metadata: {
                size: file.size,
                sourceProvider: 'upload',
                sourceMode: 'manual',
                lastModified: file.lastModified,
              },
              teamId,
              folderId: uploadOptions?.folderId
                ? toId<'folders'>(uploadOptions.folderId)
                : undefined,
              fileSize: file.size,
            });
          }
        } else {
          await createDocumentFromUpload({
            organizationId: options.organizationId,
            fileId: toId<'_storage'>(storageId),
            fileName: file.name,
            contentType: resolvedType,
            contentHash,
            metadata: {
              size: file.size,
              sourceProvider: 'upload',
              sourceMode: 'manual',
              lastModified: file.lastModified,
            },
            teamId: undefined,
            folderId: uploadOptions?.folderId
              ? toId<'folders'>(uploadOptions.folderId)
              : undefined,
            fileSize: file.size,
          });
        }

        updateFileStatus(fileId, {
          status: 'completed',
          bytesLoaded: file.size,
          bytesTotal: file.size,
        });
        return true;
      } catch (error) {
        const isCancellation =
          (error instanceof Error && error.name === 'AbortError') ||
          (error instanceof DOMException && error.name === 'AbortError');

        if (isCancellation) {
          updateFileStatus(fileId, { status: 'pending', bytesLoaded: 0 });
          return false;
        }

        updateFileStatus(fileId, {
          status: 'failed',
          error: t('upload.uploadFailedRetry'),
        });
        return false;
      }
    },
    [
      generateUploadUrl,
      createDocumentFromUpload,
      options.organizationId,
      updateFileStatus,
      t,
    ],
  );

  const uploadFiles = useCallback(
    async (
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

      if (!files || files.length === 0) {
        const error = t('upload.noFilesSelected');
        toast({
          title: t('upload.uploadFailed'),
          description: error,
          variant: 'destructive',
        });
        return { success: false, error };
      }

      // Validate file sizes
      for (const file of files) {
        if (file.size > DOCUMENT_MAX_FILE_SIZE) {
          const maxSizeMB = DOCUMENT_MAX_FILE_SIZE / (1024 * 1024);
          const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
          toast({
            title: t('upload.fileTooLarge'),
            description: t('upload.fileSizeExceeded', {
              name: file.name,
              maxSize: maxSizeMB,
              currentSize: fileSizeMB,
            }),
            variant: 'destructive',
          });
          return { success: false, error: t('upload.fileTooLarge') };
        }
      }

      abortControllerRef.current = new AbortController();

      // Create tracked files
      const newTracked: TrackedFile[] = files.map((file) => ({
        id: generateFileId(),
        file,
        status: 'pending' as const,
        bytesLoaded: 0,
        bytesTotal: file.size,
      }));

      setTrackedFiles(newTracked);
      setIsUploading(true);

      try {
        let allSuccess = true;

        // Upload sequentially so we can show individual progress
        for (const tracked of newTracked) {
          if (abortControllerRef.current?.signal.aborted) break;
          const success = await uploadSingleFile(tracked, uploadOptions);
          if (!success) allSuccess = false;
        }

        if (allSuccess) {
          options.onSuccess?.({
            name: files[0].name,
            storagePath: '',
            size: files[0].size,
          });
        }

        return { success: allSuccess };
      } catch (error) {
        console.error('Failed to upload documents:', error);

        const isCancellation =
          (error instanceof Error && error.name === 'AbortError') ||
          (error instanceof DOMException && error.name === 'AbortError');

        if (isCancellation) {
          return { success: false, error: t('upload.uploadCancelled') };
        }

        toast({
          title: t('upload.uploadFailed'),
          variant: 'destructive',
        });

        options.onError?.(t('upload.uploadFailed'));
        return { success: false, error: t('upload.uploadFailed') };
      } finally {
        setIsUploading(false);
        abortControllerRef.current = null;
      }
    },
    [isUploading, t, uploadSingleFile, options],
  );

  const retryFile = useCallback(
    async (fileId: string, uploadOptions?: UploadFilesOptions) => {
      const tracked = trackedFiles.find((f) => f.id === fileId);
      if (!tracked || tracked.status !== 'failed') return;

      abortControllerRef.current = new AbortController();
      setIsUploading(true);

      try {
        await uploadSingleFile(tracked, uploadOptions);
      } finally {
        setIsUploading(false);
        abortControllerRef.current = null;
      }
    },
    [trackedFiles, uploadSingleFile],
  );

  const retryAllFailed = useCallback(
    async (uploadOptions?: UploadFilesOptions) => {
      const failedFiles = trackedFiles.filter((f) => f.status === 'failed');
      if (failedFiles.length === 0) return;

      abortControllerRef.current = new AbortController();
      setIsUploading(true);

      try {
        for (const tracked of failedFiles) {
          if (abortControllerRef.current?.signal.aborted) break;
          await uploadSingleFile(tracked, uploadOptions);
        }
      } finally {
        setIsUploading(false);
        abortControllerRef.current = null;
      }
    },
    [trackedFiles, uploadSingleFile],
  );

  const cancelUpload = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // Computed stats
  const completedCount = trackedFiles.filter(
    (f) => f.status === 'completed',
  ).length;
  const failedCount = trackedFiles.filter((f) => f.status === 'failed').length;
  const totalCount = trackedFiles.length;
  const allCompleted = totalCount > 0 && completedCount === totalCount;
  const hasFailures = failedCount > 0;

  return {
    uploadFiles,
    retryFile,
    retryAllFailed,
    isUploading,
    trackedFiles,
    removeTrackedFile,
    clearTrackedFiles,
    cancelUpload,
    completedCount,
    failedCount,
    totalCount,
    allCompleted,
    hasFailures,
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
