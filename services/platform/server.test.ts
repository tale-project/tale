import { describe, expect, test } from 'vitest';

import { createApp } from './server';

const baseEnv = {
  SITE_URL: 'https://tale.example.com',
  BASE_PATH: '',
  MICROSOFT_AUTH_ENABLED: false,
  TRUSTED_HEADERS_ENABLED: false,
  SENTRY_DSN: undefined,
  SENTRY_TRACES_SAMPLE_RATE: 1,
  TALE_VERSION: undefined,
};

describe('security headers', () => {
  test('every standard header is present on /api/health', async () => {
    const app = createApp(baseEnv);
    const res = await app.fetch(new Request('http://localhost/api/health'));

    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("frame-src 'self'");
    expect(csp).toContain("object-src 'none'");
    // Third-party CDNs must stay out of the baseline CSP — libraries and
    // fonts are bundled, reverse-geocoding was removed (see
    // buildContentSecurityPolicy for the standing policy).
    expect(csp).not.toContain('https://cdnjs.cloudflare.com');
    expect(csp).not.toContain('https://fonts.googleapis.com');
    expect(csp).not.toContain('https://fonts.gstatic.com');
    expect(csp).not.toContain('https://nominatim.openstreetmap.org');
    expect(csp).not.toContain('https://*.ingest.sentry.io');
    expect(csp).not.toContain('https://*.convex.cloud');
    // mcp.figma.com is a localhost-only dev tool; production CSP omits it.
    expect(csp).not.toContain('https://mcp.figma.com');

    expect(res.headers.get('strict-transport-security')).toBe(
      'max-age=15552000',
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    );

    const pp = res.headers.get('permissions-policy') ?? '';
    expect(pp).toContain('camera=()');
    expect(pp).toContain('geolocation=(self)');
    expect(pp).toContain('clipboard-write=(self)');
  });

  test('HSTS is omitted when SITE_URL is HTTP loopback', async () => {
    const app = createApp({ ...baseEnv, SITE_URL: 'http://localhost:3000' });
    const res = await app.fetch(new Request('http://localhost/api/health'));
    expect(res.headers.get('strict-transport-security')).toBeNull();
  });

  test('CSP includes mcp.figma.com only when SITE_URL is loopback', async () => {
    const app = createApp({ ...baseEnv, SITE_URL: 'http://127.0.0.1:3000' });
    const res = await app.fetch(new Request('http://localhost/api/health'));
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('https://mcp.figma.com');
  });

  test('CSP includes Sentry origin when SENTRY_DSN is set', async () => {
    const app = createApp({
      ...baseEnv,
      SENTRY_DSN: 'https://abc@sentry.io/123',
    });
    const res = await app.fetch(new Request('http://localhost/api/health'));
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('https://*.ingest.sentry.io');
  });
});

describe('SSE /events/file', () => {
  test('preserves text/event-stream content type and no-cache', async () => {
    const app = createApp(baseEnv);
    const res = await app.fetch(new Request('http://localhost/events/file'));
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.body).toBeInstanceOf(ReadableStream);
    // Cancel to drop the SSE client and avoid leaking the controller.
    await res.body?.cancel();
  });
});
