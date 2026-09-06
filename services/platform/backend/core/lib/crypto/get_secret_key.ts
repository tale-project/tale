'use node';

import { hexToBytes } from './hex_to_bytes';

/**
 * Resolve the 32-byte AES key used by `encryptString`/`decryptString` from
 * the environment. `ENCRYPTION_SECRET_HEX` is THE field-encryption root —
 * the same variable `secret_box.ts` derives from, the one `.env.example`
 * and `tale init` produce, and the one the environment reference documents
 * — so the two encryption lanes can never end up keyed differently. It
 * must decode to exactly 32 bytes; `loadEnv` refuses boot on anything else,
 * this guard is the fallback for a lane running outside the boot path.
 */
export function getSecretKey(): Uint8Array {
  const hex = process.env.ENCRYPTION_SECRET_HEX;
  if (!hex) {
    throw new Error(
      'ENCRYPTION_SECRET_HEX is required (32 bytes as 64 hex chars; `tale init` generates it)',
    );
  }
  const keyBytes = hexToBytes(hex);
  if (keyBytes.length !== 32) {
    throw new Error(
      `ENCRYPTION_SECRET_HEX must decode to 32 bytes; got ${keyBytes.length}`,
    );
  }
  return keyBytes;
}
