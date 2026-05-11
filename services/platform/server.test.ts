import * as vm from 'node:vm';

import { describe, expect, test } from 'vitest';

import { wrapCanvasPreviewHtml } from './lib/canvas-preview-shell';
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
  CANVAS_PREVIEW_CSP_EXTRA_ORIGINS: [] as readonly string[],
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

  // CSP extras: opt-in escape hatch via CANVAS_PREVIEW_CSP_EXTRA_ORIGINS.
  // Default empty preserves the byte-identical air-gapped CSP; setting it
  // appends validated origins to the five fetch directives that an LLM
  // demo might legitimately need (script/style/font/img/connect).

  async function getCanvasCsp(env: typeof baseEnv): Promise<string> {
    const app = createApp(env);
    const res = await app.fetch(
      new Request('http://localhost/canvas-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: '',
      }),
    );
    return res.headers.get('content-security-policy') ?? '';
  }

  test('extras default empty preserves the air-gapped CSP', async () => {
    const csp = await getCanvasCsp(baseEnv);
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval';");
    expect(csp).toContain("style-src 'self' 'unsafe-inline';");
    expect(csp).toContain("connect-src 'self';");
    expect(csp).not.toContain('https://');
  });

  test('extras: a valid origin appears in five fetch directives', async () => {
    const csp = await getCanvasCsp({
      ...baseEnv,
      CANVAS_PREVIEW_CSP_EXTRA_ORIGINS: ['https://cdn.jsdelivr.net'],
    });
    expect(csp).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net;",
    );
    expect(csp).toContain(
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;",
    );
    expect(csp).toContain("font-src 'self' data: https://cdn.jsdelivr.net;");
    expect(csp).toContain(
      "img-src 'self' data: blob: https://cdn.jsdelivr.net;",
    );
    expect(csp).toContain("connect-src 'self' https://cdn.jsdelivr.net;");
    // Egress-control directives that should NOT pick up the extras.
    expect(csp).toContain("frame-ancestors 'self';");
    expect(csp).not.toMatch(/frame-ancestors[^;]*https:\/\/cdn\.jsdelivr/);
    expect(csp).toContain("base-uri 'none';");
    expect(csp).toContain("object-src 'none'");
  });

  test('extras: malformed entry is dropped, CSP matches no-extras shape', async () => {
    const cspMalformed = await getCanvasCsp({
      ...baseEnv,
      CANVAS_PREVIEW_CSP_EXTRA_ORIGINS: ['not-a-url'],
    });
    const cspBaseline = await getCanvasCsp(baseEnv);
    expect(cspMalformed).toBe(cspBaseline);
  });

  test('extras: URL with path is dropped (must be bare origin)', async () => {
    const cspWithPath = await getCanvasCsp({
      ...baseEnv,
      CANVAS_PREVIEW_CSP_EXTRA_ORIGINS: ['https://cdn.jsdelivr.net/npm/'],
    });
    const cspBaseline = await getCanvasCsp(baseEnv);
    expect(cspWithPath).toBe(cspBaseline);
  });
});

