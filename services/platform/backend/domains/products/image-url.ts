import {
  buildProductImageUrl,
  productImageUrlParts,
} from '../../../lib/shared/product-images.ts';

/**
 * The managed product-image URL and its inverse — pure string work with no
 * database behind it, so the product service (which images.ts builds on)
 * can read a row's `image_url` back to its upload without a cycle.
 */

/** Origin-relative like branding images: cookies follow the host being used. */
export function productImageUrl(
  organizationId: string,
  fileId: string,
): string {
  return buildProductImageUrl(
    organizationId,
    fileId,
    process.env.BASE_PATH ?? '',
  );
}

/** Only the canonical app path is a binding. External URLs remain external. */
export function productImageId(
  value: string,
  organizationId: string,
): string | null {
  const parts = productImageUrlParts(value);
  if (parts === null) return null;
  return value === productImageUrl(organizationId, parts.fileId)
    ? parts.fileId
    : null;
}

export function isProductImageUrl(value: string): boolean {
  const parts = productImageUrlParts(value);
  return parts !== null && productImageId(value, parts.organizationId) !== null;
}
