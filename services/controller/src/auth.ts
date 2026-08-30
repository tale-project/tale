// HMAC request authentication for the controller.
//
// The backend caller signs `${timestamp}.${rawBody}` with a shared
// secret (CONTROLLER_TOKEN); we verify with a constant-time compare and reject
// stale timestamps. Mirrors the sandbox spawner's trust model — the only
// thing that should ever reach this socket-holding service is a signed request
// from inside the internal network.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-controller-signature';
export const TIMESTAMP_HEADER = 'x-controller-timestamp';

/** Reject timestamps more than this far from now (replay / clock-skew guard). */
const MAX_SKEW_MS = 60_000;

function sign(token: string, timestamp: string, body: string): string {
  return createHmac('sha256', token)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}

export function verify(
  token: string,
  timestamp: string | null,
  signature: string | null,
  body: string,
): boolean {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS)
    return false;
  const expected = sign(token, timestamp, body);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
