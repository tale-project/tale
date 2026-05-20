// HMAC-SHA256 body authentication.
//
// Convex (the only legitimate client) signs the raw request body with the
// shared SANDBOX_TOKEN; spawner verifies before accepting. Reachable only
// on the internal Docker network anyway; HMAC is defense-in-depth so a
// misconfigured deployment that exposes :8003 doesn't immediately leak.

import { timingSafeEqual, createHmac } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-tale-sandbox-signature';

function sign(body: string, token: string): string {
  return createHmac('sha256', token).update(body).digest('hex');
}

export function verify(
  body: string,
  signatureHeader: string | null,
  token: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = sign(body, token);
  if (expected.length !== signatureHeader.length) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
