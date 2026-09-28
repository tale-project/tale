import { z } from 'zod';

import { PRODUCT_IMAGE_URL_MAX } from '@/backend/core/products/field_limits';
import { isHttpUrl } from '@/lib/utils/url';

/** The messages a refused image address resolves to. */
export interface ProductImageUrlMessages {
  tooLong: string;
  notUrl: string;
}

/** An address the product-image upload returned: an app path on this origin
 * (`/api/app/products/images/<id>?orgId=…`, under any base path). */
function isAppPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//');
}

/**
 * The form's rule for the product image, the door's own shape
 * (`productImageUrlSchema` in `backend/domains/products/input-schema.ts`):
 * blank, the app path an upload returned, or an absolute http(s) URL of at
 * most `PRODUCT_IMAGE_URL_MAX` characters once trimmed. A pasted
 * `example.com/cat.png` used to pass the length-only check and come back
 * from Create as a bare `invalid body`. Whether a URL's host is public is
 * the door's call — it depends on the deployment's crawl policy — and its
 * refusal names the field on the toast.
 */
export function productImageUrlSchema(messages: ProductImageUrlMessages) {
  return z
    .string()
    .trim()
    .max(PRODUCT_IMAGE_URL_MAX, messages.tooLong)
    .refine(
      (value) => value === '' || isAppPath(value) || isHttpUrl(value),
      messages.notUrl,
    );
}
