import { decryptString } from '../../../lib/crypto/decrypt_string';

/**
 * Decrypt inline encrypted secrets
 * This is a helper function that can be called directly from actions
 */
export async function decryptInlineSecrets(
  secrets: Record<
    string,
    {
      kind: 'inlineEncrypted';
      cipherText: string;
      keyId?: string;
    }
  >,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  for (const [key, ref] of Object.entries(secrets)) {
    if (ref.kind === 'inlineEncrypted') {
      const plaintext = await decryptString(ref.cipherText);
      out[key] = plaintext;
    }
  }

  return out;
}
