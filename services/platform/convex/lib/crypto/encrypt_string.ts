import { CompactEncrypt } from 'jose';
import { getSecretKey } from './get_secret_key';

/**
 * Encrypt a UTF-8 string and return a compact JWE string
 */
export async function encryptString(plaintext: string): Promise<string> {
  if (!plaintext) throw new Error('Cannot encrypt empty or null data');

  const secret = getSecretKey();
  const encoder = new TextEncoder();
  const jwe = await new CompactEncrypt(encoder.encode(plaintext))
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .encrypt(secret);

  return jwe; // compact JWE string
}
