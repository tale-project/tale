// The one-run host-call capability token: sign → verify round trip, expiry,
// tamper resistance, and the unconfigured-deployment refusal. Mirrors the
// stage-token suite's posture: the verifier is the security boundary of the
// /api/connectors/hostcall route.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HOSTCALL_TOKEN_TTL_MS,
  hostcallSigningAvailable,
  signHostcallToken,
  verifyHostcallToken,
} from './hostcall_token';

const ROOT = 'r'.repeat(64);

beforeEach(() => {
  vi.stubEnv('WEBDAV_APP_PASSWORD_HMAC_KEY', ROOT);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const CLAIMS = {
  org: 'org_1',
  connector: 'tavily',
  action: 'search',
  credentialRef: 'primary',
};

describe('hostcall token', () => {
  it('round-trips its claims', async () => {
    const token = await signHostcallToken(CLAIMS, 1_000);
    expect(token).not.toBeNull();

    const verdict = await verifyHostcallToken(token ?? '', 2_000);
    expect(verdict).toEqual({
      ok: true,
      payload: { ...CLAIMS, exp: 1_000 + HOSTCALL_TOKEN_TTL_MS },
    });
  });

  it('expires', async () => {
    const token = await signHostcallToken(CLAIMS, 1_000);
    const verdict = await verifyHostcallToken(
      token ?? '',
      1_000 + HOSTCALL_TOKEN_TTL_MS + 1,
    );
    expect(verdict).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses a tampered payload', async () => {
    const token = await signHostcallToken(CLAIMS, 1_000);
    const [version, , sig] = (token ?? '').split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...CLAIMS, org: 'org_evil', exp: 9_999_999_999_999 }),
      'utf8',
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const verdict = await verifyHostcallToken(`${version}.${forged}.${sig}`);
    expect(verdict).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses garbage and reports an unconfigured deployment', async () => {
    expect(await verifyHostcallToken('not-a-token')).toEqual({
      ok: false,
      reason: 'malformed',
    });

    vi.stubEnv('WEBDAV_APP_PASSWORD_HMAC_KEY', '');
    expect(hostcallSigningAvailable()).toBe(false);
    expect(await signHostcallToken(CLAIMS)).toBeNull();
    expect(await verifyHostcallToken('v1.x.y')).toEqual({
      ok: false,
      reason: 'unconfigured',
    });
  });
});
