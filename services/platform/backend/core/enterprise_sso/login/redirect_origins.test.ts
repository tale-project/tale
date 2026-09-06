import { afterEach, describe, expect, it } from 'vitest';

import { allowedRedirectOrigin } from './redirect_origins';

const REQUEST = 'http://127.0.0.1:3211/api/sso/authorize';

describe('allowedRedirectOrigin', () => {
  afterEach(() => {
    delete process.env.SITE_URL;
    delete process.env.ADDITIONAL_SITE_URLS;
  });

  it('accepts the SITE_URL origin (trailing slash and path ignored)', () => {
    process.env.SITE_URL = 'https://app.example.com/';
    expect(
      allowedRedirectOrigin(
        'https://app.example.com/http_api/api/sso/callback',
        REQUEST,
      ),
    ).toBe('https://app.example.com');
  });

  it("accepts the request's own origin in both loopback spellings", () => {
    expect(
      allowedRedirectOrigin('http://localhost:3211/api/sso/callback', REQUEST),
    ).toBe('http://localhost:3211');
    expect(
      allowedRedirectOrigin('http://127.0.0.1:3211/api/sso/callback', REQUEST),
    ).toBe('http://127.0.0.1:3211');
  });

  it('accepts an ADDITIONAL_SITE_URLS origin — the login page passes the one the browser is on', () => {
    process.env.SITE_URL = 'https://app.example.com';
    process.env.ADDITIONAL_SITE_URLS =
      'https://tale.partner.example, https://app.other.example';
    expect(
      allowedRedirectOrigin(
        'https://tale.partner.example/http_api/api/sso/callback',
        REQUEST,
      ),
    ).toBe('https://tale.partner.example');
    expect(allowedRedirectOrigin('https://app.other.example/x', REQUEST)).toBe(
      'https://app.other.example',
    );
  });

  it('still refuses a domain that is not configured, with extras set', () => {
    process.env.SITE_URL = 'https://app.example.com';
    process.env.ADDITIONAL_SITE_URLS = 'https://tale.partner.example';
    expect(
      allowedRedirectOrigin('https://evil.example/x', REQUEST),
    ).toBeUndefined();
    // A look-alike of a configured extra is not the extra.
    expect(
      allowedRedirectOrigin(
        'https://tale.partner.example.evil.example/x',
        REQUEST,
      ),
    ).toBeUndefined();
  });

  it('refuses every other origin, a different port or scheme included', () => {
    process.env.SITE_URL = 'https://app.example.com';
    expect(
      allowedRedirectOrigin('https://evil.example/x', REQUEST),
    ).toBeUndefined();
    expect(
      allowedRedirectOrigin('https://app.example.com.evil.example/', REQUEST),
    ).toBeUndefined();
    expect(
      allowedRedirectOrigin('http://app.example.com/callback', REQUEST),
    ).toBeUndefined();
    expect(
      allowedRedirectOrigin('http://127.0.0.1:3000/callback', REQUEST),
    ).toBeUndefined();
  });

  it('refuses a missing, empty or unparsable value', () => {
    expect(allowedRedirectOrigin(undefined, REQUEST)).toBeUndefined();
    expect(allowedRedirectOrigin('', REQUEST)).toBeUndefined();
    expect(allowedRedirectOrigin('not a url', REQUEST)).toBeUndefined();
    expect(
      allowedRedirectOrigin('javascript:alert(1)', REQUEST),
    ).toBeUndefined();
  });
});
