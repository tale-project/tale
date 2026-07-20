// Stage-token contract: sign/verify round-trip, tamper + expiry + key-absence
// rejection, and the sandbox-reachable URL builder. Pure Web-Crypto — the env
// is the only seam, stubbed per test.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildSandboxBlobStageUrl,
  STAGE_TOKEN_TTL_MS,
  signStageToken,
  stageTokenSigningAvailable,
  verifyStageToken,
} from './sandbox_stage_token';

const KEY_ENV = 'WEBDAV_APP_PASSWORD_HMAC_KEY';
const KEY = 'ab'.repeat(32); // 64 hex chars
const OTHER_KEY = 'cd'.repeat(32);
const REF = 's3:org-abc/files/big.bin';
const ORG = 'org-abc';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('signStageToken / verifyStageToken', () => {
  it('round-trips ref, org, and expiry', async () => {
    vi.stubEnv(KEY_ENV, KEY);
    const now = 1_700_000_000_000;
    const token = await signStageToken({ ref: REF, org: ORG }, now);
    expect(token).not.toBeNull();
    const verdict = await verifyStageToken(token ?? '', now + 1);
    expect(verdict).toEqual({
      ok: true,
      payload: { ref: REF, org: ORG, exp: now + STAGE_TOKEN_TTL_MS },
    });
  });

  it('rejects an expired token', async () => {
    vi.stubEnv(KEY_ENV, KEY);
    const now = 1_700_000_000_000;
    const token = (await signStageToken({ ref: REF, org: ORG }, now)) ?? '';
    const verdict = await verifyStageToken(token, now + STAGE_TOKEN_TTL_MS);
    expect(verdict).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a payload swap (signature no longer matches)', async () => {
    vi.stubEnv(KEY_ENV, KEY);
    const token = (await signStageToken({ ref: REF, org: ORG })) ?? '';
    const [version, , sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ref: 's3:victim/secret.bin', org: 'victim', exp: 9e15 }),
      'utf8',
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const verdict = await verifyStageToken(`${version}.${forged}.${sig}`);
    expect(verdict).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a tampered signature and malformed tokens', async () => {
    vi.stubEnv(KEY_ENV, KEY);
    const token = (await signStageToken({ ref: REF, org: ORG })) ?? '';
    // Flip a mid-signature base64url char — the trailing char of a 32-byte
    // HMAC encoding only carries padding bits, so A↔B there often leaves the
    // decoded bytes unchanged and the token still verifies.
    const [version, payloadB64, sigB64 = ''] = token.split('.');
    const mid = Math.floor(sigB64.length / 2);
    const flippedSig =
      sigB64.slice(0, mid) +
      (sigB64[mid] === 'A' ? 'B' : 'A') +
      sigB64.slice(mid + 1);
    const flipped = `${version}.${payloadB64}.${flippedSig}`;
    expect((await verifyStageToken(flipped)).ok).toBe(false);
    expect(await verifyStageToken('')).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(await verifyStageToken('v1.only-two')).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(await verifyStageToken('v2.a.b')).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects a token minted under a different key', async () => {
    vi.stubEnv(KEY_ENV, OTHER_KEY);
    const token = (await signStageToken({ ref: REF, org: ORG })) ?? '';
    vi.stubEnv(KEY_ENV, KEY);
    const verdict = await verifyStageToken(token);
    expect(verdict).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses to sign or verify without a usable HMAC root', async () => {
    vi.stubEnv(KEY_ENV, '');
    expect(stageTokenSigningAvailable()).toBe(false);
    expect(await signStageToken({ ref: REF, org: ORG })).toBeNull();
    expect(await verifyStageToken('v1.a.b')).toEqual({
      ok: false,
      reason: 'unconfigured',
    });
    // A too-short root is as good as none — refuse rather than sign weakly.
    vi.stubEnv(KEY_ENV, 'ab'.repeat(8));
    expect(stageTokenSigningAvailable()).toBe(false);
    expect(await signStageToken({ ref: REF, org: ORG })).toBeNull();
  });
});

describe('buildSandboxBlobStageUrl', () => {
  it('builds a token URL on the sandbox-visible http-actions origin', async () => {
    vi.stubEnv(KEY_ENV, KEY);
    vi.stubEnv('SANDBOX_HTTP_API_BASE_URL', 'http://convex-test:9999/');
    const url = await buildSandboxBlobStageUrl(REF, ORG);
    expect(url).not.toBeNull();
    const parsed = new URL(url ?? '');
    expect(parsed.origin).toBe('http://convex-test:9999');
    expect(parsed.pathname).toBe('/api/sandbox-blob');
    const verdict = await verifyStageToken(
      parsed.searchParams.get('token') ?? '',
    );
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.payload.ref).toBe(REF);
      expect(verdict.payload.org).toBe(ORG);
    }
  });

  it('defaults to the convex:3211 alias', async () => {
    vi.stubEnv(KEY_ENV, KEY);
    const url = await buildSandboxBlobStageUrl(REF, ORG);
    expect(url ?? '').toMatch(/^http:\/\/convex:3211\/api\/sandbox-blob\?/);
  });

  it('returns null when the deployment cannot sign', async () => {
    vi.stubEnv(KEY_ENV, '');
    expect(await buildSandboxBlobStageUrl(REF, ORG)).toBeNull();
  });
});
