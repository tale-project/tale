'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';

import { useUploadPolicy } from '@/app/features/settings/governance/hooks/queries';
import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  CHAT_UPLOAD_ALLOWED_TYPES,
  CHAT_MAX_FILE_SIZE,
  CHAT_AUDIO_MAX_DURATION_SEC,
  CHAT_MAX_FILE_COUNT,
  CHAT_MAX_TOTAL_SIZE,
  detectMediaMime,
  getMaxFileSizeForType,
  isAudioOrVideo,
  isRagIndexableFile,
  resolveFileType,
} from '@/lib/shared/file-types';
import { compressImage } from '@/lib/utils/compress-image';
import { isTextBasedFile } from '@/lib/utils/text-file-types';

import { getAudioDuration } from './get-audio-duration';

interface FileAttachment {
  /**
   * Blob REFERENCE the upload handoff bound: a Convex `_storage` id
   * (deployment default) or an `s3:<key>` ref when the org brings its own
   * bucket. Travels with the message send; every server consumer is
   * backend-aware.
   */
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  previewUrl?: string;
  /**
   * Identity of the source file the user picked, before any client-side
   * image compression renamed/resized it (see compress-image.ts). Dedup
   * keys off these so re-attaching the same original is caught even though
   * `fileName`/`fileSize` hold the compressed values. Falls back to the
   * stored name/size for non-image attachments that were never compressed.
   */
  originalFileName?: string;
  originalFileSize?: number;
}

interface ConvexFileUploadConfig {
  organizationId: string;
  /**
   * The chat thread the upload belongs to. When provided, the
   * `fileMetadata` row is bound to the thread so its lifecycle
   * (trash → grace → hard-delete + restore) cascades to the file,
   * and access checks scope chat-uploaded RAG content to the
   * thread + its delegation ancestors.
   *
   * Optional: a fresh chat composes attachments before the thread
   * exists (the thread is created on first send). Those uploads
   * happen with `threadId === undefined` and bind retroactively only
   * if the API gets extended later — for v1 the legacy/grandfather
   * path keeps them readable to the agent in the same org.
   */
  threadId?: string;
  /**
   * Suppress automatic knowledge-base (RAG) indexing for files uploaded
   * through this composer. Set when the active conversation targets an
   * external agent (sandbox sessions like Claude Code): those agents read
   * attachments straight from the sandbox, so indexing them into the KB is
   * wasted work that only surfaces a spurious "Index failed" badge.
   */
  disableIndexing?: boolean;
  maxFileSize?: number;
  allowedTypes?: string[];
}

const DEFAULT_UPLOAD_CONFIG = {
  maxFileSize: CHAT_MAX_FILE_SIZE,
  allowedTypes: [...CHAT_UPLOAD_ALLOWED_TYPES],
};

