/**
 * Base64 <-> bytes conversion without relying on Node's `Buffer` (both
 * directions run in the Convex `'use node'` action runtime as well as
 * plain V8, so this stays dependency-free).
 *
 * Decoding deliberately strips any character outside the base64 alphabet
 * before decoding, so a value that picked up whitespace or stray
 * punctuation while passing through an intermediate system (env files,
 * shells, copy-paste) still decodes instead of throwing.
 */

const BASE64_TABLE =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64ToBytes(base64: string): Uint8Array {
  // Drop everything outside the base64 alphabet (including whitespace).
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const padless = clean.replace(/=+$/g, '');
  const bytes = new Uint8Array(Math.floor((padless.length * 3) / 4));
  let byteIndex = 0;
  for (let i = 0; i < padless.length; i += 4) {
    const c0 = BASE64_TABLE.indexOf(padless[i] ?? 'A');
    const c1 = BASE64_TABLE.indexOf(padless[i + 1] ?? 'A');
    const c2 = BASE64_TABLE.indexOf(padless[i + 2] ?? 'A');
    const c3 = BASE64_TABLE.indexOf(padless[i + 3] ?? 'A');
    const n = (c0 << 18) | (c1 << 12) | ((c2 & 63) << 6) | (c3 & 63);
    if (i + 1 < padless.length) bytes[byteIndex++] = (n >> 16) & 0xff;
    if (i + 2 < padless.length) bytes[byteIndex++] = (n >> 8) & 0xff;
    if (i + 3 < padless.length) bytes[byteIndex++] = n & 0xff;
  }
  return bytes.slice(0, byteIndex);
}

/**
 * Encode bytes as standard base64 (padded, no newlines).
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  let i = 0;

  while (i + 2 < len) {
    const a = bytes[i++];
    const b = bytes[i++];
    const c = bytes[i++];

    result += BASE64_TABLE[a >> 2];
    result += BASE64_TABLE[((a & 0x03) << 4) | (b >> 4)];
    result += BASE64_TABLE[((b & 0x0f) << 2) | (c >> 6)];
    result += BASE64_TABLE[c & 0x3f];
  }

  if (i < len) {
    const a = bytes[i++];
    result += BASE64_TABLE[a >> 2];

    if (i === len) {
      // Single trailing byte.
      result += BASE64_TABLE[(a & 0x03) << 4];
      result += '==';
    } else {
      // Two trailing bytes.
      const b = bytes[i++];
      result += BASE64_TABLE[((a & 0x03) << 4) | (b >> 4)];
      result += BASE64_TABLE[(b & 0x0f) << 2];
      result += '=';
    }
  }

  return result;
}
