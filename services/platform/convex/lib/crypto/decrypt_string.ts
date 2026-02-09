import { compactDecrypt } from 'jose';

import { getSecretKey } from './get_secret_key';

/**
 * Decrypt a compact JWE string and return the original UTF-8 string
 */
export async function decryptString(jwe: string): Promise<string> {
  if (!jwe) throw new Error('Cannot decrypt empty or null data');

  const secret = getSecretKey();
  const { plaintext } = await compactDecrypt(jwe, secret);
  const decoder = new TextDecoder();
  return decoder.decode(plaintext);
}
