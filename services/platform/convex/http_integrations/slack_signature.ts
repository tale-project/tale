/**
 * Verification of an inbound Slack request signature.
 *
 * Slack signs every delivery as
 * `v0=HMAC_SHA256(signingSecret, "v0:<timestamp>:<rawBody>")` and sends the
 * digest in `X-Slack-Signature` with the timestamp in
 * `X-Slack-Request-Timestamp`. Three properties matter, and all three are
 * structural here:
 *
 *  - the base string is built from the RAW bytes. A handler that parses the
 *    body first and re-serializes it signs a DIFFERENT document — key order,
 *    spacing and number formatting all change — so it either rejects every
 *    genuine delivery or, worse, is written to tolerate the difference and
 *    stops verifying anything. Callers pass `await req.text()` and parse
 *    afterwards.
 *  - the comparison is constant time, so a caller cannot walk the digest one
 *    byte at a time by measuring how long a rejection takes.
 *  - deliveries older than five minutes are refused, which is what stops a
 *    captured request from being replayed forever.
 *
 * Web Crypto only, so it runs unchanged in the V8 HTTP-action runtime. The
 * repo's other HMAC helper (`webdav/helpers.ts`) hex-DECODES its key, which is
 * right for a generated 256-bit deployment secret and wrong for Slack's
 * signing secret — Slack keys the HMAC with the secret's UTF-8 bytes — so only
 * its constant-time compare is reused here.
 */

import { timingSafeEqual } from '../webdav/helpers';

const SIGNATURE_VERSION = 'v0';

/** Slack's own guidance: refuse anything more than five minutes old. */
const REPLAY_TOLERANCE_SEC = 300;

/**
 * A signed body larger than this is not a Slack event. Bounding it keeps a
 * flood of oversized payloads from turning signature checking into the
 * expensive part of the request.
 */
export const SLACK_MAX_BODY_BYTES = 1024 * 1024;

export type SlackSignatureFailure =
  /** Header missing or unparseable — the request was never signed. */
  | 'missing'
  /** Outside the replay window. */
  | 'stale'
  /** Signed, but not by this app's signing secret (or the body was altered). */
  | 'mismatch';

export type SlackSignatureResult =
  | { ok: true }
  | { ok: false; reason: SlackSignatureFailure };

function toHex(buffer: ArrayBuffer): string {
  let hex = '';
  for (const byte of new Uint8Array(buffer)) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export interface VerifySlackSignatureArgs {
  readonly signingSecret: string;
  readonly signatureHeader: string | null;
  readonly timestampHeader: string | null;
  /** The exact request body text, read BEFORE any parsing. */
  readonly rawBody: string;
  readonly nowMs?: number;
}

/** Verify one delivery. Never throws — every outcome is a typed result. */
export async function verifySlackSignature(
  args: VerifySlackSignatureArgs,
): Promise<SlackSignatureResult> {
  const { signatureHeader, timestampHeader, rawBody } = args;
  if (!signatureHeader || !timestampHeader) {
    return { ok: false, reason: 'missing' };
  }

  // Only digits: `Number.parseInt` would happily read "12345abc" as a valid
  // timestamp, and the base string must be the header's exact characters.
  if (!/^\d{1,15}$/.test(timestampHeader)) {
    return { ok: false, reason: 'missing' };
  }
  const nowMs = args.nowMs ?? Date.now();
  const skewMs = Math.abs(nowMs - Number(timestampHeader) * 1000);
  if (skewMs > REPLAY_TOLERANCE_SEC * 1000) {
    return { ok: false, reason: 'stale' };
  }

  // The timestamp is interpolated as the raw HEADER text, not as a
  // re-formatted number, so the base string is byte-identical to Slack's.
  const baseString = `${SIGNATURE_VERSION}:${timestampHeader}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(args.signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(baseString),
  );
  const expected = `${SIGNATURE_VERSION}=${toHex(digest)}`;

  return timingSafeEqual(expected, signatureHeader)
    ? { ok: true }
    : { ok: false, reason: 'mismatch' };
}
