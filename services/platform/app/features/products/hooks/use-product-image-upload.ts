'use client';

import { useCallback, useState } from 'react';

import { useBackendClient } from '@/app/hooks/use-backend-client';

/** Product images are small thumbnails; cap uploads at 5 MB. */
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

/**
 * Uploads a product image to Convex storage and resolves a stable public URL
 * suitable for the product's `imageUrl` field. Reuses the same
 * generateUploadUrl → POST → getFileUrl flow as chat attachments, so no new
 * storage/serving infrastructure is introduced.
 */
export function useProductImageUpload() {
  const client = useBackendClient();
  const [isUploading, setIsUploading] = useState(false);

  const uploadImage = useCallback(
    async (file: File): Promise<string | null> => {
      setIsUploading(true);
      try {
        const uploadUrl = await client.mutation(
          'files/mutations:generateUploadUrl',
          {},
        );
        const res = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (!res.ok) {
          throw new Error(`Upload failed with status ${res.status}`);
        }
        const { storageId } = await res.json();
        if (!storageId) {
          throw new Error('Upload response missing storageId');
        }
        return await client.query('files/queries:getFileUrl', {
          fileId: storageId,
        });
      } finally {
        setIsUploading(false);
      }
    },
    [client],
  );

  return { uploadImage, isUploading };
}
