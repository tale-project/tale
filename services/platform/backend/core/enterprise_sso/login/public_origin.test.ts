// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { publicOrigin } from './public_origin';

const INTERNAL_URL = 'http://backend-api:3005/api/sso/saml/acs?x=1';

let savedSiteUrl: string | undefined;

beforeEach(() => {
  savedSiteUrl = process.env.SITE_URL;
});

afterEach(() => {
  if (savedSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = savedSiteUrl;
});

describe('publicOrigin — browser-facing origin behind the reverse proxy', () => {
  it('prefers SITE_URL over the internal request origin', () => {
    // Behind Caddy TLS termination the request origin is the internal http
    // upstream; deriving the cookie name/redirect from it broke SAML logins
    // (unprefixed cookie + redirect to an unreachable host).
    process.env.SITE_URL = 'https://tale.example.com';
    expect(publicOrigin(INTERNAL_URL)).toBe('https://tale.example.com');
  });

  it('normalises a trailing slash on SITE_URL to a bare origin', () => {
    process.env.SITE_URL = 'https://tale.example.com/';
    expect(publicOrigin(INTERNAL_URL)).toBe('https://tale.example.com');
  });

  it('keeps an http SITE_URL http (cookie stays unprefixed, like Better Auth)', () => {
    process.env.SITE_URL = 'http://localhost:3000';
    expect(publicOrigin(INTERNAL_URL)).toBe('http://localhost:3000');
  });

  it('falls back to the request origin when SITE_URL is unset', () => {
    delete process.env.SITE_URL;
    expect(publicOrigin(INTERNAL_URL)).toBe('http://backend-api:3005');
  });
});
