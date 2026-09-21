/**
 * Encryption for the tokens this gateway stores.
 *
 * A stored token spends its owner's subscription, so it never touches disk in
 * the clear: AES-256-GCM under `AI_GATEWAY_ENCRYPTION_KEY`, sealed on write
 * and opened only to hand the token to a caller or to call the vendor. The
 * authentication tag makes a tampered file fail loudly rather than decrypt to
 * something plausible.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
/** GCM's standard nonce length. */
const IV_BYTES = 12;
/**
 * GCM's full tag length, pinned rather than left to the default.
 *
 * Node accepts a tag of 4 to 16 bytes unless told otherwise, so a decipher
 * that does not state the length will happily verify a truncated one — and a
 * 4-byte tag is forgeable. Both halves declare 16.
 */
const AUTH_TAG_BYTES = 16;
/** The key length AES-256 takes. */
const KEY_BYTES = 32;
/** Format marker, so a future algorithm change can read old records. */
const VERSION = 'v1';

export class CipherError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CipherError';
  }
}

export interface TokenCipher {
  seal(plaintext: string): string;
  open(sealed: string): string;
}

/**
 * Deliberately NOT named `createCipher`: that is a deprecated Node function
 * which derives its own IV and is unsafe under GCM, and a local helper
 * wearing its name reads like a call to it at every site.
 */
export function createTokenCipher(key: Buffer): TokenCipher {
  if (key.length !== KEY_BYTES) {
    throw new CipherError('An AES-256-GCM key must be 32 bytes.');
  }

  return {
    seal(plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_BYTES,
      });
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);
      return [
        VERSION,
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        ciphertext.toString('base64url'),
      ].join('.');
    },

    open(sealed) {
      const [version, ivPart, tagPart, ciphertextPart] = sealed.split('.');
      if (
        version !== VERSION ||
        ivPart === undefined ||
        tagPart === undefined ||
        ciphertextPart === undefined
      ) {
        throw new CipherError('The stored value is not a sealed token.');
      }
      const tag = Buffer.from(tagPart, 'base64url');
      if (tag.length !== AUTH_TAG_BYTES) {
        throw new CipherError('The stored value carries a truncated tag.');
      }

      try {
        const decipher = createDecipheriv(
          ALGORITHM,
          key,
          Buffer.from(ivPart, 'base64url'),
          { authTagLength: AUTH_TAG_BYTES },
        );
        decipher.setAuthTag(tag);
        return Buffer.concat([
          decipher.update(Buffer.from(ciphertextPart, 'base64url')),
          decipher.final(),
        ]).toString('utf8');
      } catch (error) {
        throw new CipherError(
          'The stored token could not be decrypted with this key.',
          { cause: error },
        );
      }
    },
  };
}

/**
 * Compare two secrets without leaking their contents through timing.
 *
 * Length alone is not secret-bearing here, but `timingSafeEqual` throws on a
 * length mismatch, so unequal lengths short-circuit to false first.
 */
export function secretsMatch(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
