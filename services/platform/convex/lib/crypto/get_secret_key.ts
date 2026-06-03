'use node';

import { base64UrlToBuffer } from './base64_url_to_buffer';
import { hexToBytes } from './hex_to_bytes';

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

  const keyBytes = b64 ? base64UrlToBuffer(value) : hexToBytes(value);
  if (keyBytes.length !== 32) {
    throw new Error(
      `Encryption secret must be 32 bytes. Got ${keyBytes.length} bytes from ${b64 ? 'ENCRYPTION_SECRET' : 'ENCRYPTION_SECRET_HEX'}`,
    );
  }
  return keyBytes;
}