describe('canvas-preview storage shim', () => {
  // The iframe runs sandboxed without `allow-same-origin`, so its origin is
  // opaque ("null") and reading `window.localStorage` throws synchronously
  // — `try/catch` at the call site can't help. The shim shadows the throwing
  // platform getter with an in-memory `Storage` impl. These tests evaluate
  // the shim source against a synthetic `window`; the real opaque-origin
  // shadowing behavior is a stable browser property and verified manually
  // (see plan `lockdown-install-js-1-ses-removing-imperative-acorn.md`).

  function extractShimSource(): string {
    const wrapped = wrapCanvasPreviewHtml('');
    const match = wrapped.match(/<script>([\s\S]*?)<\/script>/);
    if (!match) throw new Error('storage shim not found in wrapped HTML');
    return match[1];
  }

  function install(): {
    localStorage: Storage;
    sessionStorage: Storage;
  } {
    const fakeWindow: Record<string, unknown> = {};
    // Run the shim source in an isolated VM context with `window` bound to
    // a synthetic record. Using `vm.runInNewContext` instead of `new
    // Function(...)` avoids the `no-implied-eval` lint and keeps the test
    // realm separate from the test runner's globals.
    vm.runInNewContext(extractShimSource(), { window: fakeWindow, console });
    return {
      localStorage: fakeWindow.localStorage as Storage,
      sessionStorage: fakeWindow.sessionStorage as Storage,
    };
  }

  test('shim sentinel appears in the canvas-preview response body', async () => {
    const app = createApp(baseEnv);
    const res = await app.fetch(
      new Request('http://localhost/canvas-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: '',
      }),
    );
    const text = await res.text();
    // Stable substring — small enough not to churn on minor tweaks, specific
    // enough to fail loudly if the shim ever stops being injected.
    expect(text).toContain(
      'Object.defineProperty(window, name, { value: value, configurable: true })',
    );
    expect(text).toContain('install("localStorage")');
    expect(text).toContain('install("sessionStorage")');
  });

  test('round-trips values via getItem / setItem', () => {
    const { localStorage } = install();
    localStorage.setItem('a', '1');
    expect(localStorage.getItem('a')).toBe('1');
    expect(localStorage.getItem('missing')).toBeNull();
  });

  test('bracket notation routes through the same store', () => {
    const { localStorage } = install();
    // Write via bracket, read via getItem.
    (localStorage as unknown as Record<string, string>).foo = 'bar';
    expect(localStorage.getItem('foo')).toBe('bar');
    // Write via setItem, read via bracket.
    localStorage.setItem('baz', 'qux');
    expect((localStorage as unknown as Record<string, string>).baz).toBe('qux');
  });

  test('coerces non-string keys and values to strings', () => {
    const { localStorage } = install();
    localStorage.setItem(42 as unknown as string, 7 as unknown as string);
    expect(localStorage.getItem('42')).toBe('7');
    localStorage.setItem('obj', { a: 1 } as unknown as string);
    expect(localStorage.getItem('obj')).toBe('[object Object]');
  });

  test('length, key, removeItem, and clear', () => {
    const { localStorage } = install();
    localStorage.setItem('a', '1');
    localStorage.setItem('b', '2');
    expect(localStorage.length).toBe(2);
    expect(['a', 'b']).toContain(localStorage.key(0));
    localStorage.removeItem('a');
    expect(localStorage.getItem('a')).toBeNull();
    expect(localStorage.length).toBe(1);
    localStorage.clear();
    expect(localStorage.length).toBe(0);
  });

  test('exceeding the 5 MiB quota throws QuotaExceededError', () => {
    const { localStorage } = install();
    expect(() => {
      localStorage.setItem('big', 'a'.repeat(6 * 1024 * 1024));
    }).toThrow(
      expect.objectContaining({
        name: 'QuotaExceededError',
      }) as unknown as Error,
    );
  });

  test('localStorage and sessionStorage are independent stores', () => {
    const { localStorage, sessionStorage } = install();
    localStorage.setItem('k', 'L');
    sessionStorage.setItem('k', 'S');
    expect(localStorage.getItem('k')).toBe('L');
    expect(sessionStorage.getItem('k')).toBe('S');
    sessionStorage.clear();
    expect(localStorage.getItem('k')).toBe('L');
    expect(sessionStorage.getItem('k')).toBeNull();
  });

  test('overwriting an existing key updates the byte budget correctly', () => {
    const { localStorage } = install();
    // Fill close to the cap, then replace with a smaller value — the new
    // budget should accept further writes that the naive sum wouldn't.
    const fourMiB = 'a'.repeat(4 * 1024 * 1024);
    localStorage.setItem('payload', fourMiB);
    localStorage.setItem('payload', 'small');
    // 4 MiB more must fit now that the previous value is released.
    expect(() => {
      localStorage.setItem('again', fourMiB);
    }).not.toThrow();
  });
});

describe('GET /status.json', () => {
  test('responds with the canonical StatusFeed shape as JSON', async () => {
    const app = createApp(baseEnv);
    const res = await app.fetch(new Request('http://localhost/status.json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('public, max-age=5');

    // No upstreams are running in test; probes fail (ECONNREFUSED) and the
    // feed reports `outage`. The point of this test is the wire shape and
    // headers — not the upstream verdict — so assertions stay on structure.
    const body = JSON.parse(await res.text());
    expect(body).toMatchObject({
      status: expect.stringMatching(/^(operational|degraded|outage)$/),
      checkedAt: expect.any(String),
      components: expect.arrayContaining([
        expect.objectContaining({
          id: 'convex',
          status: expect.stringMatching(/^(operational|outage)$/),
        }),
        expect.objectContaining({ id: 'rag' }),
        expect.objectContaining({ id: 'crawler' }),
      ]),
    });
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
