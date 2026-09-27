'use client';

import { useCallback, useState } from 'react';

import { useBackendClient } from '@/app/hooks/use-backend-client';
import { AppError } from '@/lib/shared/errors/app-error';

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
          // The door names its refusal (`PRODUCT_IMAGE_ACTIVE_CONTENT`,
          // `PRODUCT_IMAGE_INVALID`, `FILE_SIZE_INVALID`); carry the code so
          // the field can say why instead of "try again".
          const body: unknown = await res.json().catch(() => null);
          const field = (name: string): string | undefined => {
            if (body === null || typeof body !== 'object') return undefined;
            const value = Reflect.get(body, name);
            return typeof value === 'string' ? value : undefined;
          };
          throw new AppError({
            code: field('error') ?? `HTTP_${res.status}`,
            message:
              field('message') ?? `Upload failed with status ${res.status}`,
          });
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
