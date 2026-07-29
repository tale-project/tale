'use node';

import { base64UrlToBuffer } from './base64_url_to_buffer';
import { hexToBytes } from './hex_to_bytes';

/**
 * Resolve the 32-byte AES key used by `encryptString`/`decryptString` from
 * the environment. `ENCRYPTION_SECRET` (base64url) wins over
 * `ENCRYPTION_SECRET_HEX` when both are set; either must decode to exactly
 * 32 bytes.
 */
export function getSecretKey(): Uint8Array {
  const b64 = process.env.ENCRYPTION_SECRET;
  const hex = process.env.ENCRYPTION_SECRET_HEX;

  const value = b64 ?? hex;
  if (!value) {
    throw new Error('ENCRYPTION_SECRET or ENCRYPTION_SECRET_HEX is required');
  }

  const keyBytes = b64 ? base64UrlToBuffer(value) : hexToBytes(value);
  if (keyBytes.length !== 32) {
    throw new Error(
      `Encryption secret must be 32 bytes. Got ${keyBytes.length} bytes from ${b64 ? 'ENCRYPTION_SECRET' : 'ENCRYPTION_SECRET_HEX'}`,
    );
  }
  return keyBytes;
}
