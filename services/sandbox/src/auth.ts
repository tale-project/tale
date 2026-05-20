// HMAC-SHA256 request authentication.
//
// Convex (the only legitimate client) signs each request with the shared
// SANDBOX_TOKEN; spawner verifies before accepting. Reachable only on the
// internal Docker network anyway; HMAC is defense-in-depth so a
// misconfigured deployment that exposes :8003 doesn't immediately leak.
//
// The signature is bound to method, path, timestamp, AND body hash:
//
//   signedString = `${method}\n${path}\n${timestamp}\n${sha256Hex(body)}`
//   signature    = HMAC-SHA256(SANDBOX_TOKEN, signedString)
//
// Binding method+path stops a captured /v1/execute signature from being
// replayed against /v1/cancel/:id (or vice-versa). Binding the timestamp
// and rejecting drift >60s caps the replay window even if the proxy logs
// or the network captures leak a request. Binding the body hash (rather
// than the raw body) keeps the signed string short.

import { timingSafeEqual, createHmac, createHash } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-tale-sandbox-signature';
export const TIMESTAMP_HEADER = 'x-tale-sandbox-timestamp';

// Tolerance for clock skew + request travel. Convex actions and the
// spawner share a host clock in our compose deployments, so 60s is
// extremely generous. Tighter than that risks false negatives on dev
// laptops where a few seconds of NTP drift is normal.
export const TIMESTAMP_TOLERANCE_MS = 60_000;

export function buildSignedString(
  method: string,
  path: string,
  timestamp: string,
  body: string,
): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`;
}

export function sign(
  method: string,
  path: string,
  timestamp: string,
  body: string,
  token: string,
): string {
  const signedString = buildSignedString(method, path, timestamp, body);
  return createHmac('sha256', token).update(signedString).digest('hex');
}

export interface VerifyResult {
  ok: boolean;
  reason?:
    | 'missing_signature'
    | 'missing_timestamp'
    | 'bad_timestamp'
    | 'timestamp_skew'
    | 'bad_signature';
}

export function verify(
  method: string,
  path: string,
  body: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  token: string,
  nowMs: number = Date.now(),
): VerifyResult {
  if (!signatureHeader) return { ok: false, reason: 'missing_signature' };
  if (!timestampHeader) return { ok: false, reason: 'missing_timestamp' };
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts) || ts <= 0) {
    return { ok: false, reason: 'bad_timestamp' };
  }
  if (Math.abs(nowMs - ts) > TIMESTAMP_TOLERANCE_MS) {
    return { ok: false, reason: 'timestamp_skew' };
  }
  const expected = sign(method, path, timestampHeader, body, token);
  if (expected.length !== signatureHeader.length) {
    return { ok: false, reason: 'bad_signature' };
  }
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  try {
    return timingSafeEqual(a, b)
      ? { ok: true }
      : { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
}
