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

export type FileUploadStatus =
  | 'pending'
  | 'uploading'
  // All bytes handed to the network stack; waiting for the store to commit
  // and the document records to bind. Progress is indeterminate here — on a
  // slow uplink this phase runs for minutes with no byte progress to show,
  // and a bar frozen at 100 % reads as "stuck" (see UPLOAD_RESPONSE_DEADLINE_MS).
  | 'finalizing'
  | 'completed'
  | 'failed';

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

// Separate, deliberately generous deadline for everything AFTER the last byte
// has been handed to the network stack. `progress` reports bytes written into
// local/OS buffers, not bytes the store has acknowledged — so on a slow uplink
// the bar sits at 100 % while buffers drain for minutes, then the store
// commits the object and responds; no progress event ever fires again in that
// window. Timing THAT phase with the 60 s inactivity window discarded an
// otherwise-complete transfer (observed live: a 59.7 MB presigned PUT to R2
// at ~90 KB/s reached 100 % and was aborted a minute later). Buffered bytes
// are bounded by socket/proxy buffers (single-digit MB), so ten minutes
// covers the worst realistic drain + server commit without reintroducing the
// stuck-latch problem this watchdog exists to prevent.
const UPLOAD_RESPONSE_DEADLINE_MS = 10 * 60_000;

// Ceiling for the Convex upload mutations (`generateUploadUrl`,
// `createDocumentFromUpload`). These are normally sub-second; if one never
// settles (a wedged websocket) the per-file loop would hang forever with the
// latch held. Race each await against this deadline AND the abort signal so a
// hung call fails the file and releases the loop instead of wedging the dialog.
const MUTATION_TIMEOUT_MS = 120_000;

export function uploadWithProgress(
  url: string,
  file: File,
  contentType: string,
  // `POST` → Convex `_storage` (the response JSON carries the storageId to
  // bind); `PUT` → the org's S3 bucket (the presigned URL, no useful body — the
  // ref was known up front and is bound by the caller).
  method: 'POST' | 'PUT',
  signal: AbortSignal | undefined,
  onProgress: (loaded: number, total: number) => void,
  // Fires once when the upload phase ends (all bytes handed off) and the
  // response wait begins — the caller flips the row into its indeterminate
  // "confirming" state so a full bar never sits frozen at 100 %.
  onUploadPhaseDone?: () => void,
): Promise<{ storageId?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.setRequestHeader('Content-Type', contentType);

    // Two-phase watchdog: while bytes are flowing, (re)arm the short
    // inactivity window on every progress tick; once the upload phase is
    // over (`xhr.upload` 'load'), no further progress events exist by
    // design, so switch to the long response deadline instead of letting
    // the inactivity window kill a healthy request. Either timer firing
    // aborts so the promise settles and the dialog latch releases.
    let stalled = false;
    let uploadPhaseDone = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const clearWatchdog = () => {
      if (watchdog !== undefined) clearTimeout(watchdog);
    };
    const armWatchdog = (ms: number) => {
      clearWatchdog();
      watchdog = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, ms);
    };

    xhr.upload.addEventListener('progress', (e) => {
      // A late progress tick after the upload phase ended must not re-arm
      // the short window over the response deadline.
      if (!uploadPhaseDone) armWatchdog(UPLOAD_STALL_TIMEOUT_MS);
      if (e.lengthComputable) {
        onProgress(e.loaded, e.total);
      }
    });
    xhr.upload.addEventListener('load', () => {
      uploadPhaseDone = true;
      armWatchdog(UPLOAD_RESPONSE_DEADLINE_MS);
      onUploadPhaseDone?.();
    });

    xhr.addEventListener('load', () => {
      clearWatchdog();
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
      clearWatchdog();
      reject(new Error('Upload failed: network error'));
    });
    xhr.addEventListener('abort', () => {
      clearWatchdog();
      reject(
        stalled
          ? new UploadTimeoutError('Upload stalled')
          : new DOMException('The operation was aborted.', 'AbortError'),
      );
    });

    signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    armWatchdog(UPLOAD_STALL_TIMEOUT_MS);
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
          () => {
            // Bytes are all out the door; the store hasn't answered yet and
            // the document records aren't bound. Show "confirming", not a
            // dead 100 % bar — on a slow uplink this phase runs for minutes.
            updateFileStatus(fileId, { status: 'finalizing' });
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

// ---------------------------------------------------------------------------
// Controlled records (convex/documents/records.ts) — the list re-renders
// reactively off the live query, so no optimistic patches are needed.
// ---------------------------------------------------------------------------

export function useMarkDocumentControlled() {
  // Callers toast the specific refusal (already controlled / sync-owned).
  return useConvexMutation(api.documents.records.markControlled, {
    errorToast: false,
  });
}

export function useSubmitRecordForReview() {
  return useConvexMutation(api.documents.records.submitRecordForReview, {
    errorToast: false,
  });
}

export function useRespondToDocumentRecordReview() {
  return useConvexMutation(
    api.documents.records.respondToDocumentRecordReview,
    { errorToast: false },
  );
}

export function useOpenRecordRevision() {
  return useConvexMutation(api.documents.records.openRecordRevision, {
    errorToast: false,
  });
}
