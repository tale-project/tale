/**
 * Convert base64 (standard, with optional padding and minor corruption) to Uint8Array.
 *
 * We deliberately tolerate and strip characters outside the base64 alphabet so
 * that long base64 strings that have been slightly altered by intermediate
 * systems (e.g. newlines, spaces, stray punctuation) can still be decoded.
 */

const BASE64_TABLE =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64ToBytes(base64: string): Uint8Array {
  // Remove anything outside the base64 alphabet (including whitespace).
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
 * Convert Uint8Array to standard base64 string (no newlines).
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
      // One remaining byte
      result += BASE64_TABLE[(a & 0x03) << 4];
      result += '==';
    } else {
      // Two remaining bytes
      const b = bytes[i++];
      result += BASE64_TABLE[((a & 0x03) << 4) | (b >> 4)];
      result += BASE64_TABLE[(b & 0x0f) << 2];
      result += '=';
    }
  }

  return result;
}
