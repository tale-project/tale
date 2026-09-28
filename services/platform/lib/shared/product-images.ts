import { z } from 'zod';

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

const PRODUCT_IMAGE_ROUTE = '/api/app/products/images/';
const IMAGE_ID = z.uuid();

/** The same binding URL is used by product reads, writes, and file retention. */
export function buildProductImageUrl(
  organizationId: string,
  fileId: string,
  basePath = '',
): string {
  return `${basePath.replace(/\/$/, '')}${PRODUCT_IMAGE_ROUTE}${fileId}?orgId=${encodeURIComponent(organizationId)}`;
}

/** What `buildProductImageUrl` was given. */
export interface ProductImageUrlParts {
  organizationId: string;
  fileId: string;
  basePath: string;
}

/**
 * The inverse of `buildProductImageUrl`: the parts of exactly the URL it
 * builds, under whatever base path, or null for any other string (another
 * path, a suffix, a fragment, a file id that is not a UUID). The product
 * form holds an app path to this shape; the doors also bind the base path
 * to the deployment's and the organization to the caller's.
 */
export function productImageUrlParts(
  value: string,
): ProductImageUrlParts | null {
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  const queryAt = value.indexOf('?');
  if (queryAt === -1) return null;
  const pathname = value.slice(0, queryAt);
  const fileId = pathname.slice(pathname.lastIndexOf('/') + 1);
  const route = `${PRODUCT_IMAGE_ROUTE}${fileId}`;
  if (!pathname.endsWith(route) || !IMAGE_ID.safeParse(fileId).success) {
    return null;
  }
  const organizationId = new URLSearchParams(value.slice(queryAt + 1)).get(
    'orgId',
  );
  if (organizationId === null) return null;
  const basePath = pathname.slice(0, -route.length);
  return value === buildProductImageUrl(organizationId, fileId, basePath)
    ? { organizationId, fileId, basePath }
    : null;
}
