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
}

interface ConvexFileUploadConfig {
  organizationId: string;
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

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const validFiles: { file: File; resolvedType: string }[] = [];
      const rejectedTooLarge: File[] = [];
      const rejectedType: File[] = [];
      const rejectedAudioDuration: File[] = [];

      const rejectedExtension: File[] = [];

      for (const file of files) {
        const resolvedType = resolveFileType(file.name, file.type);
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

      // Skip files already attached (match by name + size)
      const existingKeys = new Set(
        attachmentsRef.current.map((att) => `${att.fileName}:${att.fileSize}`),
      );
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

      // Enforce max file count
      const slotsAvailable =
        CHAT_MAX_FILE_COUNT - attachmentsRef.current.length;
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

      // Enforce max total attachment size
      const existingSize = attachmentsRef.current.reduce(
        (sum, att) => sum + att.fileSize,
        0,
      );
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

      const uploadPromises = acceptedFiles.map(
        async ({ file, resolvedType }) => {
          const fileId = `${file.name}-${Date.now()}`;
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
            });

            const attachment: FileAttachment = {
              fileId: storageId,
              fileName: fileToUpload.name,
              fileType: resolvedType,
              fileSize: fileToUpload.size,
              previewUrl: resolvedType.startsWith('image/')
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
        },
      );

      await Promise.all(uploadPromises);
    },
    [
      generateUploadUrl,
      saveFileMetadata,
      config.organizationId,
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
    clearAttachments,
  };
}

export type { FileAttachment, ConvexFileUploadConfig };
