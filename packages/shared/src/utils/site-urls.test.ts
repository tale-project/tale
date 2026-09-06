import { describe, expect, it } from 'vitest';

import {
  canonicalSiteOrigin,
  matchSiteOrigin,
  normalizeSiteOrigin,
  parseAdditionalSiteUrls,
  requestSiteOrigin,
  resolveSiteOrigins,
  SiteUrlConfigError,
  splitSiteUrlList,
} from './site-urls';

describe('splitSiteUrlList', () => {
  it('splits on commas and whitespace, dropping empties', () => {
    expect(
      splitSiteUrlList(
        ' https://a.example, https://b.example\nhttps://c.example ,, ',
      ),
    ).toEqual(['https://a.example', 'https://b.example', 'https://c.example']);
  });

  it('returns [] for an unset or blank value', () => {
    expect(splitSiteUrlList(undefined)).toEqual([]);
    expect(splitSiteUrlList(null)).toEqual([]);
    expect(splitSiteUrlList('   ')).toEqual([]);
  });
});

describe('normalizeSiteOrigin', () => {
  it('normalizes to a bare origin (case, default port, trailing slash)', () => {
    expect(normalizeSiteOrigin('HTTPS://Tale.Example.COM:443/')).toBe(
      'https://tale.example.com',
    );
    expect(normalizeSiteOrigin('https://tale.example.com:8443')).toBe(
      'https://tale.example.com:8443',
    );
    expect(normalizeSiteOrigin('http://localhost:3000')).toBe(
      'http://localhost:3000',
    );
  });

  it('refuses a value that is not an absolute http(s) URL', () => {
    expect(() => normalizeSiteOrigin('tale.example.com')).toThrow(
      SiteUrlConfigError,
    );
    expect(() => normalizeSiteOrigin('ftp://tale.example.com')).toThrow(
      /must use http/,
    );
    expect(() => normalizeSiteOrigin('javascript:alert(1)')).toThrow(
      SiteUrlConfigError,
    );
  });

  it('refuses a subpath, query or fragment — the value names an origin', () => {
    expect(() => normalizeSiteOrigin('https://tale.example.com/app')).toThrow(
      /bare origin/,
    );
    expect(() => normalizeSiteOrigin('https://tale.example.com/?x=1')).toThrow(
      /bare origin/,
    );
    expect(() => normalizeSiteOrigin('https://tale.example.com/#top')).toThrow(
      /bare origin/,
    );
  });

  it('names the offending entry and the variable in the message', () => {
    expect(() => normalizeSiteOrigin('nope')).toThrow(
      /ADDITIONAL_SITE_URLS: "nope"/,
    );
  });
});

describe('parseAdditionalSiteUrls', () => {
  it('normalizes and deduplicates in written order', () => {
    expect(
      parseAdditionalSiteUrls(
        'https://b.example/, https://a.example https://B.example:443',
      ),
    ).toEqual(['https://b.example', 'https://a.example']);
  });

  it('is [] for an unset value and throws on the first bad entry', () => {
    expect(parseAdditionalSiteUrls(undefined)).toEqual([]);
    expect(() =>
      parseAdditionalSiteUrls('https://ok.example, not-a-url'),
    ).toThrow(/"not-a-url"/);
  });
});

describe('canonicalSiteOrigin', () => {
  it('is lenient about the shapes SITE_URL has always accepted', () => {
    expect(canonicalSiteOrigin('https://tale.example.com/')).toBe(
      'https://tale.example.com',
    );
    expect(canonicalSiteOrigin(' https://tale.example.com:8443 ')).toBe(
      'https://tale.example.com:8443',
    );
  });

  it('is null when unset, blank or unparsable', () => {
    expect(canonicalSiteOrigin(undefined)).toBeNull();
    expect(canonicalSiteOrigin('')).toBeNull();
    expect(canonicalSiteOrigin('not a url')).toBeNull();
  });
});

