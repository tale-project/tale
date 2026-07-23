'use node';

/**
 * Derive an age recipient (public key) from an age secret key.
 *
 * `saveProviderSecret`-style flows only ever hold the secret key (from
 * `SOPS_AGE_KEY` / `SOPS_AGE_KEY_FILE`); deriving the recipient locally
 * means `sops -e --age <recipient>` can be invoked without maintaining a
 * `.sops.yaml` file alongside it.
 */

import { readFileSync } from 'node:fs';

import { x25519 } from '@noble/curves/ed25519';
import { bech32 } from '@scure/base';

const SECRET_HRP = 'age-secret-key-';
const PUBLIC_HRP = 'age';

/**
 * Derive the "age1…" public recipient for an "AGE-SECRET-KEY-1…" secret key.
 */
export function deriveAgePublicKey(secretKey: string): string {
  const lowercase = secretKey.toLowerCase();
  if (!lowercase.includes('1')) {
    throw new Error('Invalid age secret key: missing bech32 separator');
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the includes('1') check above guarantees the bech32 separator is present
  const decoded = bech32.decode(lowercase as `${string}1${string}`, false);
  if (decoded.prefix !== SECRET_HRP) {
    throw new Error(`Invalid age secret key prefix: "${decoded.prefix}"`);
  }
  const secretBytes = bech32.fromWords(decoded.words);
  const publicBytes = x25519.getPublicKey(new Uint8Array(secretBytes));
  return bech32.encode(PUBLIC_HRP, bech32.toWords(publicBytes));
}

/**
 * Read every age secret key configured in the environment, in source order.
 *
 * `SOPS_AGE_KEY` (a single inline key) takes precedence; otherwise every
 * non-comment `AGE-SECRET-KEY-1…` line in the file at `SOPS_AGE_KEY_FILE`
 * is returned (one key per line, `#` comments allowed — the same
 * convention the `age` CLI uses for its key files). Returns `[]` when
 * neither is configured; callers decide whether that means plaintext mode
 * or a hard error.
 *
 * Supporting multiple keys in `SOPS_AGE_KEY_FILE` is what makes key
 * rotation possible: `resolveAgeRecipients` derives one recipient per key
 * below, and encryption addresses all of them, so any key still in the
 * file can decrypt newly written ciphertext.
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
    // Object.assign bolts `cause` onto the Error: convex/tsconfig.json's
    // "lib" predates the ES2022 two-argument Error constructor overload,
    // even though the runtime itself supports it.
    throw Object.assign(
      new Error(
        `Failed to read SOPS_AGE_KEY_FILE=${keyFile}: ${err instanceof Error ? err.message : String(err)}`,
      ),
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
 * Derive one age recipient per secret key configured in the environment
 * (source order; `[]` when nothing is configured).
 *
 * Rotation flow for an operator:
 *   1. Append the new secret key to `SOPS_AGE_KEY_FILE`.
 *   2. Re-save each provider secret from Settings → AI providers — every
 *      save now encrypts to both the old and the new recipient.
 *   3. Once everything has been re-saved, delete the old key from the
 *      file. From then on, new saves only target the new recipient;
 *      previously-migrated files keep decrypting because sops still
 *      tries every key in the file.
 *
 * If step 2 is skipped after adding a key, existing ciphertext stays
 * bound to the OLD recipient only — it keeps decrypting fine while that
 * key remains in the file, but removing it later would lock that
 * ciphertext out. Saving from the UI is what actually re-encrypts a file
 * to the current recipient set.
 */
export function resolveAgeRecipients(): string[] {
  return resolveAgeSecretKeys().map(deriveAgePublicKey);
}
