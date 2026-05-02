/**
 * Pure-JS FNV-1a hash. V8-compatible — does not import any Node-only API,
 * so it can run in both the Convex V8 and Node runtimes (no `'use node'`
 * needed in callers).
 *
 * Two 32-bit passes (forward + reverse) concatenated into a 16-char hex
 * string give roughly 64-bit collision resistance — plenty for cache-key
 * partitioning and debug-log correlation.
 *
 * NOT cryptographic. Do not use for authentication, signing, or anything
 * an attacker could exploit by finding collisions. For sensitive payloads
 * the only property we rely on is non-reversibility for casual log
 * inspection.
 */
export function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  const h1 = (hash >>> 0).toString(16).padStart(8, '0');

  // Second pass with different seed and reverse traversal so swapped
  // substrings still produce distinct digests.
  let hash2 = 0x6c62272e;
  for (let i = str.length - 1; i >= 0; i--) {
    hash2 ^= str.charCodeAt(i);
    hash2 = Math.imul(hash2, 0x01000193);
  }
  const h2 = (hash2 >>> 0).toString(16).padStart(8, '0');

  return `${h1}${h2}`;
}
