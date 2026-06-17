/**
 * SHA-256 hashing utilities for content deduplication.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * Compute the SHA-256 hash of a file's content, streaming to keep memory flat.
 *
 * Returns a hex-encoded SHA-256 hash string.
 */
export function computeFileHash(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const sha256 = createHash('sha256');
    const stream = createReadStream(filePath, { highWaterMark: 8192 });
    stream.on('data', (chunk) => sha256.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(sha256.digest('hex')));
  });
}

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
