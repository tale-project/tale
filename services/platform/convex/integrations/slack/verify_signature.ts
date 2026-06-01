/**
 * Slack request signature verification (Events API / interactivity / slash).
 *
 * Slack signs each request with `v0=HMAC_SHA256(signingSecret, "v0:{ts}:{body}")`
 * in the `X-Slack-Signature` header, plus `X-Slack-Request-Timestamp`. We verify
 * the HMAC over the EXACT raw request bytes (so callers must read the body as
 * text before parsing) and reject stale timestamps to block replay.
 *
 * Pure (no Convex ctx), Web Crypto only, so it runs in the httpAction V8 runtime.
 */

const SLACK_SIGNATURE_VERSION = 'v0';
const DEFAULT_TOLERANCE_SEC = 300; // ±5 min, per Slack's guidance

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'stale' | 'mismatch' };

/** Length-checked constant-time string compare (avoids signature timing leaks). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export async function verifySlackSignature(args: {
  signingSecret: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  rawBody: string;
  nowMs?: number;
  toleranceSec?: number;
}): Promise<VerifyResult> {
  const { signingSecret, signatureHeader, timestampHeader, rawBody } = args;
  const nowMs = args.nowMs ?? Date.now();
  const toleranceSec = args.toleranceSec ?? DEFAULT_TOLERANCE_SEC;

  if (!signatureHeader || !timestampHeader) {
    return { ok: false, reason: 'missing' };
  }

  const timestamp = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: 'missing' };
  }
  if (Math.abs(nowMs - timestamp * 1000) > toleranceSec * 1000) {
    return { ok: false, reason: 'stale' };
  }

  // Sign over the EXACT header value (not the re-stringified integer) so the
  // base string is byte-identical to what Slack signed.
  const basestring = `${SLACK_SIGNATURE_VERSION}:${timestampHeader}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(basestring),
  );
  const expected = `${SLACK_SIGNATURE_VERSION}=${toHex(signatureBuffer)}`;

  return timingSafeEqual(expected, signatureHeader)
    ? { ok: true }
    : { ok: false, reason: 'mismatch' };
}

// Exported for unit tests.
export const __test = { timingSafeEqual, toHex };
