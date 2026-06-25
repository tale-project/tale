'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';

import { useUploadPolicy } from '@/app/features/settings/governance/hooks/queries';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
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
  resolveFileType,
} from '@/lib/shared/file-types';
import { compressImage } from '@/lib/utils/compress-image';
import { isTextBasedFile } from '@/lib/utils/text-file-types';

import { getAudioDuration } from '../utils/get-audio-duration';
import { useGenerateUploadUrl } from './mutations';

interface FileAttachment {
  fileId: Id<'_storage'>;
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
  const { mutateAsync: generateUploadUrl } = useGenerateUploadUrl();
  const { mutateAsync: saveFileMetadata } = useConvexMutation(
    api.file_metadata.mutations.saveFileMetadata,
  );
  const { mutateAsync: skipTranscription } = useConvexMutation(
    api.file_metadata.mutations.skipTranscription,
  );
  const { mutateAsync: retryTranscription } = useConvexMutation(
    api.file_metadata.mutations.retryTranscription,
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

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const validFiles: { file: File; resolvedType: string }[] = [];
      const rejectedTooLarge: File[] = [];
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

        // Per-type ceiling: audio max file size is 1 GB (duration is the
        // real gate — see audio duration check below); other types cap at
        // the generic `maxFileSize`.
        const perTypeLimit = Math.min(
          mergedConfig.maxFileSize,
          getMaxFileSizeForType(resolvedType),
        );
        if (file.size > perTypeLimit) {
          rejectedTooLarge.push(file);
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
        const maxSizeMB = Math.round(mergedConfig.maxFileSize / (1024 * 1024));
        const names = rejectedTooLarge.map((f) => f.name).join(', ');
        toast({
          title: t('invalidFiles'),
          description: t('fileSizeExceededMultiple', {
            names,
            maxSize: maxSizeMB,
          }),
          variant: 'destructive',
        });
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
          description: t('fileTypeNotAllowed', { names }),
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

      // Enforce max total attachment size — include in-flight uploads (using
      // the source size as an upper bound; the compressed upload is smaller)
      // so concurrent batches can't collectively exceed the total cap.
      let existingSize = attachmentsRef.current.reduce(
        (sum, att) => sum + att.fileSize,
        0,
      );
      for (const pending of pendingUploadsRef.current.values()) {
        existingSize += pending.size;
      }
      const incomingSize = acceptedFiles.reduce(
        (sum, { file }) => sum + file.size,
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
        return;
      }

      // Reserve a slot for every accepted file *before* any upload starts, so
      // a concurrent batch fired mid-upload sees these in the gates above. The
      // dedup key uses the original (pre-compression) identity to match the
      // stored-attachment key. Reservations are released in the `finally` once
      // the file commits to `attachments` (or fails).
      const uploadTasks = acceptedFiles.map(({ file, resolvedType }, index) => {
        const fileId = `${file.name}-${file.size}-${Date.now()}-${index}`;
        pendingUploadsRef.current.set(fileId, {
          dedupKey: `${file.name}:${file.size}`,
          size: file.size,
        });
        return { file, resolvedType, fileId };
      });

      const uploadPromises = uploadTasks.map(
        async ({ file, resolvedType, fileId }) => {
          setUploadingFiles((prev) => [...prev, fileId]);

          try {
            let fileToUpload = file;

            if (resolvedType.startsWith('image/')) {
              const compressionResult = await compressImage(file);
              fileToUpload = compressionResult.file;
            }

            const uploadUrl = await generateUploadUrl({});

            const result = await fetch(uploadUrl, {
              method: 'POST',
              headers: {
                'Content-Type': resolvedType || 'application/octet-stream',
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

            await saveFileMetadata({
              organizationId: config.organizationId,
              storageId,
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
              fileId: storageId,
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
            // Idempotent: the success path already released the reservation;
            // this covers the failure path so a failed upload frees its slot.
            pendingUploadsRef.current.delete(fileId);
            setUploadingFiles((prev) => prev.filter((id) => id !== fileId));
          }
        },
      );

      await Promise.all(uploadPromises);
    },
    [
      generateUploadUrl,
      saveFileMetadata,
      config.organizationId,
      config.threadId,
      config.disableIndexing,
      mergedConfig,
      policyLimits,
      t,
    ],
  );

  const removeAttachment = useCallback(
    (fileId: Id<'_storage'>) => {
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

  const retryInFlightRef = useRef(new Set<Id<'_storage'>>());

  const retryAttachmentTranscription = useCallback(
    (fileId: Id<'_storage'>) => {
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
    removeAttachment,
    retryAttachmentTranscription,
    clearAttachments,
  };
}

export type { FileAttachment, ConvexFileUploadConfig };
