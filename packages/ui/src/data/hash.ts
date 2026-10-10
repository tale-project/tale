/**
 * A short, fast name for a value: equal values hash alike whatever order
 * their keys were written in, so a reader can tell two values apart, or say
 * which document a result belongs to, without comparing them whole. Not a
 * security boundary: anyone can write a value that hashes the same.
 */

import { stableStringify } from './stable-stringify';

/**
 * cyrb53: a 53-bit hash of `text` in base 36, about eleven characters.
 */
export function cyrb53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The hash of `value` as JSON with its keys sorted. */
export function valueHash(value: unknown): string {
  return cyrb53(stableStringify(value));
}
