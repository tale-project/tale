import { z } from 'zod';

import { buildProductImageUrl } from '../../../lib/shared/product-images.ts';

/**
 * The managed product-image URL and its inverse — pure string work with no
 * database behind it, so the product service (which images.ts builds on)
 * can read a row's `image_url` back to its upload without a cycle.
 */

const IMAGE_ID = z.uuid();

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
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  const parsed = new URL(value, 'http://product-image.invalid');
  const fileId = parsed.pathname.split('/').at(-1);
  if (!IMAGE_ID.safeParse(fileId).success || fileId === undefined) return null;
  return value === productImageUrl(organizationId, fileId) ? fileId : null;
}

export function isProductImageUrl(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  const parsed = new URL(value, 'http://product-image.invalid');
  const orgId = parsed.searchParams.get('orgId');
  return orgId !== null && productImageId(value, orgId) !== null;
}
