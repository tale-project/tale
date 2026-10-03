import { createHash, createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signStageToken, verifyStageToken } from './sandbox_stage_token';

describe('sandbox stage token byte capability', () => {
  beforeEach(() => {
    vi.stubEnv('WEBDAV_APP_PASSWORD_HMAC_KEY', 'a'.repeat(64));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('preserves the v1 wire payload for ordinary callers', async () => {
    const token = await signStageToken({ ref: 's3:acme/blob', org: 'org' }, 10);
    expect(token).toMatch(/^v1\./);
    expect(
      JSON.parse(Buffer.from(token!.split('.')[1]!, 'base64url').toString()),
    ).toEqual({
      ref: 's3:acme/blob',
      org: 'org',
      exp: 600010,
    });
    expect(await verifyStageToken(token!, 11)).toEqual({
      ok: true,
      payload: {
        ref: 's3:acme/blob',
        org: 'org',
        exp: 600010,
      },
    });
  });

  it('binds a bounded transfer to a version an old v1-only consumer refuses', async () => {
    const token = await signStageToken(
      { ref: 's3:acme/blob', org: 'org', maxBytes: 20 },
      10,
    );
    expect(token).toMatch(/^v2\./);
    expect(await verifyStageToken(token!, 11)).toEqual({
      ok: true,
      payload: {
        ref: 's3:acme/blob',
        org: 'org',
        exp: 600010,
        maxBytes: 20,
      },
    });
    expect(
      await verifyStageToken(token!.replace(/^v2/, 'v1'), 11),
    ).toMatchObject({ ok: false });
    const parts = token!.split('.');
    parts[1] = Buffer.from(
      JSON.stringify({
        ref: 's3:acme/blob',
        org: 'org',
        exp: 600010,
        maxBytes: 21,
      }),
    ).toString('base64url');
    expect(await verifyStageToken(parts.join('.'), 11)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('does not mint an invalid cap %s', async (maxBytes) => {
    await expect(
      signStageToken({ ref: 's3:acme/blob', org: 'org', maxBytes }, 10),
    ).rejects.toThrow();
  });

  it.each([0, 4])(
    'binds the exact expected size %s without weakening the cap',
    async (expectedBytes) => {
      const token = await signStageToken(
        {
          ref: 's3:acme/blob',
          org: 'org',
          maxBytes: 4,
          expectedBytes,
        },
        10,
      );
      expect(token).toMatch(/^v2\./);
      expect(await verifyStageToken(token!, 11)).toMatchObject({
        ok: true,
        payload: { maxBytes: 4, expectedBytes },
      });
      const parts = token!.split('.');
      const payload = JSON.parse(
        Buffer.from(parts[1]!, 'base64url').toString(),
      );
      payload.expectedBytes = expectedBytes === 0 ? 1 : 3;
      parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
      expect(await verifyStageToken(parts.join('.'), 11)).toEqual({
        ok: false,
        reason: 'bad_signature',
      });
    },
  );

  it.each([
    -1,
    1.5,
    5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('refuses invalid expected bytes %s', async (expectedBytes) => {
    await expect(
      signStageToken(
        { ref: 's3:acme/blob', org: 'org', maxBytes: 4, expectedBytes },
        10,
      ),
    ).rejects.toThrow();
  });

  it('refuses an expected size without a signed ceiling', async () => {
    await expect(
      signStageToken({ ref: 's3:acme/blob', org: 'org', expectedBytes: 0 }, 10),
    ).rejects.toThrow();
  });

  it.each([
    { version: 'v2', fields: { maxBytes: 4, expectedBytes: -1 } },
    { version: 'v2', fields: { maxBytes: 4, expectedBytes: 1.5 } },
    { version: 'v2', fields: { maxBytes: 4, expectedBytes: 5 } },
    { version: 'v2', fields: { maxBytes: 4, expectedBytes: null } },
    { version: 'v2', fields: { expectedBytes: 0 } },
    { version: 'v1', fields: { expectedBytes: 0 } },
  ])(
    'rejects a signed but invalid expected-size payload %j',
    async ({ version, fields }) => {
      const payload = Buffer.from(
        JSON.stringify({
          ref: 's3:acme/blob',
          org: 'org',
          exp: 600010,
          ...fields,
        }),
      ).toString('base64url');
      const message = `${version}.${payload}`;
      const key = createHash('sha256')
        .update(`${'a'.repeat(64)}:sandbox-blob-stage:v1`)
        .digest();
      const signature = createHmac('sha256', key)
        .update(message)
        .digest('base64url');
      expect(await verifyStageToken(`${message}.${signature}`, 11)).toEqual({
        ok: false,
        reason: 'malformed',
      });
    },
  );
});
