'use client';

import { useCallback, useState } from 'react';

import { useBackendClient } from '@/app/hooks/use-backend-client';

export {
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_ACCEPT,
} from '@/lib/shared/product-images';

/** Upload and register an image; persist the authorized app URL, never a presign. */
export function useProductImageUpload() {
  const client = useBackendClient();
  const [isUploading, setIsUploading] = useState(false);

  const uploadImage = useCallback(
    async (file: File): Promise<string | null> => {
      setIsUploading(true);
      try {
        const uploadUrl = await client.mutation(
          'products/mutations:generateImageUploadUrl',
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
        const { imageUrl } = await res.json();
        if (typeof imageUrl !== 'string' || !imageUrl.startsWith('/')) {
          throw new Error('Upload response missing product image URL');
        }
        return imageUrl;
      } finally {
        setIsUploading(false);
      }
    },
    [client],
  );

  return { uploadImage, isUploading };
}
