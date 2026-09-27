/**
 * SHA-256 hashing utilities for content deduplication.
 */

import { createHash } from 'node:crypto';

/**
 * Compute the SHA-256 hash of in-memory content. Strings are encoded as UTF-8.
 *
 * Returns a hex-encoded SHA-256 hash string.
 */
export function computeContentHash(content: string | Uint8Array): string {
  const sha256 = createHash('sha256');
  sha256.update(
    typeof content === 'string' ? Buffer.from(content, 'utf-8') : content,
  );
  return sha256.digest('hex');
}
