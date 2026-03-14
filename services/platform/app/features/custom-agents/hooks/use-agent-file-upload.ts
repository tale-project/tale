'use client';

import { useState, useRef, useCallback } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import {
  DOCUMENT_MAX_FILE_SIZE,
  DOCUMENT_UPLOAD_ACCEPT,
  resolveFileType,
} from '@/lib/shared/file-types';

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

export interface AgentUploadProgress {
  bytesLoaded: number;
  bytesTotal: number;
}

interface UseAgentFileUploadOptions {
  customAgentId: Id<'customAgents'>;
}

export function useAgentFileUpload({
  customAgentId,
}: UseAgentFileUploadOptions) {
  const { t } = useT('settings');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] =
    useState<AgentUploadProgress | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const { mutateAsync: generateUploadUrl } = useConvexMutation(
    api.files.mutations.generateUploadUrl,
  );
  const { mutateAsync: addKnowledgeFile } = useConvexMutation(
    api.custom_agents.mutations.addKnowledgeFile,
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (isUploading) return;

      for (const file of files) {
        if (file.size > DOCUMENT_MAX_FILE_SIZE) {
          const maxSizeMB = DOCUMENT_MAX_FILE_SIZE / (1024 * 1024);
          toast({
            title: t('customAgents.knowledge.fileTooLarge'),
            description: `${file.name} exceeds ${maxSizeMB} MB limit.`,
            variant: 'destructive',
          });
          return;
        }
      }

      abortControllerRef.current = new AbortController();
      setIsUploading(true);

      try {
        for (const file of files) {
          const contentType =
            resolveFileType(file.name, file.type) || 'application/octet-stream';

          setUploadProgress({ bytesLoaded: 0, bytesTotal: file.size });

          const uploadUrl = await generateUploadUrl({});
          const { storageId } = await uploadWithProgress(
            uploadUrl,
            file,
            contentType,
            abortControllerRef.current?.signal,
            (loaded, total) => {
              setUploadProgress({ bytesLoaded: loaded, bytesTotal: total });
            },
          );

          await addKnowledgeFile({
            customAgentId,
            fileId: toId<'_storage'>(storageId),
            fileName: file.name,
            contentType,
            fileSize: file.size,
          });
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        console.error('Failed to upload agent knowledge file:', error);
        toast({
          title: t('customAgents.knowledge.uploadFailed'),
          variant: 'destructive',
        });
      } finally {
        setIsUploading(false);
        setUploadProgress(null);
        abortControllerRef.current = null;
      }
    },
    [isUploading, generateUploadUrl, addKnowledgeFile, customAgentId, t],
  );

  const cancelUpload = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  return {
    uploadFiles,
    isUploading,
    uploadProgress,
    cancelUpload,
    accept: DOCUMENT_UPLOAD_ACCEPT,
  };
}
