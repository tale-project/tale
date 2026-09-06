// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  publicBaseUrl,
  publicBaseUrlFor,
  publicHttpApiUrlFor,
  publicOrigin,
  siteOrigins,
} from './public_origin';

const INTERNAL_URL = 'http://backend-api:3005/api/sso/saml/acs?x=1';

/** A request as the proxy hands it to the backend: internal URL, public Host. */
function proxied(host: string, proto = 'https'): Request {
  return new Request(INTERNAL_URL, {
    headers: { host, 'x-forwarded-proto': proto },
  });
}

const ENV_KEYS = ['SITE_URL', 'ADDITIONAL_SITE_URLS', 'BASE_PATH'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('publicOrigin — browser-facing origin behind the reverse proxy', () => {
  it('prefers SITE_URL over the internal request origin', () => {
    // Behind Caddy TLS termination the request origin is the internal http
    // upstream; deriving the cookie name/redirect from it broke SAML logins
    // (unprefixed cookie + redirect to an unreachable host).
    process.env.SITE_URL = 'https://tale.example.com';
    expect(publicOrigin(new Request(INTERNAL_URL))).toBe(
      'https://tale.example.com',
    );
  });

  it('normalises a trailing slash on SITE_URL to a bare origin', () => {
    process.env.SITE_URL = 'https://tale.example.com/';
    expect(publicOrigin(new Request(INTERNAL_URL))).toBe(
      'https://tale.example.com',
    );
  });

  it('keeps an http SITE_URL http (cookie stays unprefixed, like Better Auth)', () => {
    process.env.SITE_URL = 'http://localhost:3000';
    expect(publicOrigin(new Request(INTERNAL_URL))).toBe(
      'http://localhost:3000',
    );
  });

  it('falls back to the request origin when SITE_URL is unset', () => {
    expect(publicOrigin(new Request(INTERNAL_URL))).toBe(
      'http://backend-api:3005',
    );
  });

  it('answers with the additional origin the browser is on', () => {
    process.env.SITE_URL = 'https://tale.example.com';
    process.env.ADDITIONAL_SITE_URLS = 'https://tale.partner.example';
    expect(publicOrigin(proxied('tale.partner.example'))).toBe(
      'https://tale.partner.example',
    );
    // The canonical domain keeps answering as itself.
    expect(publicOrigin(proxied('tale.example.com'))).toBe(
      'https://tale.example.com',
    );
  });

  it('never honours a Host outside the configured set (Host-header injection)', () => {
    process.env.SITE_URL = 'https://tale.example.com';
    process.env.ADDITIONAL_SITE_URLS = 'https://tale.partner.example';
    expect(publicOrigin(proxied('evil.example'))).toBe(
      'https://tale.example.com',
    );
    expect(publicOrigin(proxied('tale.partner.example', 'http'))).toBe(
      'https://tale.example.com',
    );
  });

  it('ignores the Host header entirely on a single-domain deployment', () => {
    // Exactly the pre-multi-domain behaviour: SITE_URL, whatever Host says.
    process.env.SITE_URL = 'https://tale.example.com';
    expect(publicOrigin(proxied('anything.example'))).toBe(
      'https://tale.example.com',
    );
  });
});

describe('siteOrigins / publicBaseUrl', () => {
  it('lists the canonical origin first, then the additional ones', () => {
    process.env.SITE_URL = 'https://tale.example.com/';
    process.env.ADDITIONAL_SITE_URLS =
      'https://tale.partner.example, https://tale.example.com';
    expect(siteOrigins()).toEqual([
      'https://tale.example.com',
      'https://tale.partner.example',
    ]);
  });

  it('is empty without SITE_URL', () => {
    process.env.ADDITIONAL_SITE_URLS = 'https://tale.partner.example';
    expect(siteOrigins()).toEqual([]);
  });

  it('builds the base URL on the request origin plus BASE_PATH', () => {
    process.env.SITE_URL = 'https://tale.example.com';
    process.env.ADDITIONAL_SITE_URLS = 'https://tale.partner.example';
    process.env.BASE_PATH = '/app/';
    expect(publicBaseUrl(proxied('tale.partner.example'))).toBe(
      'https://tale.partner.example/app',
    );
    expect(publicBaseUrl(new Request(INTERNAL_URL))).toBe(
      'https://tale.example.com/app',
    );
    expect(publicBaseUrlFor('https://tale.partner.example')).toBe(
      'https://tale.partner.example/app',
    );
    expect(publicHttpApiUrlFor('https://tale.partner.example')).toBe(
      'https://tale.partner.example/app/http_api',
    );
  });

  it('refuses a base URL when SITE_URL is unset (no guessing from the request)', () => {
    expect(publicBaseUrl(proxied('tale.example.com'))).toBeNull();
  });
});
