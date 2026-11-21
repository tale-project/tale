/**
 * SHA-256 hashing utilities for content deduplication.
 */

import { createHash } from 'node:crypto';

/**
 * How much of a text is encoded at a time, in UTF-16 code units.
 *
 * Encoded whole, a text is a second copy of itself for as long as it is
 * hashed: forty megabytes more for a forty-megabyte document, in a process
 * that is given ninety-six to read one in (tale-project/tale#4942). A piece
 * is encoded where the hash reads it, so nothing of it is left to collect.
 */
const TEXT_PIECE_CHARS = 64 * 1024;

const isHighSurrogate = (unit: number): boolean =>
  unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number): boolean =>
  unit >= 0xdc00 && unit <= 0xdfff;

/**
 * Compute the SHA-256 hash of in-memory content. Strings are encoded as UTF-8.
 *
 * Returns a hex-encoded SHA-256 hash string.
 */
export function computeContentHash(content: string | Uint8Array): string {
  const sha256 = createHash('sha256');
  if (typeof content !== 'string') {
    sha256.update(content);
    return sha256.digest('hex');
  }
  // The bytes of the whole text encoded at once, a piece at a time. A piece
  // never ends between the two halves of a surrogate pair: the pair is one
  // character of four bytes, and its halves apart would each be encoded as
  // a character that cannot be.
  let from = 0;
  while (from < content.length) {
    let to = Math.min(content.length, from + TEXT_PIECE_CHARS);
    if (
      to < content.length &&
      isHighSurrogate(content.charCodeAt(to - 1)) &&
      isLowSurrogate(content.charCodeAt(to))
    ) {
      to += 1;
    }
    sha256.update(
      from === 0 && to === content.length ? content : content.slice(from, to),
      'utf8',
    );
    from = to;
  }
  return sha256.digest('hex');
}
