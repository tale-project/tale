/**
 * HMAC-SHA256 pseudonymisation for personalization audit log.
 *
 * Why pseudonymise: org admins can read audit log rows for compliance
 * (counts, timing, action distribution), but must NOT be able to identify
 * which row belongs to which user. The HMAC pepper is server-side; without
 * it, an admin with audit-log read access cannot run a candidate userId
 * through the same hash.
 *
 * Crypto-shred semantics: rotating `PERSONALIZATION_AUDIT_PEPPER` makes all
 * historic `subjectUserIdHmac` values un-correlatable to any new candidate
 * userId. Useful as a "soft erase" for the audit linkability when users
 * delete accounts.
 *
 * Uses Web Crypto API (V8-compatible) so this can be called from Convex
 * mutations and queries without requiring `'use node'`. The pattern matches
 * the existing `signValue` helper in
 * `services/platform/convex/sso_providers/sign_cookie_value.ts`.
 */

const PEPPER_ENV = 'PERSONALIZATION_AUDIT_PEPPER';
const DEV_FALLBACK_PEPPER = 'tale-dev-personalization-pepper';
let warnedAboutMissingPepper = false;

function getPepper(): string {
  const pepper = process.env[PEPPER_ENV];
  if (pepper && pepper.length > 0) return pepper;
  if (!warnedAboutMissingPepper) {
    console.warn(
      `[personalization] ${PEPPER_ENV} not set — audit-log subject pseudonyms ` +
        `are using a non-secret development pepper. Set this in production to ` +
        `protect admin-blind contract.`,
    );
    warnedAboutMissingPepper = true;
  }
  return DEV_FALLBACK_PEPPER;
}

/**
 * Produce the audit-log subject pseudonym for a userId. Deterministic for the
 * lifetime of the pepper; rotating the pepper severs the link.
 */
export async function hmacUserId(userId: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getPepper()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(userId),
  );
  const bytes = new Uint8Array(sigBuffer);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}
