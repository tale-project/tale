import { createHash } from 'node:crypto';

/** Immutable blob identities are scoped to the authenticated organization;
 * signed URL expiry never changes the cache identity. The daemon also hashes
 * actual destination bytes before a hit, so an agent edit is restored. */
export function stageBlobCacheKey(
  organizationId: string,
  blobRef: string,
): string {
  return createHash('sha256')
    .update(organizationId)
    .update('\0')
    .update(blobRef)
    .digest('hex');
}
