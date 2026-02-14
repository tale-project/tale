'use client';

import { useState, useRef } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexOptimisticMutation } from '@/app/hooks/use-convex-optimistic-mutation';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { DOCUMENT_MAX_FILE_SIZE } from '@/lib/shared/file-types';

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
  teamTags?: string[];
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

export function useDocumentUpload(options: UploadOptions) {
  const { t } = useT('documents');
  const [isUploading, setIsUploading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { mutateAsync: generateUploadUrl } = useConvexMutation(
    api.files.mutations.generateUploadUrl,
  );
  const { mutateAsync: createDocumentFromUpload } = useConvexMutation(
    api.documents.mutations.createDocumentFromUpload,
    {
      invalidates: [api.documents.queries.listDocuments],
    },
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

      // Show upload started toast
      toast({
        title: t('upload.uploadStarted'),
        description: t('upload.uploadingCount', { count: files.length }),
      });

      // Upload files using direct HTTP upload to Convex storage
      const uploadPromises = files.map(async (file) => {
        // Step 1: Calculate content hash for deduplication
        const contentHash = await calculateFileHash(file);

        // Step 2: Get upload URL from Convex
        const uploadUrl = await generateUploadUrl({});

        // Step 3: Upload file directly to Convex storage via HTTP
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

        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fetch response.json() returns unknown
        const { storageId } = (await uploadResponse.json()) as {
          storageId: string;
        };

        // Step 4: Create document record in database
        const result = await createDocumentFromUpload({
          organizationId: options.organizationId,
          fileId: toId<'_storage'>(storageId),
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          contentHash,
          metadata: {
            size: file.size,
            sourceProvider: 'upload',
            sourceMode: 'manual',
          },
          teamTags: uploadOptions?.teamTags,
        });

        return result;
      });

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Promise.all widens the return type
      const results = (await Promise.all(
        uploadPromises,
      )) as CreateDocumentResult[];

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
    cancelUpload,
  };
}

export function useDeleteDocument() {
  return useConvexOptimisticMutation(
    api.documents.mutations.deleteDocument,
    api.documents.queries.listDocuments,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ documentId }, { remove }) => remove(documentId),
    },
  );
}

export function useUpdateDocument() {
  return useConvexOptimisticMutation(
    api.documents.mutations.updateDocument,
    api.documents.queries.listDocuments,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ documentId, ...changes }, { update }) =>
        update(documentId, changes),
    },
  );
}
