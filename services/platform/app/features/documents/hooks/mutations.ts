'use client';

import { useState, useRef, useCallback } from 'react';

import {
  removeItemFromListQuery,
  updateItemInListQuery,
} from '@/app/hooks/optimistic-updates';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import {
  removeItemFromPaginatedQuery,
  updateItemInPaginatedQuery,
} from '@/app/hooks/use-convex-paginated-query';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { resolveFileType } from '@/lib/shared/file-types';
import { calculateFileHash } from '@/lib/utils/file-hash';

import { mapUploadError } from '../lib/map-upload-error';
import { UploadTimeoutError, withDeadline } from '../lib/upload-deadline';

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
  /** Upload into a PROJECT folder: `folderId` must belong to this project
   *  (the mutation's project branch — a project folder without this reads
   *  as not-found, by design). */
  projectId?: string;
}

interface UploadOptions {
  organizationId: string;
  onSuccess?: (fileInfo: FileInfo) => void;
  onError?: (error: string) => void;
}

// ---------------------------------------------------------------------------
// Upload with XHR for byte-level progress
// ---------------------------------------------------------------------------

// No-progress watchdog for the blob PUT. A fixed overall timeout would kill a
// legitimately slow 100 MB upload, so we time INACTIVITY instead: if no
// `progress` event fires for this long, the connection is wedged (dropped
// network, dead proxy) and we abort. Without this, a stalled XHR never settles
// and the dialog's `isUploading` latch stays stuck forever — no further uploads
// possible until a page reload.
const UPLOAD_STALL_TIMEOUT_MS = 60_000;

// Ceiling for the Convex upload mutations (`generateUploadUrl`,
// `createDocumentFromUpload`). These are normally sub-second; if one never
// settles (a wedged websocket) the per-file loop would hang forever with the
// latch held. Race each await against this deadline AND the abort signal so a
// hung call fails the file and releases the loop instead of wedging the dialog.
const MUTATION_TIMEOUT_MS = 120_000;

