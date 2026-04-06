/**
 * Pure-JS age keypair generation using X25519.
 *
 * Generates age-compatible keypairs without requiring the `age` CLI binary.
 * Uses @noble/curves for X25519 and @scure/base for Bech32 encoding.
 */

import { x25519 } from '@noble/curves/ed25519';
import { bech32 } from '@scure/base';

interface AgeKeypair {
  secretKey: string; // "AGE-SECRET-KEY-1..."
  publicKey: string; // "age1..."
}

const SECRET_HRP = 'age-secret-key-';
const PUBLIC_HRP = 'age';

/**
 * Generate a new age X25519 keypair.
 */
export function generateAgeKeypair(): AgeKeypair {
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const publicBytes = x25519.getPublicKey(secretBytes);

  const secretKey = bech32
    .encode(SECRET_HRP, bech32.toWords(secretBytes))
    .toUpperCase();
  const publicKey = bech32.encode(PUBLIC_HRP, bech32.toWords(publicBytes));

  return { secretKey, publicKey };
}

/**
 * Derive the age public key from an existing secret key string.
 */
export function deriveAgePublicKey(secretKey: string): string {
  const lowercase = secretKey.toLowerCase();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The age secret key format always contains a bech32 separator
  const decoded = bech32.decode(lowercase as `${string}1${string}`, false);
  if (decoded.prefix !== SECRET_HRP) {
    throw new Error(`Invalid age secret key prefix: "${decoded.prefix}"`);
  }
  const secretBytes = bech32.fromWords(decoded.words);
  const publicBytes = x25519.getPublicKey(new Uint8Array(secretBytes));
  return bech32.encode(PUBLIC_HRP, bech32.toWords(publicBytes));
}
