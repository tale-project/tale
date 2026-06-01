import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifySlackSignature, __test } from './verify_signature';

const SECRET = 'test-signing-secret';
const BODY = '{"type":"event_callback","event_id":"Ev123"}';

function sign(secret: string, ts: number, body: string): string {
  return (
    'v0=' +
    createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')
  );
}

describe('verifySlackSignature', () => {
  const ts = 1_700_000_000;
  const nowMs = ts * 1000;

  it('accepts a valid signature within the freshness window', async () => {
    const result = await verifySlackSignature({
      signingSecret: SECRET,
      signatureHeader: sign(SECRET, ts, BODY),
      timestampHeader: String(ts),
      rawBody: BODY,
      nowMs,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a tampered body (mismatch)', async () => {
    const result = await verifySlackSignature({
      signingSecret: SECRET,
      signatureHeader: sign(SECRET, ts, BODY),
      timestampHeader: String(ts),
      rawBody: BODY + 'tampered',
      nowMs,
    });
    expect(result).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a wrong signing secret (mismatch)', async () => {
    const result = await verifySlackSignature({
      signingSecret: SECRET,
      signatureHeader: sign('other-secret', ts, BODY),
      timestampHeader: String(ts),
      rawBody: BODY,
      nowMs,
    });
    expect(result).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a stale timestamp (replay defense)', async () => {
    const result = await verifySlackSignature({
      signingSecret: SECRET,
      signatureHeader: sign(SECRET, ts, BODY),
      timestampHeader: String(ts),
      rawBody: BODY,
      nowMs: nowMs + 6 * 60 * 1000, // 6 min later, beyond the 5 min tolerance
    });
    expect(result).toEqual({ ok: false, reason: 'stale' });
  });

  it('rejects when headers are missing', async () => {
    const result = await verifySlackSignature({
      signingSecret: SECRET,
      signatureHeader: null,
      timestampHeader: String(ts),
      rawBody: BODY,
      nowMs,
    });
    expect(result).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('timingSafeEqual', () => {
  it('is true for equal strings and false otherwise', () => {
    expect(__test.timingSafeEqual('abc', 'abc')).toBe(true);
    expect(__test.timingSafeEqual('abc', 'abd')).toBe(false);
    expect(__test.timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});