export function useConvexFileUpload(config: ConvexFileUploadConfig) {
  const { t } = useT('chat');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
  // Backend-aware upload handoff: routes to the org's own S3 bucket when
  // configured, else Convex `_storage`. An ACTION (not a mutation) because
  // presigning S3 needs the node runtime. Mirrors the documents uploader.
  const { mutateAsync: generateBlobUpload } = useBackendAction(
    'files/blob_actions:generateBlobUpload',
  );
  const { mutateAsync: saveFileMetadata } = useBackendMutation(
    'file_metadata/mutations:saveFileMetadata',
  );
  const { mutateAsync: skipTranscription } = useBackendMutation(
    'file_metadata/mutations:skipTranscription',
  );
  const { mutateAsync: retryTranscription } = useBackendMutation(
    'file_metadata/mutations:retryTranscription',
  );

  const policyLimits = useUploadPolicy(config.organizationId);

  const mergedConfig = useMemo(
    () => ({
      ...DEFAULT_UPLOAD_CONFIG,
      ...config,
      ...(policyLimits.policyEnabled && {
        maxFileSize: policyLimits.maxFileSize,
        allowedTypes: policyLimits.allowedTypes,
      }),
    }),
    [config, policyLimits],
  );

  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  // In-flight uploads that have passed the gates but not yet committed to
  // `attachments`. The count/dedup/total-size gates below read only the
  // committed `attachments`, so without this a second attach batch fired
  // while the first is still uploading would not see the first batch — letting
  // it bypass the file-count cap, cross-batch dedup, and total-size cap. Each
  // entry keeps the ORIGINAL (pre-compression) dedup key and the source size
  // so those gates account for the pending file. Keyed by a per-upload id so
  // overlapping batches don't clobber each other's reservations.
  const pendingUploadsRef = useRef(
    new Map<string, { dedupKey: string; size: number }>(),
  );

  // AbortController per in-flight upload, keyed by the same per-upload id used
  // for `uploadingFiles` and the reservation map. Lets the user cancel an
  // upload mid-flight (#2086): `cancelUpload` aborts the `fetch`, so a large
  // file that's still streaming stops immediately instead of running to
  // completion and committing an attachment the user no longer wants.
  const uploadAbortsRef = useRef(new Map<string, AbortController>());

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const validFiles: { file: File; resolvedType: string }[] = [];
      const rejectedTooLarge: { file: File; limit: number }[] = [];
      const rejectedType: File[] = [];
      const rejectedAudioDuration: File[] = [];

      const rejectedExtension: File[] = [];

      for (const file of files) {
        const mediaMime = await detectMediaMime(file);
        const resolvedType = mediaMime ?? resolveFileType(file.name, file.type);
        const isAllowedType =
          mergedConfig.allowedTypes.includes(resolvedType) ||
          isTextBasedFile(file.name, resolvedType);

        // Check policy extension restrictions
        if (policyLimits.policyEnabled) {
          const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
          if (
            (policyLimits.blockedExtensions.length > 0 &&
              policyLimits.blockedExtensions.includes(ext)) ||
            (policyLimits.allowedExtensions.length > 0 &&
              !policyLimits.allowedExtensions.includes(ext))
          ) {
            rejectedExtension.push(file);
            continue;
          }
        }

        // Per-type ceiling. Audio/video may exceed the generic per-file cap:
        // duration (the 4-hour check below) and the total-attachment-size cap
        // are the real gates for media, so we use the (higher) media ceiling
        // rather than clamping it back down to the generic `maxFileSize`. The
        // old `Math.min(maxFileSize, mediaCeiling)` collapsed the media ceiling
        // to the 100 MB generic cap, rejecting 100–200 MB audio/video outright.
        // A governance upload policy that sets an explicit max file size still
        // bounds every type, media included.
        const typeCeiling = getMaxFileSizeForType(resolvedType);
        const perTypeLimit = policyLimits.policyEnabled
          ? Math.min(mergedConfig.maxFileSize, typeCeiling)
          : typeCeiling;
        if (file.size > perTypeLimit) {
          rejectedTooLarge.push({ file, limit: perTypeLimit });
        } else if (!isAllowedType) {
          rejectedType.push(file);
        } else {
          validFiles.push({ file, resolvedType });
        }
      }

      // Audio/video duration check — 4-hour cap to keep server-side ffmpeg
      // work bounded and transcription latency reasonable. Runs in parallel
      // across all pending media files.
      if (validFiles.some((v) => isAudioOrVideo(v.resolvedType))) {
        await Promise.all(
          validFiles.map(async (entry) => {
            if (!isAudioOrVideo(entry.resolvedType)) return;
            const duration = await getAudioDuration(entry.file);
            if (duration !== null && duration > CHAT_AUDIO_MAX_DURATION_SEC) {
              rejectedAudioDuration.push(entry.file);
              // Mark for removal from validFiles (defer actual splice until
              // after the loop to keep indexing stable).
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- sentinel used only for filter step below
              (entry as unknown as { _tooLong?: true })._tooLong = true;
            }
          }),
        );
        const filtered = validFiles.filter(
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- inverse of the sentinel set above
          (v) => !(v as unknown as { _tooLong?: true })._tooLong,
        );
        validFiles.length = 0;
        validFiles.push(...filtered);
      }

      if (rejectedExtension.length > 0) {
        const names = rejectedExtension.map((f) => f.name).join(', ');
        toast({
          title: t('invalidFiles'),
          description: t('fileTypeNotAllowed', { names }),
          variant: 'destructive',
        });
      }

      if (rejectedTooLarge.length > 0) {
        // Report the ceiling each file actually exceeded, not a single global
        // `maxFileSize`. Media gets the elevated per-type cap, so a rejected
        // video and a rejected document have different bounds; group by the
        // limit so each toast states the right number rather than always 100 MB.
        const byLimit = new Map<number, File[]>();
        for (const { file, limit } of rejectedTooLarge) {
          const group = byLimit.get(limit);
          if (group) {
            group.push(file);
          } else {
            byLimit.set(limit, [file]);
          }
        }
        for (const [limit, groupFiles] of byLimit) {
          const maxSizeMB = Math.round(limit / (1024 * 1024));
          const names = groupFiles.map((f) => f.name).join(', ');
          toast({
            title: t('invalidFiles'),
            description: t('fileSizeExceededMultiple', {
              names,
              maxSize: maxSizeMB,
            }),
            variant: 'destructive',
          });
        }
      }

      if (rejectedAudioDuration.length > 0) {
        const maxHours = CHAT_AUDIO_MAX_DURATION_SEC / 3600;
        const names = rejectedAudioDuration.map((f) => f.name).join(', ');
        toast({
          title: t('invalidFiles'),
          description: t('audioDurationExceeded', { names, maxHours }),
          variant: 'destructive',
        });
      }

      if (rejectedType.length > 0) {
        const names = rejectedType.map((f) => f.name).join(', ');
        toast({
          title: t('invalidFiles'),
          // Unsupported type — distinct from a governance-policy block
          // (rejectedExtension), which keeps the policy-worded message. #2086
          description: t('fileTypeUnsupported', { names }),
          variant: 'destructive',
        });
      }

      if (validFiles.length === 0) return;

      // Skip files already attached (match by name + size). Compare against
      // the ORIGINAL identity of stored attachments — images are compressed
      // and renamed before storage, so keying off `fileName`/`fileSize` would
      // miss a re-attach of the same >1MB source image. In-flight uploads are
      // folded in too so a duplicate spread across concurrent batches is
      // caught before the first one finishes committing.
      const existingKeys = new Set<string>();
      for (const att of attachmentsRef.current) {
        existingKeys.add(
          `${att.originalFileName ?? att.fileName}:${
            att.originalFileSize ?? att.fileSize
          }`,
        );
      }
      for (const pending of pendingUploadsRef.current.values()) {
        existingKeys.add(pending.dedupKey);
      }
      const deduped: typeof validFiles = [];
      for (const entry of validFiles) {
        const key = `${entry.file.name}:${entry.file.size}`;
        if (existingKeys.has(key)) {
          toast({
            title: t('duplicateFile'),
            description: t('duplicateFileDescription', {
              filename: entry.file.name,
            }),
          });
        } else {
          existingKeys.add(key);
          deduped.push(entry);
        }
      }

      if (deduped.length === 0) return;

      // Enforce max file count — count in-flight uploads alongside committed
      // attachments so overlapping batches can't collectively exceed the cap.
      const slotsAvailable =
        CHAT_MAX_FILE_COUNT -
        attachmentsRef.current.length -
        pendingUploadsRef.current.size;
      if (slotsAvailable <= 0) {
        toast({
          title: t('tooManyFiles'),
          description: t('tooManyFilesDescription', {
            max: CHAT_MAX_FILE_COUNT,
            rejected: deduped.length,
          }),
          variant: 'destructive',
        });
        return;
      }

      const acceptedFiles =
        deduped.length > slotsAvailable
          ? deduped.slice(0, slotsAvailable)
          : deduped;

      // Reserve a slot for every accepted file *before* any await yields, so a
      // concurrent batch fired while compression or upload is in flight sees
      // these in the gates above. The dedup key uses the original
      // (pre-compression) identity to match the stored-attachment key (#2026).
      const reservedTasks = acceptedFiles.map(
        ({ file, resolvedType }, index) => {
          const fileId = `${file.name}-${file.size}-${Date.now()}-${index}`;
          pendingUploadsRef.current.set(fileId, {
            dedupKey: `${file.name}:${file.size}`,
            size: file.size,
          });
          return { file, resolvedType, fileId };
        },
      );

      const releaseReservations = () => {
        for (const { fileId } of reservedTasks) {
          pendingUploadsRef.current.delete(fileId);
        }
      };

      // Compress images up front, before the total-size check, so every size
      // calculation works from the same (post-compression) basis. Previously
      // compression ran inside the upload promise — AFTER this check — so
      // `incomingSize` summed raw `file.size` while `existingSize` summed
      // already-compressed sizes, over-counting image batches and falsely
      // rejecting them. See #2031.
      const preparedFiles = await Promise.all(
        reservedTasks.map(async ({ file, resolvedType, fileId }) => {
          if (resolvedType.startsWith('image/')) {
            try {
              const compressionResult = await compressImage(file);
              return {
                file,
                fileToUpload: compressionResult.file,
                resolvedType,
                fileId,
              };
            } catch (error) {
              // Fall back to the original file so a single compression failure
              // doesn't sink the whole batch; the per-file/total caps still apply.
              console.warn('[uploadFiles] image compression failed:', error);
              return { file, fileToUpload: file, resolvedType, fileId };
            }
          }
          return { file, fileToUpload: file, resolvedType, fileId };
        }),
      );

      // Enforce max total attachment size *before* announcing the slot trim.
      // The total-size check returns early without uploading anything, so if
      // it runs after the slot-overflow toast the user sees two contradictory
      // toasts in quick succession: first "N files were not added" (implying
      // the trimmed batch was accepted and is uploading), then a blanket
      // "total size exceeded" that rejects the whole batch — net zero uploads.
      // Running it first means the slot-overflow toast only fires once we know
      // the trimmed batch will actually be uploaded. (#2029)
      const reservedIds = new Set(reservedTasks.map(({ fileId }) => fileId));
      let existingSize = attachmentsRef.current.reduce(
        (sum, att) => sum + att.fileSize,
        0,
      );
      for (const [id, pending] of pendingUploadsRef.current.entries()) {
        // Other in-flight batches only — this batch's slots are summed below
        // from post-compression sizes so we don't double-count reservations.
        if (!reservedIds.has(id)) {
          existingSize += pending.size;
        }
      }
      const incomingSize = preparedFiles.reduce(
        (sum, { fileToUpload }) => sum + fileToUpload.size,
        0,
      );
      if (existingSize + incomingSize > CHAT_MAX_TOTAL_SIZE) {
        toast({
          title: t('totalSizeExceeded'),
          description: t('totalSizeExceededDescription', {
            maxSize: Math.round(CHAT_MAX_TOTAL_SIZE / (1024 * 1024)),
          }),
          variant: 'destructive',
        });
        releaseReservations();
        return;
      }

      if (acceptedFiles.length < deduped.length) {
        toast({
          title: t('tooManyFiles'),
          description: t('tooManyFilesDescription', {
            max: CHAT_MAX_FILE_COUNT,
            rejected: deduped.length - acceptedFiles.length,
          }),
          variant: 'destructive',
        });
      }

      const uploadPromises = preparedFiles.map(
        async ({ file, fileToUpload, resolvedType, fileId }) => {
          const abortController = new AbortController();
          uploadAbortsRef.current.set(fileId, abortController);
          setUploadingFiles((prev) => [...prev, fileId]);

          try {
            // Images were already compressed before the total-size check above.
            // Backend-aware handoff: `POST` → Convex `_storage` (the response
            // JSON carries the storageId to bind); `PUT` → the org's own S3
            // bucket (the ref was known up front — bind `s3Ref`).
            const contentType = resolvedType || 'application/octet-stream';
            const handoff = await generateBlobUpload({
              organizationId: config.organizationId,
              contentType,
            });

            const result = await fetch(handoff.url, {
              method: handoff.method,
              headers: { 'Content-Type': contentType },
              body: fileToUpload,
              signal: abortController.signal,
            });

            if (!result.ok) {
              throw new Error(t('uploadFailed'));
            }

            let boundRef = handoff.s3Ref;
            if (!boundRef) {
              const { storageId } = await result.json();
              boundRef = storageId;
            }
            if (!boundRef) {
              throw new Error(t('uploadFailed'));
            }

            await saveFileMetadata({
              organizationId: config.organizationId,
              storageId: boundRef,
              fileName: fileToUpload.name,
              contentType: resolvedType || 'application/octet-stream',
              size: fileToUpload.size,
              source: 'user' as const,
              ...(config.threadId !== undefined && {
                threadId: config.threadId,
              }),
              ...(config.disableIndexing && { skipRagIndexing: true }),
            });

            const attachment: FileAttachment = {
              fileId: boundRef,
              fileName: fileToUpload.name,
              fileType: resolvedType,
              fileSize: fileToUpload.size,
              // Preserve the source identity so a later re-attach of the same
              // original file dedups even after compression renamed/resized it.
              originalFileName: file.name,
              originalFileSize: file.size,
              previewUrl: resolvedType.startsWith('image/')
                ? URL.createObjectURL(fileToUpload)
                : undefined,
            };

            // Commit to `attachments` and release the in-flight reservation in
            // the same synchronous tick so the file is never counted twice by
            // the gates. `attachmentsRef.current` is normally refreshed only on
            // the next render (see the assignment near the top of the hook), so
            // deleting the reservation here while the committed file isn't yet
            // visible in the ref would open a window — between this delete and
            // the render — in which a concurrent batch's gates see the file in
            // neither `pendingUploadsRef` nor `attachmentsRef.current` and can
            // over-reserve past the count/total-size caps (and miss the dedup).
            // Mirror the commit into the ref *before* releasing the reservation
            // so the gates see the file the instant its slot is freed; the next
            // render reconciles `attachmentsRef.current` to the same value.
            attachmentsRef.current = [...attachmentsRef.current, attachment];
            pendingUploadsRef.current.delete(fileId);
            setAttachments((prev) => [...prev, attachment]);

            // Files that get RAG-indexed (PDFs, docs, text — anything the
            // backend queues; mirrors `shouldIndex` in saveFileMetadata) are
            // not "done" once the bytes land: indexing runs asynchronously and
            // can still fail with an "Index failed" badge. Showing
            // "uploaded successfully" here would contradict that outcome
            // (#1457). For those files we defer the success toast until
            // indexing reaches a terminal state — `useFileIndexingStatus`
            // fires success on `completed` and an error toast on `failed`.
            // Non-indexed files (images, audio/video, unsupported types) have
            // no further processing gate, so they keep the immediate toast.
            const willIndex =
              !config.disableIndexing &&
              !isAudioOrVideo(resolvedType) &&
              isRagIndexableFile(
                fileToUpload.name,
                resolvedType || 'application/octet-stream',
              );

            if (!willIndex) {
              toast({
                title: t('fileUploaded'),
                description: t('uploadedSuccessfully', { filename: file.name }),
              });
            }
          } catch (error) {
            // A user-initiated cancel aborts the `fetch`, which rejects with an
            // AbortError. That's an expected outcome, not a failure — the chip
            // is already gone, so surfacing an "upload failed" toast would be
            // noise. Every other error still toasts.
            if (abortController.signal.aborted) {
              return;
            }
            console.error('Upload error:', error);
            toast({
              title: t('uploadFailed'),
              description: t('failedToUpload', { filename: file.name }),
              variant: 'destructive',
            });
          } finally {
            // Idempotent: the success path already released the reservation;
            // this covers the failure/cancel path so a stopped upload frees its
            // slot and its abort controller.
            uploadAbortsRef.current.delete(fileId);
            pendingUploadsRef.current.delete(fileId);
            setUploadingFiles((prev) => prev.filter((id) => id !== fileId));
          }
        },
      );

      await Promise.all(uploadPromises);
    },
    [
      generateBlobUpload,
      saveFileMetadata,
      config.organizationId,
      config.threadId,
      config.disableIndexing,
      mergedConfig,
      policyLimits,
      t,
    ],
  );

  // Cancel an upload that's still in flight (before it commits to
  // `attachments`). Aborts the `fetch` — the upload promise's catch sees the
  // abort and skips the failure toast; its finally frees the reservation and
  // clears the spinner. We also clear the state here so the chip disappears
  // the instant the user clicks, without waiting for the aborted fetch to
  // reject. All three maps/sets are idempotent, so the finally re-running is
  // harmless. Keyed by the internal per-upload id (a plain string), not the
  // `_storage` id — the file has no storage id until the upload completes.
  const cancelUpload = useCallback((fileId: string) => {
    const controller = uploadAbortsRef.current.get(fileId);
    controller?.abort();
    uploadAbortsRef.current.delete(fileId);
    pendingUploadsRef.current.delete(fileId);
    setUploadingFiles((prev) => prev.filter((id) => id !== fileId));
  }, []);

  const removeAttachment = useCallback(
    (fileId: string) => {
      setAttachments((prev) => {
        const attachment = prev.find((att) => att.fileId === fileId);
        if (!attachment) return prev;
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
        // Tell the server to cancel any pending/retrying transcription when
        // the user removes an audio/video attachment from the composer. The
        // action checks status at start and before each retry; seeing
        // `skipped` short-circuits all remaining work.
        if (isAudioOrVideo(attachment.fileType)) {
          skipTranscription({
            storageId: fileId,
            organizationId: config.organizationId,
          }).catch((err) => {
            console.warn(
              '[removeAttachment] cancel transcription failed:',
              err,
            );
          });
        }
        return prev.filter((att) => att.fileId !== fileId);
      });
    },
    [skipTranscription, config.organizationId],
  );

  const retryInFlightRef = useRef(new Set<string>());

  const retryAttachmentTranscription = useCallback(
    (fileId: string) => {
      // Reuse the existing backend retry: resets status to `queued`, clears
      // the error, and reschedules the transcribe action. The reactive
      // transcription-status query flips the chip back to queued/running on
      // its own, so no optimistic local state is needed here.
      //
      // Guard against rapid double-taps: the chip stays clickable until the
      // reactive status flips out of `failed`, so without this an impatient
      // user could schedule several transcribe jobs for the same file. The
      // in-flight set drops the duplicates until the first call settles.
      if (retryInFlightRef.current.has(fileId)) return;
      retryInFlightRef.current.add(fileId);
      retryTranscription({
        storageId: fileId,
        organizationId: config.organizationId,
      })
        .catch((err) => {
          console.warn('[retryAttachmentTranscription] failed:', err);
        })
        .finally(() => {
          retryInFlightRef.current.delete(fileId);
        });
    },
    [retryTranscription, config.organizationId],
  );

  const clearAttachments = useCallback(() => {
    const clearedAttachments = attachmentsRef.current;
    for (const att of clearedAttachments) {
      if (att.previewUrl) {
        URL.revokeObjectURL(att.previewUrl);
      }
    }
    setAttachments([]);
    return clearedAttachments;
  }, []);

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
    setAttachments,
    uploadingFiles,
    isUploading: uploadingFiles.length > 0,
    uploadFiles,
    cancelUpload,
    removeAttachment,
    retryAttachmentTranscription,
    clearAttachments,
  };
}

export type { FileAttachment, ConvexFileUploadConfig };