function uploadWithProgress(
  url: string,
  file: File,
  contentType: string,
  // `POST` → Convex `_storage` (the response JSON carries the storageId to
  // bind); `PUT` → the org's S3 bucket (the presigned URL, no useful body — the
  // ref was known up front and is bound by the caller).
  method: 'POST' | 'PUT',
  signal: AbortSignal | undefined,
  onProgress: (loaded: number, total: number) => void,
): Promise<{ storageId?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.setRequestHeader('Content-Type', contentType);

    // No-progress watchdog: (re)armed on every progress tick; if it ever
    // fires, the transfer has stalled — abort so the promise settles.
    let stalled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const clearStall = () => {
      if (stallTimer !== undefined) clearTimeout(stallTimer);
    };
    const armStall = () => {
      clearStall();
      stallTimer = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, UPLOAD_STALL_TIMEOUT_MS);
    };

    xhr.upload.addEventListener('progress', (e) => {
      armStall();
      if (e.lengthComputable) {
        onProgress(e.loaded, e.total);
      }
    });

    xhr.addEventListener('load', () => {
      clearStall();
      if (xhr.status >= 200 && xhr.status < 300) {
        if (method === 'PUT') {
          // S3 PUT returns an empty body (ETag header only); the ref is bound
          // by the caller from the handoff's `s3Ref`.
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Failed to parse upload response'));
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.statusText}`));
      }
    });

    xhr.addEventListener('error', () => {
      clearStall();
      reject(new Error('Upload failed: network error'));
    });
    xhr.addEventListener('abort', () => {
      clearStall();
      reject(
        stalled
          ? new UploadTimeoutError('Upload stalled')
          : new DOMException('The operation was aborted.', 'AbortError'),
      );
    });

    signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    armStall();
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

  // Backend-aware upload handoff: routes to the org's own S3 bucket when
  // configured, else Convex `_storage`. An ACTION (not a mutation) because
  // presigning S3 needs the node runtime.
  const { mutateAsync: generateBlobUpload } = useConvexAction(
    api.files.blob_actions.generateBlobUpload,
  );
  const { mutateAsync: createDocumentFromUpload } = useConvexMutation(
    api.documents.mutations.createDocumentFromUpload,
  );
  const { mutateAsync: deleteRejectedUploadBlob } = useConvexMutation(
    api.files.mutations.deleteRejectedUploadBlob,
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

  const stageFiles = useCallback((files: File[]) => {
    const newTracked: TrackedFile[] = files.map((file) => ({
      id: generateFileId(),
      file,
      status: 'pending' as const,
      bytesLoaded: 0,
      bytesTotal: file.size,
    }));
    setTrackedFiles((prev) => [...prev, ...newTracked]);
  }, []);

  const uploadSingleFile = useCallback(
    async (
      tracked: TrackedFile,
      uploadOptions: UploadFilesOptions | undefined,
    ): Promise<boolean> => {
      const { file, id: fileId } = tracked;

      updateFileStatus(fileId, { status: 'uploading' });

      // Track the committed blob so a later document-creation failure can
      // reclaim it (the blob is committed before createDocumentFromUpload,
      // which cannot delete it itself — a throwing mutation rolls back its
      // own storage.delete). The ref is a Convex `_storage` id OR an `s3:` key.
      let uploadedRef: string | undefined;
      try {
        const resolvedType =
          resolveFileType(file.name, file.type) || 'application/octet-stream';

        const signal = abortControllerRef.current?.signal;
        const contentHash = await calculateFileHash(file);
        const handoff = await withDeadline(
          generateBlobUpload({
            organizationId: options.organizationId,
            contentType: resolvedType,
          }),
          MUTATION_TIMEOUT_MS,
          signal,
        );

        const { storageId } = await uploadWithProgress(
          handoff.url,
          file,
          resolvedType,
          handoff.method,
          signal,
          (loaded, total) => {
            updateFileStatus(fileId, {
              bytesLoaded: loaded,
              bytesTotal: total,
            });
          },
        );
        // Bind the S3 ref (known up front from the handoff) or the Convex id
        // (returned in the POST response body).
        const boundRef = handoff.s3Ref ?? storageId;
        if (!boundRef) {
          throw new Error('Upload did not return a storage reference');
        }
        uploadedRef = boundRef;

        // Create document records — one per team, or one org-wide. Each
        // mutation is raced against a deadline + the abort signal so a wedged
        // call fails this file and releases the loop rather than hanging it.
        const teamIds = uploadOptions?.teamIds;
        if (teamIds && teamIds.length > 0) {
          for (const teamId of teamIds) {
            await withDeadline(
              createDocumentFromUpload({
                organizationId: options.organizationId,
                fileId: boundRef,
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
                projectId: uploadOptions?.projectId
                  ? toId<'projects'>(uploadOptions.projectId)
                  : undefined,
                fileSize: file.size,
              }),
              MUTATION_TIMEOUT_MS,
              signal,
            );
          }
        } else {
          await withDeadline(
            createDocumentFromUpload({
              organizationId: options.organizationId,
              fileId: boundRef,
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
              projectId: uploadOptions?.projectId
                ? toId<'projects'>(uploadOptions.projectId)
                : undefined,
              fileSize: file.size,
            }),
            MUTATION_TIMEOUT_MS,
            signal,
          );
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

        // The blob was committed but the document was not created (policy
        // rejection, oversize, unsupported type, a wedged create). Reclaim the
        // orphaned blob so it doesn't silently consume storage — best-effort,
        // never let a cleanup failure mask the original error.
        if (uploadedRef) {
          try {
            await deleteRejectedUploadBlob({
              storageId: uploadedRef,
              organizationId: options.organizationId,
            });
          } catch (cleanupError) {
            console.warn(
              'Failed to reclaim rejected upload blob:',
              cleanupError,
            );
          }
        }

        // A stalled transfer / wedged mutation is a distinct, actionable
        // failure — surface it as such rather than the generic "check your
        // connection". Crucially the loop still advances and the `finally`
        // below releases the `isUploading` latch, so the dialog stays usable.
        if (error instanceof UploadTimeoutError) {
          updateFileStatus(fileId, {
            status: 'failed',
            error: t('upload.uploadTimedOut'),
          });
          return false;
        }

        updateFileStatus(fileId, {
          status: 'failed',
          error: mapUploadError(error, t),
        });
        return false;
      }
    },
    [
      generateBlobUpload,
      createDocumentFromUpload,
      deleteRejectedUploadBlob,
      options.organizationId,
      updateFileStatus,
      t,
    ],
  );

  const uploadFiles = useCallback(
    async (uploadOptions?: UploadFilesOptions): Promise<UploadResult> => {
      if (isUploading) {
        toast({
          title: t('upload.uploadInProgress'),
          description: t('upload.pleaseWaitForUpload'),
        });
        return { success: false, error: 'Upload already in progress' };
      }

      const pendingFiles = trackedFiles.filter((f) => f.status === 'pending');
      if (pendingFiles.length === 0) {
        const error = t('upload.noFilesSelected');
        toast({
          title: t('upload.uploadFailed'),
          description: error,
          variant: 'destructive',
        });
        return { success: false, error };
      }

      abortControllerRef.current = new AbortController();
      setIsUploading(true);

      try {
        let allSuccess = true;

        for (const tracked of pendingFiles) {
          if (abortControllerRef.current?.signal.aborted) break;
          const success = await uploadSingleFile(tracked, uploadOptions);
          if (!success) allSuccess = false;
        }

        if (allSuccess) {
          options.onSuccess?.({
            name: pendingFiles[0].file.name,
            storagePath: '',
            size: pendingFiles[0].file.size,
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
    [isUploading, t, trackedFiles, uploadSingleFile, options],
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
    // Hard-release the latch. `withDeadline` now rejects the in-flight
    // mutation awaits on abort, so the `uploadFiles` finally runs and clears
    // this too — but resetting here makes Cancel effective even if the loop
    // is between files, and it releases the dialog's close-block immediately.
    setIsUploading(false);
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
    stageFiles,
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

export function useCancelOneDriveSync() {
  return useConvexMutation(api.onedrive.mutations.cancelSyncConfig);
}

export function useDeleteDocument() {
  return useConvexMutation(api.documents.mutations.deleteDocument, {
    // EntityDeleteDialog shows its own specific error toast.
    errorToast: false,
    optimisticUpdate: (store, args) => {
      removeItemFromListQuery(
        store,
        api.documents.queries.listDocuments,
        args.documentId,
      );
      removeItemFromPaginatedQuery(
        store,
        api.documents.queries.listDocumentsPaginated,
        args.documentId,
      );
    },
  });
}

export function useUpdateDocument() {
  return useConvexMutation(api.documents.mutations.updateDocument, {
    // The team-tags dialog shows its own specific error toast.
    errorToast: false,
    optimisticUpdate: (store, args) => {
      const { title } = args;
      if (title === undefined) return;
      updateItemInListQuery(
        store,
        api.documents.queries.listDocuments,
        args.documentId,
        (document) => ({ ...document, title }),
      );
      updateItemInPaginatedQuery(
        store,
        api.documents.queries.listDocumentsPaginated,
        args.documentId,
        (document) => ({ ...document, title }),
      );
    },
  });
}

export function useUpdateFolderTeams() {
  return useConvexMutation(api.folders.mutations.updateFolderTeams);
}
