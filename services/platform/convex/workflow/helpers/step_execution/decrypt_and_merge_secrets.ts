/**
 * Decrypt and merge secrets
 */

import { decryptInlineSecrets } from '../../helpers/variables/decrypt_inline_secrets';

export async function decryptAndMergeSecrets(
  workflowSecrets: Record<
    string,
    {
      kind: 'inlineEncrypted';
      cipherText: string;
      keyId?: string;
    }
  >,
  inputSecrets: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const decryptedSecrets = await decryptInlineSecrets(workflowSecrets);

  // Merge with input secrets, prioritizing input secrets
  return {
    ...decryptedSecrets,
    ...inputSecrets,
  };
}
