'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
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
import type { Id } from '@/convex/_generated/dataModel';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { resolveFileType } from '@/lib/shared/file-types';
import { calculateFileHash } from '@/lib/utils/file-hash';

import {
  isUploadErrorRetryable,
  mapUploadError,
} from '../lib/map-upload-error';
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
  // Blob committed; the server is attesting and binding it. This phase is
  // deliberately non-cancellable because the transaction may already commit.
  | 'binding'
  | 'completed'
  | 'failed';

export interface TrackedFile {
  id: string;
  file: File;
  status: FileUploadStatus;
  bytesLoaded: number;
  bytesTotal: number;
  error?: string;
  retryable?: boolean;
}

export interface DocumentUploadSuccess {
  name: string;
  storagePath: string;
  size: number;
  url?: string;
  /** Authoritative controlled-record version returned by the replacement
   * finalize action. Absent for ordinary document uploads. */
  version?: number;
}

interface UploadResult {
  success: boolean;
  fileInfo?: DocumentUploadSuccess;
  error?: string;
}

interface UploadSingleFileResult {
  success: boolean;
  version?: number;
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
  /** Bind the uploaded blob through a controlled-record replacement intent
   * instead of creating a new document row. */
  replacementTarget?: {
    documentId: string;
    expectedRecordState: 'draft' | 'approved';
    expectedVersion: number;
    expectedFileId: string;
  };
  onSuccess?: (fileInfo: DocumentUploadSuccess) => void;
  onError?: (error: string) => void;
}

interface UploadOperation {
  controller: AbortController;
  cancellable: boolean;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof DOMException && error.name === 'AbortError')
  );
}

class ReplacementUploadStateError extends Error {
  readonly data: { code: string };

  constructor(code: string) {
    super(code);
    this.name = 'ReplacementUploadStateError';
    this.data = { code };
  }
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

// Ceiling for upload handoffs and intent steps. Generic document binding is
// deliberately not raced. Controlled replacement finalization is raced only
// with a status reconciliation because its intent keeps blob ownership on the
// server when the outcome is ambiguous.
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
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
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
  const { locale } = useLocale();
  const [isUploading, setIsUploading] = useState(false);
  const [canCancelUpload, setCanCancelUpload] = useState(false);
  const [trackedFiles, setTrackedFiles] = useState<TrackedFile[]>([]);
  // React state cannot serialize same-tick calls: two retry clicks can both
  // observe `isUploading === false` before the render commits. The ref is the
  // synchronous lock, and the operation object is its ownership token. Only
  // that token may change cancellation phase or release the lock.
  const activeOperationRef = useRef<UploadOperation | null>(null);

