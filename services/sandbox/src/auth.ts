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
// AND keeping a short-TTL nonce cache of seen signatures bounds the replay
// window: even within the clock-skew tolerance an attacker can't reuse a
// captured signature, because the second verify hits the cache and is
// rejected.

import { timingSafeEqual, createHmac, createHash } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-tale-sandbox-signature';
export const TIMESTAMP_HEADER = 'x-tale-sandbox-timestamp';

// Tolerance for clock skew + request travel. Convex actions and the
// spawner share a host clock in our compose deployments; 30s is tight
// enough to bound the replay window and loose enough to absorb a few
// seconds of NTP drift on dev laptops.
export const TIMESTAMP_TOLERANCE_MS = 30_000;

// Nonce cache TTL — slightly longer than the timestamp tolerance so a
// just-accepted signature stays remembered until its own timestamp ages out
// of the skew window. After TTL the entry expires and the signature
// could in principle be accepted again, but by then `timestamp_skew`
// rejects it first.
export const NONCE_TTL_MS = TIMESTAMP_TOLERANCE_MS + 5_000;

// Periodic sweep cadence — every Nth verify call we drop expired entries
// so the cache size stays bounded under high request volume. The cap is
// loose since each entry is tiny (sha256 hex + a Date.now() number).
const NONCE_SWEEP_INTERVAL = 100;
const seenSignatures = new Map<string, number>();
let verifyCallsSinceSweep = 0;

function maybeSweepNonces(now: number): void {
  verifyCallsSinceSweep += 1;
  if (verifyCallsSinceSweep < NONCE_SWEEP_INTERVAL) return;
  verifyCallsSinceSweep = 0;
  for (const [sig, expiresAt] of seenSignatures) {
    if (expiresAt <= now) seenSignatures.delete(sig);
  }
}

/** Exposed for tests; do NOT call from production code. */
export function _resetNonceCacheForTests(): void {
  seenSignatures.clear();
  verifyCallsSinceSweep = 0;
}

function buildSignedString(
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

interface VerifyResult {
  ok: boolean;
  reason?:
    | 'missing_signature'
    | 'missing_timestamp'
    | 'bad_timestamp'
    | 'timestamp_skew'
    | 'bad_signature'
    | 'replay';
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
  let equal: boolean;
  try {
    equal = timingSafeEqual(a, b);
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
  if (!equal) return { ok: false, reason: 'bad_signature' };

  // Signature is structurally valid AND within the skew window. Now check
  // the nonce cache to block replay-within-window.
  maybeSweepNonces(nowMs);
  const cached = seenSignatures.get(signatureHeader);
  if (cached !== undefined && cached > nowMs) {
    return { ok: false, reason: 'replay' };
  }
  seenSignatures.set(signatureHeader, nowMs + NONCE_TTL_MS);
  return { ok: true };
}
