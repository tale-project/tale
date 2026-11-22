// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  isRelayProxyUrl,
  RELAY_POT_PATH,
  relayPotBaseUrl,
  relayProxyUrl,
} from './relay';
import {
  signVideoRelayToken,
  verifyVideoRelayToken,
  VIDEO_RELAY_GRANT_TTL_MS,
  videoProxyDigest,
  type VideoRelayGrant,
} from './relay_token';

/**
 * A sandbox session shows the platform's relays a token for one video
 * (tale-project/tale#4942): one job, one use, and gone with the job.
 */

const ROOT = 'a'.repeat(64);
const ENV = { WEBDAV_APP_PASSWORD_HMAC_KEY: ROOT };
const NOW = 1_800_000_000_000;
const PROXY = 'socks5h://user-1:secret@residential.example:1080';

const proxyGrant: VideoRelayGrant = {
  use: 'proxy',
  job: 'job-1',
  proxy: videoProxyDigest(PROXY),
  exp: NOW + 60_000,
};
const potGrant: VideoRelayGrant = { use: 'pot', job: 'job-1', exp: NOW + 1 };

function signed(grant: VideoRelayGrant, env = ENV): string {
  const token = signVideoRelayToken(grant, env);
  if (token === null) throw new Error('no key to sign with');
  return token;
}

describe('a video relay token', () => {
  it.each([proxyGrant, potGrant])(
    'carries its grant back to whoever holds the key ($use)',
    (grant) => {
      const token = signed(grant);

      expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(verifyVideoRelayToken(token, ENV, NOW)).toEqual(grant);
    },
  );

  it('is one of nothing once it has expired', () => {
    const token = signed(potGrant);

    expect(verifyVideoRelayToken(token, ENV, potGrant.exp - 1)).toEqual(
      potGrant,
    );
    expect(verifyVideoRelayToken(token, ENV, potGrant.exp)).toBeNull();
  });

  it('is refused under another key', () => {
    expect(
      verifyVideoRelayToken(
        signed(proxyGrant),
        { WEBDAV_APP_PASSWORD_HMAC_KEY: 'b'.repeat(64) },
        NOW,
      ),
    ).toBeNull();
  });

  it('is refused when its grant was changed after it was signed', () => {
    const [version, , signature] = signed(proxyGrant).split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...proxyGrant, job: 'job-2' }),
    ).toString('base64url');

    expect(
      verifyVideoRelayToken(`${version}.${forged}.${signature}`, ENV, NOW),
    ).toBeNull();
  });

  it.each([
    '',
    'v1',
    'v1.e30',
    'v2.e30.c2ln',
    'v1.e30.c2ln.more',
    'not a token',
  ])('is refused when it is %j', (token) => {
    expect(verifyVideoRelayToken(token, ENV, NOW)).toBeNull();
  });

  // Signed by this deployment and still nothing it would grant: the check
  // of the grant's shape is what stands between a signing bug and a relay.
  it.each([
    ['no job', { use: 'pot', job: '', exp: NOW + 1 }],
    ['no expiry', { use: 'pot', job: 'job-1' }],
    [
      'a use the relays do not know',
      { use: 'all', job: 'job-1', exp: NOW + 1 },
    ],
    [
      'a proxy grant that names no proxy',
      { use: 'proxy', job: 'job-1', exp: NOW + 1 },
    ],
    [
      'a proxy that is no digest',
      { use: 'proxy', job: 'job-1', proxy: PROXY, exp: NOW + 1 },
    ],
  ])('grants nothing for a signed payload with %s', (_name, payload) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a payload this module would never sign, to test the reader
    const token = signed(payload as unknown as VideoRelayGrant);

    expect(verifyVideoRelayToken(token, ENV, NOW)).toBeNull();
  });

  it('is neither signed nor believed where the deployment has no key', () => {
    for (const env of [{}, { WEBDAV_APP_PASSWORD_HMAC_KEY: 'short' }]) {
      expect(signVideoRelayToken(proxyGrant, env)).toBeNull();
      expect(verifyVideoRelayToken(signed(proxyGrant), env, NOW)).toBeNull();
    }
  });

  it('names a proxy by its entry as written, and nothing of it', () => {
    expect(videoProxyDigest(PROXY)).toMatch(/^[0-9a-f]{32}$/);
    expect(videoProxyDigest(PROXY)).toBe(videoProxyDigest(PROXY));
    expect(videoProxyDigest(PROXY)).not.toBe(
      videoProxyDigest(PROXY.replace('user-1', 'user-2')),
    );
  });
});

describe('the addresses a session is given', () => {
  it('stands the API listener in for a proxy, with a token for that proxy and job', () => {
    const url = relayProxyUrl(PROXY, 'job-1', ENV, NOW);

    expect(url).toMatch(/^http:\/\/tale:v1\.[A-Za-z0-9_.-]+@backend-api:3005$/);
    const token = new URL(url ?? '').password;
    expect(verifyVideoRelayToken(token, ENV, NOW)).toEqual({
      use: 'proxy',
      job: 'job-1',
      proxy: videoProxyDigest(PROXY),
      exp: NOW + VIDEO_RELAY_GRANT_TTL_MS,
    });
    // Nothing of the proxy itself: not its host, not its credentials.
    expect(url).not.toContain('residential');
    expect(url).not.toContain('secret');
    expect(isRelayProxyUrl(url ?? '', ENV)).toBe(true);
  });

  it('names the PO-token provider by a route of the listener, with a token for the job', () => {
    const url = relayPotBaseUrl('job-1', ENV, NOW);

    expect(
      url?.startsWith(`http://backend-api:3005${RELAY_POT_PATH}/v1.`),
    ).toBe(true);
    // yt-dlp splits extractor arguments at these: none may be in a base URL.
    expect(url).not.toMatch(/[,;= ]/);
    expect(
      verifyVideoRelayToken(url?.split('/').at(-1) ?? '', ENV, NOW),
    ).toEqual({
      use: 'pot',
      job: 'job-1',
      exp: NOW + VIDEO_RELAY_GRANT_TTL_MS,
    });
  });

  it('follows the address the deployment gives its sessions', () => {
    const env = {
      ...ENV,
      SANDBOX_HTTP_API_BASE_URL: 'http://10.30.1.4:3005',
    };

    expect(relayProxyUrl(PROXY, 'job-1', env, NOW)).toContain(
      '@10.30.1.4:3005',
    );
    expect(
      relayPotBaseUrl('job-1', env, NOW)?.startsWith('http://10.30.1.4:3005/'),
    ).toBe(true);
    expect(
      isRelayProxyUrl(relayProxyUrl(PROXY, 'job-1', env, NOW) ?? '', env),
    ).toBe(true);
    // The default listener's relay URL is not this deployment's.
    expect(
      isRelayProxyUrl(relayProxyUrl(PROXY, 'job-1', ENV, NOW) ?? '', env),
    ).toBe(false);
  });

  it('gives no address where no token can be signed', () => {
    expect(relayProxyUrl(PROXY, 'job-1', {}, NOW)).toBeNull();
    expect(relayPotBaseUrl('job-1', {}, NOW)).toBeNull();
  });

  it.each([
    'http://sandbox-egress:3128',
    'socks5h://tale:x@backend-api:3005',
    'http://someone:x@backend-api:3005',
    'not a url',
  ])('does not take %s for the relay', (url) => {
    expect(isRelayProxyUrl(url, ENV)).toBe(false);
  });
});
