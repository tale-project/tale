import { afterEach, describe, expect, it } from 'vitest';

import { allowedRedirectOrigin } from './redirect_origins';

const REQUEST = 'http://127.0.0.1:3211/api/sso/authorize';

describe('allowedRedirectOrigin', () => {
  afterEach(() => {
    delete process.env.SITE_URL;
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
