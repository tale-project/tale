import { createHmac } from 'node:crypto';

/**
 * Dependency-free RFC-6238 TOTP, matching Better Auth's twoFactor plugin
 * config (`convex/auth.ts`: base32 secret, HMAC-SHA1, 6 digits, 30s period).
 * Lets the 2FA spec close the loop the old suite left open (enroll → reveal
 * secret → STOP) by generating a valid code to verify enrollment and to pass
 * the sign-in challenge. No `otplib`/`speakeasy` dependency.
 *
 * Better Auth verifies with a ±1 period window, so a code generated at "now" is
 * accepted across a clock skew of up to one step. Callers near a 30s boundary
 * should still wrap submit in a `toPass` retry (regenerate per attempt) — the
 * helper is pure, so each call re-derives the current code.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/=+$/, '').toUpperCase().replace(/\s+/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotp(
  secret: string,
  atMs: number = Date.now(),
  period = 30,
  digits = 6,
): string {
  const counter = Math.floor(atMs / 1000 / period);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', base32Decode(secret))
    .update(counterBuffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, '0');
}