describe('resolveSiteOrigins', () => {
  it('puts the canonical origin first and folds duplicates', () => {
    expect(
      resolveSiteOrigins({
        SITE_URL: 'https://tale.example.com',
        ADDITIONAL_SITE_URLS:
          'https://tale.partner.example, https://tale.example.com/',
      }),
    ).toEqual(['https://tale.example.com', 'https://tale.partner.example']);
  });

  it('is exactly the canonical origin when nothing additional is set', () => {
    expect(
      resolveSiteOrigins({ SITE_URL: 'https://tale.example.com' }),
    ).toEqual(['https://tale.example.com']);
    expect(
      resolveSiteOrigins({
        SITE_URL: 'https://tale.example.com',
        ADDITIONAL_SITE_URLS: '',
      }),
    ).toEqual(['https://tale.example.com']);
  });

  it('is empty without SITE_URL — the additional list never stands alone', () => {
    expect(
      resolveSiteOrigins({ ADDITIONAL_SITE_URLS: 'https://alone.example' }),
    ).toEqual([]);
  });
});

const ORIGINS = ['https://tale.example.com', 'https://tale.partner.example'];

describe('matchSiteOrigin', () => {
  it('matches a configured origin exactly, ignoring any path', () => {
    expect(
      matchSiteOrigin('https://tale.partner.example/dashboard?x=1', ORIGINS),
    ).toBe('https://tale.partner.example');
  });

  it('refuses look-alikes, scheme downgrades and other ports', () => {
    expect(
      matchSiteOrigin('https://tale.example.com.evil.example', ORIGINS),
    ).toBeNull();
    expect(matchSiteOrigin('http://tale.example.com', ORIGINS)).toBeNull();
    expect(
      matchSiteOrigin('https://tale.example.com:8443', ORIGINS),
    ).toBeNull();
    expect(matchSiteOrigin('not a url', ORIGINS)).toBeNull();
    expect(matchSiteOrigin(undefined, ORIGINS)).toBeNull();
  });
});

describe('requestSiteOrigin', () => {
  const INTERNAL = 'http://backend-api:3005/api/sso/callback?code=1';

  it('reads the proxied Host + X-Forwarded-Proto when they name a configured origin', () => {
    expect(
      requestSiteOrigin(
        {
          url: INTERNAL,
          host: 'tale.partner.example',
          forwardedProto: 'https',
        },
        ORIGINS,
      ),
    ).toBe('https://tale.partner.example');
    // Default port and host case are normalized away.
    expect(
      requestSiteOrigin(
        {
          url: INTERNAL,
          host: 'Tale.Example.COM:443',
          forwardedProto: 'https, http',
        },
        ORIGINS,
      ),
    ).toBe('https://tale.example.com');
  });

  it('is null for a Host outside the configured set (Host-header injection)', () => {
    expect(
      requestSiteOrigin(
        { url: INTERNAL, host: 'evil.example', forwardedProto: 'https' },
        ORIGINS,
      ),
    ).toBeNull();
    // The forwarded scheme must match too — an http Host of an https origin is not it.
    expect(
      requestSiteOrigin(
        { url: INTERNAL, host: 'tale.example.com', forwardedProto: 'http' },
        ORIGINS,
      ),
    ).toBeNull();
  });

  it("falls back to the request URL's own host and scheme (direct, unproxied requests)", () => {
    expect(
      requestSiteOrigin({ url: 'https://tale.example.com/x' }, ORIGINS),
    ).toBe('https://tale.example.com');
    expect(requestSiteOrigin({ url: INTERNAL }, ORIGINS)).toBeNull();
  });

  it('is null with no configured origins or a garbage proto', () => {
    expect(
      requestSiteOrigin(
        { url: INTERNAL, host: 'tale.example.com', forwardedProto: 'https' },
        [],
      ),
    ).toBeNull();
    expect(
      requestSiteOrigin(
        { url: INTERNAL, host: 'tale.example.com', forwardedProto: 'gopher' },
        ORIGINS,
      ),
    ).toBeNull();
  });
});
