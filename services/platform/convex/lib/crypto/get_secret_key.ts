'use node';

import { base64UrlToBuffer } from './base64_url_to_buffer';

/**
 * Get the secret key from environment variables
 */
export function getSecretKey(): Uint8Array {
  const b64 = process.env.ENCRYPTION_SECRET;
  const hex = process.env.ENCRYPTION_SECRET_HEX;

  const value = b64 ?? hex;
  if (!value) {
    throw new Error('ENCRYPTION_SECRET or ENCRYPTION_SECRET_HEX is required');
  }

  function hexToBytes(h: string): Uint8Array {
    const clean = h.trim().toLowerCase();
    if (clean.length % 2 !== 0) throw new Error('Invalid hex length');
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      out[i / 2] = parseInt(clean.slice(i, i + 2), 16);
    }
    return out;
  }

  const keyBytes = b64 ? base64UrlToBuffer(value) : hexToBytes(value);
  if (keyBytes.length !== 32) {
    throw new Error(
      `Encryption secret must be 32 bytes. Got ${keyBytes.length} bytes from ${b64 ? 'ENCRYPTION_SECRET' : 'ENCRYPTION_SECRET_HEX'}`,
    );
  }
  return keyBytes;
}
