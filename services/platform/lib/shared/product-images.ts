/** One intake policy for the product picker and its server upload route. */
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
];
export const PRODUCT_IMAGE_ACCEPT = PRODUCT_IMAGE_TYPES.join(',');

/** The same binding URL is used by product reads, writes, and file retention. */
export function buildProductImageUrl(
  organizationId: string,
  fileId: string,
  basePath = '',
): string {
  return `${basePath.replace(/\/$/, '')}/api/app/products/images/${fileId}?orgId=${encodeURIComponent(organizationId)}`;
}
