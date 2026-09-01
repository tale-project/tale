// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { verifySlackSignature } from './slack_signature';

const SIGNING_SECRET = '8f742231b10e8888abcd99yyyzzz85a5';
const NOW_MS = 1_700_000_000_000;
const TIMESTAMP = String(Math.floor(NOW_MS / 1000));

/** Sign a body exactly the way Slack does, for use as a valid fixture. */
async function slackSign(
  rawBody: string,
  timestamp = TIMESTAMP,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`v0:${timestamp}:${rawBody}`),
  );
  let hex = '';
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return `v0=${hex}`;
}

const BODY = JSON.stringify({ type: 'event_callback', team_id: 'T0SIGN001' });

describe('verifySlackSignature', () => {
  it('accepts a correctly signed, fresh delivery', async () => {
    const result = await verifySlackSignature({
      signingSecret: SIGNING_SECRET,
      signatureHeader: await slackSign(BODY),
      timestampHeader: TIMESTAMP,
      rawBody: BODY,
      nowMs: NOW_MS,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects a signature made with a different secret', async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('a-different-signing-secret'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const digest = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`v0:${TIMESTAMP}:${BODY}`),
    );
    let hex = '';
    for (const byte of new Uint8Array(digest)) {
      hex += byte.toString(16).padStart(2, '0');
    }

    const result = await verifySlackSignature({
      signingSecret: SIGNING_SECRET,
      signatureHeader: `v0=${hex}`,
      timestampHeader: TIMESTAMP,
      rawBody: BODY,
      nowMs: NOW_MS,
    });
    expect(result).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a tampered body under a valid signature', async () => {
    const signature = await slackSign(BODY);
    const result = await verifySlackSignature({
      signingSecret: SIGNING_SECRET,
      signatureHeader: signature,
      timestampHeader: TIMESTAMP,
      rawBody: BODY.replace('T0SIGN001', 'T0SIGN666'),
      nowMs: NOW_MS,
    });
    expect(result).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a delivery older than the five-minute replay window', async () => {
    const staleTimestamp = String(Math.floor(NOW_MS / 1000) - 301);
    const result = await verifySlackSignature({
      signingSecret: SIGNING_SECRET,
      signatureHeader: await slackSign(BODY, staleTimestamp),
      timestampHeader: staleTimestamp,
      rawBody: BODY,
      nowMs: NOW_MS,
    });
    expect(result).toEqual({ ok: false, reason: 'stale' });
  });

  it('rejects a timestamp far in the future', async () => {
    const futureTimestamp = String(Math.floor(NOW_MS / 1000) + 3600);
    const result = await verifySlackSignature({
      signingSecret: SIGNING_SECRET,
      signatureHeader: await slackSign(BODY, futureTimestamp),
      timestampHeader: futureTimestamp,
      rawBody: BODY,
      nowMs: NOW_MS,
    });
    expect(result).toEqual({ ok: false, reason: 'stale' });
  });

  it('rejects a request with no signature or no timestamp header', async () => {
    await expect(
      verifySlackSignature({
        signingSecret: SIGNING_SECRET,
        signatureHeader: null,
        timestampHeader: TIMESTAMP,
        rawBody: BODY,
        nowMs: NOW_MS,
      }),
    ).resolves.toEqual({ ok: false, reason: 'missing' });

    await expect(
      verifySlackSignature({
        signingSecret: SIGNING_SECRET,
        signatureHeader: await slackSign(BODY),
        timestampHeader: null,
        rawBody: BODY,
        nowMs: NOW_MS,
      }),
    ).resolves.toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects a non-numeric timestamp instead of coercing it', async () => {
    // `Number.parseInt('1700000000abc')` succeeds; the whole header must be
    // digits, or the base string would not be the one Slack signed.
    const result = await verifySlackSignature({
      signingSecret: SIGNING_SECRET,
      signatureHeader: await slackSign(BODY, `${TIMESTAMP}abc`),
      timestampHeader: `${TIMESTAMP}abc`,
      rawBody: BODY,
      nowMs: NOW_MS,
    });
    expect(result).toEqual({ ok: false, reason: 'missing' });
  });

  /**
   * The raw-body contract. Slack signs the bytes it sent; a verifier that
   * parses the JSON and re-serializes it signs a different document. This test
   * fails for any implementation that does so — the two spellings of the same
   * object have identical semantics and different bytes.
   */
  it('verifies the RAW bytes, not a re-serialized parse of them', async () => {
    // Pretty-printed with a key order that JSON.stringify would not reproduce.
    const rawBody =
      '{\n  "team_id": "T0RAW001",\n  "type": "event_callback"\n}';
    const reserialized = JSON.stringify(JSON.parse(rawBody));
    expect(reserialized).not.toBe(rawBody);

    const signature = await slackSign(rawBody);

    await expect(
      verifySlackSignature({
        signingSecret: SIGNING_SECRET,
        signatureHeader: signature,
        timestampHeader: TIMESTAMP,
        rawBody,
        nowMs: NOW_MS,
      }),
    ).resolves.toEqual({ ok: true });

    // The same delivery, verified against the re-serialized form, must NOT
    // pass — proving the check is byte-exact rather than semantic.
    await expect(
      verifySlackSignature({
        signingSecret: SIGNING_SECRET,
        signatureHeader: signature,
        timestampHeader: TIMESTAMP,
        rawBody: reserialized,
        nowMs: NOW_MS,
      }),
    ).resolves.toEqual({ ok: false, reason: 'mismatch' });
  });
});
