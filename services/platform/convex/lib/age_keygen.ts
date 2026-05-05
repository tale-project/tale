'use node';

/**
 * Age public key derivation from a secret key.
 *
 * Used by saveProviderSecret to pass the --age flag to sops -e,
 * eliminating the need for .sops.yaml files.
 */

import { readFileSync } from 'node:fs';

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

/**
 * Resolve the active age secret key from env. Prefers `SOPS_AGE_KEY` (inline
 * key bytes); falls back to the first non-comment `AGE-SECRET-KEY-1...` line
 * inside the file at `SOPS_AGE_KEY_FILE`. Returns `null` when neither yields
 * a usable key — callers decide whether that means plaintext mode or an error.
 *
 * The file format matches the `age` CLI convention: one key per line, `#`
 * comments allowed. We take the first key line so a multi-key file still
 * works (we don't try every key — sops-e would only use one anyway).
 */
export function resolveAgeSecretKey(): string | null {
  const inline = process.env.SOPS_AGE_KEY?.trim();
  if (inline) return inline;

  const keyFile = process.env.SOPS_AGE_KEY_FILE?.trim();
  if (!keyFile) return null;

  let contents: string;
  try {
    contents = readFileSync(keyFile, 'utf-8');
  } catch (err) {
    throw new Error(
      `Failed to read SOPS_AGE_KEY_FILE=${keyFile}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.toUpperCase().startsWith('AGE-SECRET-KEY-1')) return trimmed;
  }
  return null;
}
