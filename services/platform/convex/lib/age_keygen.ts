'use node';

/**
 * Age public key derivation from a secret key.
 *
 * Used by saveProviderSecret to pass the --age flag to sops -e,
 * eliminating the need for .sops.yaml files.
 */

import { x25519 } from '@noble/curves/ed25519';
import { bech32 } from '@scure/base';

const SECRET_HRP = 'age-secret-key-';
const PUBLIC_HRP = 'age';

/**
 * Derive the age public key from an existing secret key string.
 *
 * @param secretKey - The "AGE-SECRET-KEY-1..." string
 * @returns The corresponding "age1..." public key
 */
export function deriveAgePublicKey(secretKey: string): string {
  const lowercase = secretKey.toLowerCase();
  if (!lowercase.includes('1')) {
    throw new Error('Invalid age secret key: missing bech32 separator');
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The includes('1') guard above proves the bech32 separator exists
  const decoded = bech32.decode(lowercase as `${string}1${string}`, false);
  if (decoded.prefix !== SECRET_HRP) {
    throw new Error(`Invalid age secret key prefix: "${decoded.prefix}"`);
  }
  const secretBytes = bech32.fromWords(decoded.words);
  const publicBytes = x25519.getPublicKey(new Uint8Array(secretBytes));
  return bech32.encode(PUBLIC_HRP, bech32.toWords(publicBytes));
}
