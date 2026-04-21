'use node';

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

/**
 * Thin AES-256-GCM wrapper for small server-side secrets (moderation API
 * keys, etc.). The 32-byte encryption key is derived from the existing
 * `SOPS_AGE_KEY` via HKDF-SHA256 so we don't introduce a second key the
 * ops team has to rotate in lockstep. The derivation uses a fixed
 * purpose string (`info`) so the derived key is domain-separated from
 * anything else that might later share the same root secret.
 *
 * Rotating `SOPS_AGE_KEY` (which the ops team would only do during a
 * full key-rotation) will change the derived key and therefore
 * invalidate DB-stored ciphertexts — by design, parallel to how SOPS
 * file rotation works. `keyFingerprint` lets callers detect this and
 * prompt the admin to re-enter the secret rather than crashing.
 *
 * Output fields are all Base64 so they round-trip cleanly through
 * Convex's `v.string()` schema and JSON transport.
 *
 * This is NOT meant for large payloads or high-throughput streams — it's
 * a helper for a handful of short credential values that get read once
 * per request and never leave the server.
 */

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const HKDF_INFO = 'tale-guardrails-secret-box/v1';
// Fixed salt — safe because the input keying material (`SOPS_AGE_KEY`)
// is already a high-entropy secret. The salt's purpose here is domain
// separation + forward-secrecy via KDF, not pre-image hiding.
const HKDF_SALT = 'tale-guardrails-v1';

function readKey(): Buffer {
  const raw = process.env.SOPS_AGE_KEY;
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      'SOPS_AGE_KEY environment variable is not set. The guardrails secret ' +
        'box derives its encryption key from SOPS_AGE_KEY via HKDF; set it ' +
        'in .env (same value already used for LLM provider secrets).',
    );
  }
  // hkdfSync returns an ArrayBuffer; wrap in Buffer for the crypto APIs.
  const derived = hkdfSync(
    'sha256',
    raw.trim(),
    HKDF_SALT,
    HKDF_INFO,
    KEY_BYTES,
  );
  return Buffer.from(derived);
}

/**
 * Stable 12-character fingerprint of the encryption key. Rows written
 * with one fingerprint can't be decrypted after the key is rotated; the
 * caller compares fingerprints and returns `null` instead of throwing so
 * admins can re-enter the secret via the UI after rotation.
 */
export function keyFingerprint(): string {
  const key = readKey();
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

export interface EncryptedSecret {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyFingerprint: string;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const key = readKey();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    authTag: authTag.toString('base64'),
    keyFingerprint: createHash('sha256').update(key).digest('hex').slice(0, 12),
  };
}

export function decryptSecret(input: EncryptedSecret): string {
  const key = readKey();
  const fp = createHash('sha256').update(key).digest('hex').slice(0, 12);
  if (fp !== input.keyFingerprint) {
    throw new KeyRotatedError(
      `Secret was encrypted with a different GUARDRAILS_SECRET_KEY ` +
        `(fingerprint ${input.keyFingerprint}, current ${fp}). ` +
        `Re-save the secret in the admin UI.`,
    );
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(input.nonce, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(input.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(input.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf-8');
}

export class KeyRotatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyRotatedError';
  }
}
