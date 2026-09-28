import { z } from 'zod';

import { PRODUCT_IMAGE_URL_MAX } from '@/backend/core/products/field_limits';
import { productImageUrlParts } from '@/lib/shared/product-images';
import { isHttpUrl } from '@/lib/utils/url';

/** The messages a refused image address resolves to. */
export interface ProductImageUrlMessages {
  tooLong: string;
  notUrl: string;
}

/** An address the product-image upload returned: exactly the app path it
 * builds (`/api/app/products/images/<uuid>?orgId=…`, under any base path).
 * Any other same-origin path (`/images/cat.png`) is refused at Create. */
function isUploadedImagePath(value: string): boolean {
  return productImageUrlParts(value) !== null;
}

/**
 * The form's rule for the product image, the door's own shape
 * (`productImageUrlSchema` in `backend/domains/products/input-schema.ts`,
 * plus the upload path the app door accepts): blank, the app path an upload
 * returned, or an absolute http(s) URL of at most `PRODUCT_IMAGE_URL_MAX`
 * characters once trimmed. A pasted `example.com/cat.png` used to pass the
 * length-only check and come back from Create as a bare `invalid body`.
 * Whether a URL's host is public is the door's call — it depends on the
 * deployment's crawl policy — and the toast carries its reason
 * (`imageUrl: must name a public host — …`).
 */
export function productImageUrlSchema(messages: ProductImageUrlMessages) {
  return z
    .string()
    .trim()
    .max(PRODUCT_IMAGE_URL_MAX, messages.tooLong)
    .refine(
      (value) => value === '' || isUploadedImagePath(value) || isHttpUrl(value),
      messages.notUrl,
    );
}
