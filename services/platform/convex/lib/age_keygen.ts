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
 * Resolve all age secret keys configured in env, in source order. Reads
 * `SOPS_AGE_KEY` (single inline key) first; if absent, parses every
 * non-comment `AGE-SECRET-KEY-1...` line in the file at `SOPS_AGE_KEY_FILE`.
 * Returns `[]` when nothing is configured — callers decide whether that
 * means plaintext mode or an error.
 *
 * Multiple keys in `SOPS_AGE_KEY_FILE` are supported and returned in file
 * order. `resolveAgeRecipients()` then derives one public recipient per key
 * and `saveProviderSecret` encrypts to all of them, so new ciphertext is
 * decryptable by any key in the file. This is the rotation primitive — see
 * the JSDoc on `resolveAgeRecipients` for the operator-facing flow.
 *
 * The file format matches the `age` CLI convention: one key per line, `#`
 * comments allowed.
 */
export function resolveAgeSecretKeys(): string[] {
  const inline = process.env.SOPS_AGE_KEY?.trim();
  if (inline) return [inline];

  const keyFile = process.env.SOPS_AGE_KEY_FILE?.trim();
  if (!keyFile) return [];

  let contents: string;
  try {
    contents = readFileSync(keyFile, 'utf-8');
  } catch (err) {
    throw new Error(
      `Failed to read SOPS_AGE_KEY_FILE=${keyFile}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  const keys: string[] = [];
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.toUpperCase().startsWith('AGE-SECRET-KEY-1'))
      keys.push(trimmed);
  }
  return keys;
}

/**
 * Derive one age public recipient per secret key configured in env. Returns
 * recipients in source order. `[]` when nothing is configured.
 *
 * Encrypt-to-all rotation flow:
 *   1. Append a new key to `SOPS_AGE_KEY_FILE`.
 *   2. Re-save each provider secret via Settings → AI providers. Each save
 *      now produces ciphertext readable by both old AND new keys.
 *   3. Once every provider has been re-saved, remove the old key from the
 *      file. New saves only encrypt to the new recipient; existing files
 *      continue to decrypt because sops walks all keys in the file.
 *
 * Caveat: rotation is operator-driven and incremental. Adding a key but
 * skipping step 2 leaves existing ciphertexts bound to the OLD recipient
 * only — they'll keep decrypting fine (old key is still there), but a future
 * "remove old key" step will lock you out of those files. The UI's "save"
 * action is the rotation trigger.
 */
export function resolveAgeRecipients(): string[] {
  return resolveAgeSecretKeys().map(deriveAgePublicKey);
}
