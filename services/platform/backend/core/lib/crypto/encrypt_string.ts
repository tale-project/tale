import { CompactEncrypt } from 'jose';

import { disarmBrokenToBase64Shim } from './disarm_broken_to_base64_shim';
import { getSecretKey } from './get_secret_key';

/**
 * Encrypt a UTF-8 string into a compact JWE (direct AES-256-GCM encryption,
 * `alg: 'dir'` / `enc: 'A256GCM'`) using the key from `getSecretKey`.
 */
export async function encryptString(plaintext: string): Promise<string> {
  if (!plaintext) throw new Error('Cannot encrypt empty or null data');

  disarmBrokenToBase64Shim();

  const secret = getSecretKey();
  const encoder = new TextEncoder();
  return await new CompactEncrypt(encoder.encode(plaintext))
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .encrypt(secret);
}