  // Backend-aware upload handoff: routes to the org's own S3 bucket when
  // configured, else Convex `_storage`. An ACTION (not a mutation) because
  // presigning S3 needs the node runtime.
  const { mutateAsync: generateBlobUpload } = useConvexAction(
    api.files.blob_actions.generateBlobUpload,
  );
  const { mutateAsync: createDocumentFromUpload } = useConvexMutation(
    api.documents.mutations.createDocumentFromUpload,
  );
  const { mutateAsync: beginControlledDocumentReplacementUpload } =
    useConvexAction(
      api.documents.record_actions.beginControlledDocumentReplacementUpload,
      { errorToast: false },
    );
  const { mutateAsync: finalizeControlledDocumentReplacementUpload } =
    useConvexAction(
      api.documents.record_actions.finalizeControlledDocumentReplacementUpload,
      { errorToast: false },
    );
  const { mutateAsync: reconcileControlledDocumentReplacementUpload } =
    useConvexAction(
      api.documents.record_actions.reconcileControlledDocumentReplacementUpload,
      { errorToast: false },
    );
  const { mutateAsync: registerControlledDocumentReplacementUpload } =
    useConvexMutation(
      api.documents.replacement_uploads
        .registerControlledDocumentReplacementUpload,
      { errorToast: false },
    );
  const { mutateAsync: cancelControlledDocumentReplacementUpload } =
    useConvexMutation(
      api.documents.replacement_uploads
        .cancelControlledDocumentReplacementUpload,
      { errorToast: false },
    );
  const { mutateAsync: deleteRejectedUploadBlob } = useConvexMutation(
    api.files.mutations.deleteRejectedUploadBlob,
    { errorToast: false },
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

  const acquireOperation = useCallback((): UploadOperation | null => {
    if (activeOperationRef.current) return null;

    const operation: UploadOperation = {
      controller: new AbortController(),
      cancellable: true,
    };
    activeOperationRef.current = operation;
    setIsUploading(true);
    setCanCancelUpload(true);
    return operation;
  }, []);

  const setOperationCancellable = useCallback(
    (operation: UploadOperation, cancellable: boolean) => {
      if (activeOperationRef.current !== operation) return;
      operation.cancellable = cancellable;
      setCanCancelUpload(cancellable);
    },
    [],
  );

  const releaseOperation = useCallback((operation: UploadOperation) => {
    if (activeOperationRef.current !== operation) return;
    activeOperationRef.current = null;
    setIsUploading(false);
    setCanCancelUpload(false);
  }, []);

  const stageFiles = useCallback((files: File[], replaceExisting = false) => {
    const newTracked: TrackedFile[] = files.map((file) => ({
      id: generateFileId(),
      file,
      status: 'pending' as const,
      bytesLoaded: 0,
      bytesTotal: file.size,
    }));
    setTrackedFiles((prev) =>
      replaceExisting ? newTracked : [...prev, ...newTracked],
    );
  }, []);

  const uploadSingleFile = useCallback(
    async (
      tracked: TrackedFile,
      uploadOptions: UploadFilesOptions | undefined,
      operation: UploadOperation,
    ): Promise<UploadSingleFileResult> => {
      const { file, id: fileId } = tracked;

      if (operation.controller.signal.aborted) return { success: false };
      // A batch may continue after a previous file finished binding. Byte
      // transfer for the next file is cancellable again until its upload
      // enters finalization.
      setOperationCancellable(operation, true);
      updateFileStatus(fileId, { status: 'uploading' });

      // Track the committed blob so a later document-creation failure can
      // reclaim it (the blob is committed before createDocumentFromUpload,
      // which cannot delete it itself — a throwing mutation rolls back its
      // own storage.delete). The ref is a Convex `_storage` id OR an `s3:` key.
      let uploadedRef: string | undefined;
      let replacementIntentId:
        | Id<'controlledDocumentReplacementUploads'>
        | undefined;
      let replacementFinalizeStarted = false;
      let replacementIntentCancelled = false;
      try {
        const resolvedType =
          resolveFileType(file.name, file.type) || 'application/octet-stream';

        const signal = operation.controller.signal;
        const contentHash = options.replacementTarget
          ? undefined
          : await calculateFileHash(file);
        let uploadUrl: string;
        let uploadMethod: 'POST' | 'PUT';
        let uploadContentType: string;
        let genericS3Ref: string | undefined;

        if (options.replacementTarget) {
          const beginPromise = beginControlledDocumentReplacementUpload({
            organizationId: options.organizationId,
            documentId: toId<'documents'>(options.replacementTarget.documentId),
            expectedRecordState: options.replacementTarget.expectedRecordState,
            expectedVersion: options.replacementTarget.expectedVersion,
            expectedFileId: options.replacementTarget.expectedFileId,
            fileName: file.name,
            contentType: resolvedType,
            lastModified: file.lastModified,
          });
          let handoff;
          try {
            handoff = await withDeadline(
              beginPromise,
              MUTATION_TIMEOUT_MS,
              signal,
            );
          } catch (error) {
            if (isAbortError(error)) {
              // The action itself is not cancelled by the local deadline race.
              // If it finishes after the user aborts, retire only the intent
              // owned by this operation; a later retry has a different id.
              void beginPromise
                .then((lateHandoff) =>
                  cancelControlledDocumentReplacementUpload({
                    organizationId: options.organizationId,
                    intentId: lateHandoff.intentId,
                  }),
                )
                .catch(() => undefined);
            }
            throw error;
          }
          replacementIntentId = handoff.intentId;
          uploadUrl = handoff.url;
          uploadMethod = handoff.method;
          uploadContentType = handoff.uploadContentType;
        } else {
          const handoff = await withDeadline(
            generateBlobUpload({
              organizationId: options.organizationId,
              contentType: resolvedType,
            }),
            MUTATION_TIMEOUT_MS,
            signal,
          );
          uploadUrl = handoff.url;
          uploadMethod = handoff.method;
          uploadContentType = resolvedType;
          genericS3Ref = handoff.s3Ref;
        }

        const { storageId } = await uploadWithProgress(
          uploadUrl,
          file,
          uploadContentType,
          uploadMethod,
          signal,
          (loaded, total) => {
            updateFileStatus(fileId, {
              bytesLoaded: loaded,
              bytesTotal: total,
            });
          },
          () => {
            // `xhr.upload.load` means all bytes have entered the network stack.
            // Aborting from here can race the store commit, so flip the
            // operation synchronously before publishing the UI phase.
            setOperationCancellable(operation, false);
            // Bytes are all out the door; the store hasn't answered yet and
            // the document records aren't bound. Show "confirming", not a
            // dead 100 % bar — on a slow uplink this phase runs for minutes.
            updateFileStatus(fileId, { status: 'finalizing' });
          },
        );

        // Once the blob exists and the binder is dispatched, cancellation is
        // ambiguous: the server may commit after the client stops waiting.
        // Keep the dialog locked until the authoritative result arrives.
        setOperationCancellable(operation, false);
        if (options.replacementTarget) {
          if (replacementIntentId === undefined) {
            throw new Error('Replacement upload intent was not created');
          }
          const convexStorageId =
            uploadMethod === 'POST' && storageId !== undefined
              ? toId<'_storage'>(storageId)
              : undefined;
          if (uploadMethod === 'POST') {
            if (convexStorageId === undefined) {
              throw new Error('Upload did not return a storage reference');
            }
            await withDeadline(
              registerControlledDocumentReplacementUpload({
                organizationId: options.organizationId,
                intentId: replacementIntentId,
                storageId: convexStorageId,
              }),
              MUTATION_TIMEOUT_MS,
              signal,
            );
          }

          updateFileStatus(fileId, { status: 'binding' });
          replacementFinalizeStarted = true;
          let finalized: { version: number };
          try {
            finalized = await withDeadline(
              finalizeControlledDocumentReplacementUpload({
                organizationId: options.organizationId,
                intentId: replacementIntentId,
                storageId: convexStorageId,
              }),
              MUTATION_TIMEOUT_MS,
              undefined,
            );
          } catch (error) {
            if (!(error instanceof UploadTimeoutError)) throw error;

            // A finalize deadline is ambiguous: the server transaction may
            // have committed after the client stopped waiting. Reconcile once
            // and accept only an authoritative bound result. Every other state
            // remains intent-owned and is reclaimed by the durable server
            // protocol; never hand it to generic blob deletion.
            let reconciliation;
            try {
              reconciliation = await withDeadline(
                reconcileControlledDocumentReplacementUpload({
                  organizationId: options.organizationId,
                  intentId: replacementIntentId,
                }),
                MUTATION_TIMEOUT_MS,
                undefined,
              );
            } catch {
              throw error;
            }
            if (
              reconciliation.state !== 'bound' ||
              reconciliation.resultVersion === undefined
            ) {
              if (
                reconciliation.state === 'issued' ||
                reconciliation.state === 'attesting' ||
                reconciliation.state === 'promoted'
              ) {
                throw new ReplacementUploadStateError(
                  'UPLOAD_INTENT_IN_PROGRESS',
                );
              }
              throw new ReplacementUploadStateError(
                reconciliation.state === 'superseded'
                  ? 'DOCUMENT_RECORD_VERSION_MISMATCH'
                  : 'UPLOAD_INTENT_INVALID',
              );
            }
            finalized = { version: reconciliation.resultVersion };
          }

          updateFileStatus(fileId, {
            status: 'completed',
            bytesLoaded: file.size,
            bytesTotal: file.size,
          });
          return { success: true, version: finalized.version };
        } else {
          // Bind the S3 ref (known up front from the handoff) or the Convex id
          // (returned in the POST response body).
          const boundRef = genericS3Ref ?? storageId;
          if (!boundRef) {
            throw new Error('Upload did not return a storage reference');
          }
          uploadedRef = boundRef;
          updateFileStatus(fileId, { status: 'binding' });
          if (contentHash === undefined) {
            throw new Error('Upload hash was not calculated');
          }
          // Create document records — one per team, or one org-wide.
          const teamIds = uploadOptions?.teamIds;
          if (teamIds && teamIds.length > 0) {
            for (const teamId of teamIds) {
              await createDocumentFromUpload({
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
              });
            }
          } else {
            await createDocumentFromUpload({
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
            });
          }
        }

        updateFileStatus(fileId, {
          status: 'completed',
          bytesLoaded: file.size,
          bytesTotal: file.size,
        });
        return { success: true };
      } catch (error) {
        const isCancellation = isAbortError(error);

        if (
          replacementIntentId !== undefined &&
          !replacementFinalizeStarted &&
          !replacementIntentCancelled
        ) {
          replacementIntentCancelled = true;
          try {
            await cancelControlledDocumentReplacementUpload({
              organizationId: options.organizationId,
              intentId: replacementIntentId,
            });
          } catch (cleanupError) {
            console.warn(
              'Failed to cancel controlled replacement upload:',
              cleanupError,
            );
          }
        }

        if (isCancellation) {
          updateFileStatus(fileId, { status: 'pending', bytesLoaded: 0 });
          return { success: false };
        }

        // The blob was committed but the document was not created (policy
        // rejection, oversize, unsupported type, a wedged create). Reclaim the
        // orphaned blob so it doesn't silently consume storage — best-effort,
        // never let a cleanup failure mask the original error.
        if (!options.replacementTarget && uploadedRef) {
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
            retryable: true,
          });
          return { success: false };
        }

        updateFileStatus(fileId, {
          status: 'failed',
          error: mapUploadError(error, t, locale),
          retryable: isUploadErrorRetryable(error),
        });
        return { success: false };
      }
    },
    [
      generateBlobUpload,
      createDocumentFromUpload,
      beginControlledDocumentReplacementUpload,
      finalizeControlledDocumentReplacementUpload,
      reconcileControlledDocumentReplacementUpload,
      registerControlledDocumentReplacementUpload,
      cancelControlledDocumentReplacementUpload,
      deleteRejectedUploadBlob,
      options.organizationId,
      options.replacementTarget,
      updateFileStatus,
      setOperationCancellable,
      t,
      locale,
    ],
  );

  const uploadFiles = useCallback(
    async (uploadOptions?: UploadFilesOptions): Promise<UploadResult> => {
      const operation = acquireOperation();
      if (!operation) {
        toast({
          title: t('upload.uploadInProgress'),
          description: t('upload.pleaseWaitForUpload'),
        });
        return { success: false, error: 'Upload already in progress' };
      }

      try {
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

        let allSuccess = true;
        let authoritativeVersion: number | undefined;

        for (const tracked of pendingFiles) {
          if (operation.controller.signal.aborted) {
            allSuccess = false;
            break;
          }
          const result = await uploadSingleFile(
            tracked,
            uploadOptions,
            operation,
          );
          if (!result.success) allSuccess = false;
          if (result.version !== undefined) {
            authoritativeVersion = result.version;
          }
        }

        if (allSuccess) {
          options.onSuccess?.({
            name: pendingFiles[0].file.name,
            storagePath: '',
            size: pendingFiles[0].file.size,
            version: authoritativeVersion,
          });
        }

        return { success: allSuccess };
      } catch (error) {
        console.error('Failed to upload documents:', error);

        const isCancellation = isAbortError(error);

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
        releaseOperation(operation);
      }
    },
    [
      acquireOperation,
      releaseOperation,
      t,
      trackedFiles,
      uploadSingleFile,
      options,
    ],
  );

  const retryFile = useCallback(
    async (fileId: string, uploadOptions?: UploadFilesOptions) => {
      const tracked = trackedFiles.find((f) => f.id === fileId);
      if (
        !tracked ||
        tracked.status !== 'failed' ||
        tracked.retryable === false
      ) {
        return false;
      }

      const operation = acquireOperation();
      if (!operation) return false;

      try {
        const uploadResult = await uploadSingleFile(
          tracked,
          uploadOptions,
          operation,
        );
        if (uploadResult.success) {
          options.onSuccess?.({
            name: tracked.file.name,
            storagePath: '',
            size: tracked.file.size,
            version: uploadResult.version,
          });
        }
        return uploadResult.success;
      } finally {
        releaseOperation(operation);
      }
    },
    [
      trackedFiles,
      acquireOperation,
      uploadSingleFile,
      options,
      releaseOperation,
    ],
  );

  const retryAllFailed = useCallback(
    async (uploadOptions?: UploadFilesOptions) => {
      const failedFiles = trackedFiles.filter(
        (file) => file.status === 'failed' && file.retryable !== false,
      );
      if (failedFiles.length === 0) return false;

      const operation = acquireOperation();
      if (!operation) return false;

      try {
        let allSuccess = true;
        let authoritativeVersion: number | undefined;
        for (const tracked of failedFiles) {
          if (operation.controller.signal.aborted) {
            allSuccess = false;
            break;
          }
          const result = await uploadSingleFile(
            tracked,
            uploadOptions,
            operation,
          );
          if (!result.success) {
            allSuccess = false;
          }
          if (result.version !== undefined) {
            authoritativeVersion = result.version;
          }
        }
        if (allSuccess) {
          options.onSuccess?.({
            name: failedFiles[0].file.name,
            storagePath: '',
            size: failedFiles[0].file.size,
            version: authoritativeVersion,
          });
        }
        return allSuccess;
      } finally {
        releaseOperation(operation);
      }
    },
    [
      trackedFiles,
      acquireOperation,
      uploadSingleFile,
      options,
      releaseOperation,
    ],
  );

  const cancelUpload = useCallback((): boolean => {
    const operation = activeOperationRef.current;
    if (!operation?.cancellable) return false;

    // Claim cancellation synchronously so a second click cannot race the
    // abort event. The operation owner keeps the lock until its `finally`;
    // cancel never releases or replaces another operation's controller.
    operation.cancellable = false;
    setCanCancelUpload(false);
    operation.controller.abort();
    return true;
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
    canCancelUpload,
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
