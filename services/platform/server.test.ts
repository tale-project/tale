import { describe, expect, test } from 'vitest';

import { createApp } from './server';

const baseEnv = {
  SITE_URL: 'https://tale.example.com',
  BASE_PATH: '',
  MICROSOFT_AUTH_ENABLED: false,
  TRUSTED_HEADERS_ENABLED: false,
  FILE_EVENTS_ENABLED: true,
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

  test('CSP includes Sentry origin parsed from SENTRY_DSN', async () => {
    const app = createApp({
      ...baseEnv,
      SENTRY_DSN: 'https://abc@o1.ingest.us.sentry.io/123',
    });
    const res = await app.fetch(new Request('http://localhost/api/health'));
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('https://o1.ingest.us.sentry.io');
  });

  test('CSP supports self-hosted Sentry on a custom domain', async () => {
    const app = createApp({
      ...baseEnv,
      SENTRY_DSN: 'https://abc@sentry.elintrio.com/123',
    });
    const res = await app.fetch(new Request('http://localhost/api/health'));
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('https://sentry.elintrio.com');
  });
});

describe('POST /canvas-preview', () => {
  test('echoes the form-posted html with permissive CSP and no nonce', async () => {
    const app = createApp(baseEnv);
    const res = await app.fetch(
      new Request('http://localhost/canvas-preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'html=' + encodeURIComponent('<h1>hi</h1><script>1+1</script>'),
      }),
    );
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy') ?? '';
    // Load-bearing: AI HTML's inline `<script>` and `onclick=` must run.
    expect(csp).toContain("'unsafe-inline'");
    expect(csp).toContain("'unsafe-eval'");
    // The SPA's nonce-based policy must NOT survive on this route — that
    // would silently reproduce the bug from commit be2eb56be.
    expect(csp).not.toMatch(/nonce-/);
    // Egress is locked down per the air-gap policy in
    // buildContentSecurityPolicy's comment block.
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/connect-src[^;]*\*/);
    // Defense-in-depth framing controls.
    expect(csp).toContain("frame-ancestors 'self'");
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(text).toContain('<!doctype html>');
    expect(text).toContain('<h1>hi</h1>');
    expect(text).toContain('<script>1+1</script>');
  });

  test('returns an empty document body when the html field is missing', async () => {
    const app = createApp(baseEnv);
    const res = await app.fetch(
      new Request('http://localhost/canvas-preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: '',
      }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<!doctype html>');
    // Body region between <body> and </body> should be empty.
    expect(text).toMatch(/<body>\s*<\/body>/);
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

  test('returns 404 when FILE_EVENTS_ENABLED is false', async () => {
    const app = createApp({ ...baseEnv, FILE_EVENTS_ENABLED: false });
    const res = await app.fetch(new Request('http://localhost/events/file'));
    expect(res.status).toBe(404);
  });
});
