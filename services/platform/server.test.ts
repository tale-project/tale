import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vm from 'node:vm';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { wrapCanvasPreviewHtml } from './lib/canvas-preview-shell';
import {
  cacheControlForStaticPath,
  createApp,
  shouldDeliverSseEvent,
} from './server';

const baseEnv = {
  SITE_URL: 'https://tale.example.com',
  SITE_ORIGINS: ['https://tale.example.com'] as readonly string[],
  BASE_PATH: '',
  TRUSTED_HEADERS_ENABLED: false,
  FILE_EVENTS_ENABLED: true,
  SENTRY_DSN: undefined,
  SENTRY_TRACES_SAMPLE_RATE: 1,
  TALE_VERSION: undefined,
  CANVAS_PREVIEW_CSP_EXTRA_ORIGINS: [] as readonly string[],
};

describe('cacheControlForStaticPath', () => {
  const IMMUTABLE = 'public, max-age=31536000, immutable';
  const REVALIDATE = 'no-cache';

  test.each([
    // Content-hashed bundler output under /assets/ — a filename never maps to
    // different bytes, so it is safe to cache forever.
    ['/assets/vendor-katex-DUoGyCxW.js', IMMUTABLE],
    ['/assets/index-D6U9bzSy.css', IMMUTABLE],
    ['/assets/vendor-radix-C-BNZUpZ.js', IMMUTABLE], // hash contains '-'
    ['/assets/vendor-katex-_Zecxha_.css', IMMUTABLE], // hash contains '_'
    ['/assets/vendor-katex-DUoGyCxW.js.map', IMMUTABLE], // sourcemap
    ['/assets/queries-LIOgKzLg2.js', IMMUTABLE], // 9-char hash (Rollup collision-extended)
  ])('caches %s immutably', (pathname, expected) => {
    expect(cacheControlForStaticPath(pathname)).toBe(expected);
  });

  test.each([
    // Stable-named files that can change across deploys must revalidate.
    ['/index.html', REVALIDATE],
    ['/sw.js', REVALIDATE],
    ['/manifest.webmanifest', REVALIDATE],
    ['/favicon.ico', REVALIDATE],
    ['/assets/pwa-192x192.png', REVALIDATE], // un-hashed public image in assets/
    ['/assets/logo-white.svg', REVALIDATE],
    ['/assets/apple-touch-icon-180x180.png', REVALIDATE], // digits, not a hash
    ['/canvas-libs/d3/7.8.5/d3.min.js', REVALIDATE], // version-pinned, outside assets/
  ])('revalidates %s', (pathname, expected) => {
    expect(cacheControlForStaticPath(pathname)).toBe(expected);
  });
});

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
    // Live-browser human takeover bridges a host paste via
    // navigator.clipboard.readText(); an empty allowlist would emit
    // `clipboard-read=()` and silently block the read.
    expect(pp).toContain('clipboard-read=(self)');

    // Hono `secureHeaders` emits these by default; pin them so a hono upgrade
    // can't silently drop a header the OWASP Secure Headers set expects.
    expect(res.headers.get('x-permitted-cross-domain-policies')).toBe('none');
    expect(res.headers.get('x-xss-protection')).toBe('0');
    expect(res.headers.get('x-download-options')).toBe('noopen');
    expect(res.headers.get('x-dns-prefetch-control')).toBe('off');
    // And no framework fingerprint header.
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  // Regression guard for issue #1925 — "Verify the web client passes the
  // Mozilla Observatory check". The live HTTPS deployment (demo.tale.dev) was
  // scanned with the MDN HTTP Observatory on 2026-06-23 and graded **A+**
  // (score 115, algorithm v5, 10/10 tests passed, 0 failed):
  //   https://developer.mozilla.org/en-US/observatory/analyze?host=demo.tale.dev
  // The A+ grade hinges on the specific header shape asserted below — most of
  // all a strict, nonce-based CSP with NO `unsafe-inline`/`unsafe-eval` in
  // `script-src`. This test locks that contract so a future change that would
  // drop the grade fails CI instead of being noticed only on the next manual
  // scan.
  test('emits the Observatory A+ header contract (issue #1925)', async () => {
    const app = createApp(baseEnv);
    const res = await app.fetch(new Request('http://localhost/api/health'));

    const csp = res.headers.get('content-security-policy') ?? '';
    // Observatory's CSP test awards its best score only when `script-src`
    // neither falls back to a permissive `default-src` nor allows inline /
    // eval execution. A per-request nonce plus `'self'` is what earns it.
    const scriptSrc = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('script-src'));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).toMatch(/'nonce-[^']+'/);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    // Directives Observatory checks for clickjacking / injection hardening.
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");

    // The remaining Observatory tests map one-to-one onto these headers.
    expect(res.headers.get('strict-transport-security')).toBe(
      'max-age=15552000',
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    );
    // CORS test: the document must NOT advertise itself as cross-origin
    // readable. A wide-open `Access-Control-Allow-Origin: *` would fail it.
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
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

  // Regression guard for issue #1964 — custom branding favicons and fonts are
  // addressed as absolute `<SITE_URL>/branding/...` URLs, so when the app is
  // reached from a host other than SITE_URL they're cross-origin and were
  // blocked by `img-src`/`font-src 'self'`. The canonical SITE_URL origin
  // (the operator's own, never a third-party CDN) must appear in both.
  test('CSP allows branding assets from the SITE_URL origin (issue #1964)', async () => {
    const app = createApp({
      ...baseEnv,
      SITE_URL: 'https://brand.example.com',
    });
    const res = await app.fetch(new Request('http://localhost/api/health'));
    const csp = res.headers.get('content-security-policy') ?? '';
    const directive = (name: string) =>
      csp
        .split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith(`${name} `)) ?? '';
    expect(directive('img-src')).toContain('https://brand.example.com');
    expect(directive('font-src')).toContain('https://brand.example.com');
    // Strictness is preserved: the origin is added without widening to a
    // wildcard or `unsafe-inline`.
    expect(directive('font-src')).not.toContain('*');
  });

  // Multi-domain deployments serve the SAME app on several origins, and
  // branding assets are absolute URLs on whichever origin built them — so
  // every configured origin has to be allow-listed, not just the canonical
  // one, or the extra domains lose their favicon and fonts.
  test('CSP allows branding assets from every configured site origin', async () => {
    const app = createApp({
      ...baseEnv,
      SITE_URL: 'https://tale.example.com',
      SITE_ORIGINS: [
        'https://tale.example.com',
        'https://tale.partner.example',
      ],
    });
    const res = await app.fetch(new Request('http://localhost/api/health'));
    const csp = res.headers.get('content-security-policy') ?? '';
    const directive = (name: string) =>
      csp
        .split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith(`${name} `)) ?? '';
    for (const name of ['img-src', 'font-src']) {
      expect(directive(name)).toContain('https://tale.example.com');
      expect(directive(name)).toContain('https://tale.partner.example');
    }
    expect(directive('font-src')).not.toContain('*');
  });

  // Only the origin (scheme + host + port) is allow-listed, never the path —
  // a CSP source is an origin, and leaking the `/branding/...` path here would
  // be both invalid and over-specific.
  test('CSP omits the branding origin when SITE_URL is unset', async () => {
    const app = createApp({ ...baseEnv, SITE_URL: '' });
    const res = await app.fetch(new Request('http://localhost/api/health'));
    const csp = res.headers.get('content-security-policy') ?? '';
    // Same-origin assets are covered by `'self'`; no extra origin is emitted.
    expect(csp).toContain("font-src 'self' data:");
  });

  // Org BYO object storage hands the browser presigned PUT/GET URLs on the
  // org's EXTERNAL endpoint (files/blob_actions.generateBlobUpload, the
  // /storage 302 lane), so those origins must be allow-listed or every
  // browser-direct upload dies as `net::ERR_BLOCKED_BY_CSP` — the exact
  // failure observed on demo v0.3.6 with a Cloudflare R2 bucket configured.
  test('org BYO storage origins join connect-src, img-src and media-src', async () => {
    const app = createApp(baseEnv, {
      orgStorageOrigins: () => ['https://acc.r2.cloudflarestorage.com'],
    });
    const res = await app.fetch(new Request('http://localhost/api/health'));
    const csp = res.headers.get('content-security-policy') ?? '';
    const directive = (name: string) =>
      csp
        .split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith(name)) ?? '';
    expect(directive('connect-src')).toContain(
      'https://acc.r2.cloudflarestorage.com',
    );
    expect(directive('img-src')).toContain(
      'https://acc.r2.cloudflarestorage.com',
    );
    expect(directive('media-src')).toContain(
      'https://acc.r2.cloudflarestorage.com',
    );
    // The storage origin must not leak into execution or framing directives.
    expect(directive('script-src')).not.toContain('r2.cloudflarestorage.com');
    expect(directive('frame-src')).not.toContain('r2.cloudflarestorage.com');
    expect(directive('default-src')).toBe("default-src 'self'");
  });

  test('a data-residency save reaches the CSP without a restart', async () => {
    let origins: readonly string[] = [];
    const app = createApp(baseEnv, { orgStorageOrigins: () => origins });

    const before = await app.fetch(new Request('http://localhost/api/health'));
    expect(before.headers.get('content-security-policy')).not.toContain(
      'r2.cloudflarestorage.com',
    );

    // The org admin saves an external bucket; the provider now reports it.
    origins = ['https://acc.r2.cloudflarestorage.com'];
    const after = await app.fetch(new Request('http://localhost/api/health'));
    expect(after.headers.get('content-security-policy')).toContain(
      "connect-src 'self' https://acc.r2.cloudflarestorage.com",
    );
  });
});

describe('POST /canvas-preview', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The route validates the session cookie against the backend oracle
  // (`/api/sse/auth`, the same door /events/file uses) before rendering.
  function mockSessionOracleOk() {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ userId: 'u1', orgSlugs: ['acme'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }

  function previewRequest(body: string): Request {
    return new Request('http://localhost/canvas-preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        cookie: 'better-auth.session_token=valid',
      },
      body,
    });
  }

  // Regression: this route used to render for ANY caller — an attacker could
  // form-POST a victim's browser here top-level and have arbitrary HTML
  // echoed on the app origin under a script-permissive CSP (reflected XSS).
  test('rejects an unauthenticated POST without calling the oracle', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const app = createApp(baseEnv);
    const res = await app.fetch(
      new Request('http://localhost/canvas-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'html=' + encodeURIComponent('<script>steal()</script>'),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Cookie');
    expect(res.headers.get('cache-control')).toBe('no-store');
    // The echoed HTML must not appear anywhere in the refusal.
    expect(await res.text()).not.toContain('steal()');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('rejects a POST whose session the oracle refuses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Unauthenticated', { status: 401 }),
    );
    const app = createApp(baseEnv);
    const res = await app.fetch(
      previewRequest('html=' + encodeURIComponent('<h1>hi</h1>')),
    );
    expect(res.status).toBe(401);
  });

  // Regression: the response CSP now carries a `sandbox` directive (without
  // `allow-same-origin`), so even for an authenticated victim a top-level
  // navigation renders as an inert opaque-origin document — the same flags
  // the in-app iframe embed already imposes, so the legit preview is
  // unchanged.
  test('response CSP sandboxes the document without allow-same-origin', async () => {
    mockSessionOracleOk();
    const app = createApp(baseEnv);
    const res = await app.fetch(previewRequest('html=x'));
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('sandbox allow-scripts allow-modals');
    expect(csp).not.toContain('allow-same-origin');
  });

  // A GET to the same path is NOT the preview render — it falls through to
  // the SPA shell and must keep the standard strict headers (the exemption
  // from `secureHeaders` is scoped to the POST).
  test('GET /canvas-preview keeps the strict SPA security headers', async () => {
    const app = createApp(baseEnv);
    const res = await app.fetch(new Request('http://localhost/canvas-preview'));
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  test('echoes the form-posted html with permissive CSP and no nonce', async () => {
    mockSessionOracleOk();
    const app = createApp(baseEnv);
    const res = await app.fetch(
      previewRequest(
        'html=' + encodeURIComponent('<h1>hi</h1><script>1+1</script>'),
      ),
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
    mockSessionOracleOk();
    const app = createApp(baseEnv);
    const res = await app.fetch(previewRequest(''));
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
    mockSessionOracleOk();
    const app = createApp(env);
    const res = await app.fetch(previewRequest(''));
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
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ userId: 'u1', orgSlugs: ['acme'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const app = createApp(baseEnv);
    const res = await app.fetch(
      new Request('http://localhost/canvas-preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          cookie: 'better-auth.session_token=valid',
        },
        body: '',
      }),
    );
    const text = await res.text();
    fetchSpy.mockRestore();
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
      }) as unknown,
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

describe('GET /branding/images', () => {
  // Branding images are org-admin-uploaded bytes (SVG included). Navigating
  // to one directly must never yield a scriptable same-origin document —
  // the response carries a bare `sandbox` CSP + nosniff instead of the SPA
  // policy (whose `script-src 'self'` would still let a hostile SVG load
  // same-origin scripts into an app-origin document).
  test('the branding-images path serves the sandbox CSP, not the SPA policy', async () => {
    const app = createApp(baseEnv);
    // No TALE_CONFIG_DIR in the test env → 404; the security headers come
    // from the path-scoped middleware and must be present regardless.
    const res = await app.fetch(
      new Request('http://localhost/branding/images/acme/logo.svg'),
    );
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toBe('sandbox');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  test('serves an uploaded SVG sandboxed with its allowlisted content type', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'tale-branding-test-'));
    try {
      const imagesDir = join(configDir, 'acme', 'branding', 'images');
      await mkdir(imagesDir, { recursive: true });
      await writeFile(
        join(imagesDir, 'logo.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>',
      );
      // The vitest server project runs under Node; shim the two BunFile
      // members the branding handler uses (`exists`, body streaming) with a
      // Blob so the real serve path executes.
      vi.stubGlobal('Bun', {
        file: (path: string) => {
          let bytes: Uint8Array<ArrayBuffer> | null = null;
          try {
            // Copy into a fresh Uint8Array so the backing store is a plain
            // ArrayBuffer (Buffer's ArrayBufferLike is not a valid BlobPart).
            bytes = new Uint8Array(readFileSync(path));
          } catch {
            bytes = null;
          }
          const blob = new Blob(bytes === null ? [] : [bytes]);
          return Object.assign(blob, {
            exists: () => Promise.resolve(bytes !== null),
          });
        },
      });
      // The branding root is read from the process env at module load, so
      // serve through a fresh module instance seeing the stubbed dir.
      vi.stubEnv('TALE_CONFIG_DIR', configDir);
      vi.resetModules();
      const freshServer = await import('./server');
      const app = freshServer.createApp(baseEnv);
      const res = await app.fetch(
        new Request('http://localhost/branding/images/acme/logo.svg'),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/svg+xml');
      // The document is fully sandboxed: opaque origin, no script execution
      // on navigation; <img>/<link rel=icon> embeds are unaffected.
      expect(res.headers.get('content-security-policy')).toBe('sandbox');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.resetModules();
      await rm(configDir, { recursive: true, force: true });
    }
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
      // Every lane runs inside the backend tier, so it is the only probe.
      components: expect.arrayContaining([
        expect.objectContaining({
          id: 'backend',
          status: expect.stringMatching(/^(operational|outage)$/),
        }),
      ]),
    });
  });
});

describe('SSE /events/file', () => {
  test('returns 401 when no session cookie is present', async () => {
    const app = createApp(baseEnv);
    // No cookie → the backend oracle is never even called; the handler
    // short-circuits the early-null branch in resolveAllowedOrgSlugs.
    const res = await app.fetch(new Request('http://localhost/events/file'));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Cookie');
    expect(res.headers.get('vary')).toBe('Cookie');
  });

  test('returns 401 when the backend oracle rejects the session', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Unauthenticated', { status: 401 }));
    const app = createApp(baseEnv);
    const res = await app.fetch(
      new Request('http://localhost/events/file', {
        headers: { cookie: 'better-auth.session_token=invalid' },
      }),
    );
    expect(res.status).toBe(401);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  test('streams text/event-stream when session resolves to org memberships', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ userId: 'u1', orgSlugs: ['acme'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const app = createApp(baseEnv);
    const res = await app.fetch(
      new Request('http://localhost/events/file', {
        headers: { cookie: 'better-auth.session_token=valid' },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('vary')).toBe('Cookie');
    expect(res.body).toBeInstanceOf(ReadableStream);
    // Cancel to drop the SSE client and avoid leaking the controller.
    await res.body?.cancel();
    fetchSpy.mockRestore();
  });

  test('writes a `: ping` comment frame every 30 s and stops on cancel', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ userId: 'u1', orgSlugs: ['acme'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    try {
      const app = createApp(baseEnv);
      const res = await app.fetch(
        new Request('http://localhost/events/file', {
          headers: { cookie: 'better-auth.session_token=valid' },
        }),
      );
      expect(res.status).toBe(200);
      // The handler enqueues string frames; Response types the body as bytes.
      const reader = (
        res.body as unknown as ReadableStream<string>
      ).getReader();
      expect((await reader.read()).value).toBe(
        'data: {"type":"connected"}\n\n',
      );

      // Config changes are rare: without the heartbeat a quiet client sits
      // silent until Bun's 255 s idleTimeout cuts the socket. Nothing must
      // be written before the interval elapses (a comment frame is not an
      // event), and one frame per interval after it.
      await vi.advanceTimersByTimeAsync(29_999);
      let pending = false;
      const race = reader.read().then((chunk) => {
        pending = true;
        return chunk;
      });
      await Promise.resolve();
      expect(pending).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect((await race).value).toBe(': ping\n\n');
      await vi.advanceTimersByTimeAsync(30_000);
      expect((await reader.read()).value).toBe(': ping\n\n');

      // Cancelling the stream must clear the interval — a leaked timer
      // would keep enqueueing into a closed controller forever.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await reader.cancel();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(90_000);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    } finally {
      fetchSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  test('bounds the session-oracle round trip with an abort signal', async () => {
    // A hung backend must not leave `/events/file` (and `/canvas-preview`,
    // which shares the oracle) pending forever; the fetch carries a timeout
    // signal and the existing catch turns the abort into a 401.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async (_input, init) => {
        const signal = init?.signal;
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal?.aborted).toBe(false);
        // Behave like a backend that never answers: reject the way undici
        // does once the signal fires.
        throw new DOMException('The operation timed out.', 'TimeoutError');
      });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = createApp(baseEnv);
    const res = await app.fetch(
      new Request('http://localhost/events/file', {
        headers: { cookie: 'better-auth.session_token=valid' },
      }),
    );
    expect(res.status).toBe(401);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    fetchSpy.mockRestore();
  });

  test('returns 404 when FILE_EVENTS_ENABLED is false', async () => {
    const app = createApp({ ...baseEnv, FILE_EVENTS_ENABLED: false });
    const res = await app.fetch(new Request('http://localhost/events/file'));
    expect(res.status).toBe(404);
  });
});

describe('shouldDeliverSseEvent — fan-out predicate', () => {
  const allowed = new Set(['acme']);

  test('delivers an event whose orgSlug the client is a member of', () => {
    expect(
      shouldDeliverSseEvent({ type: 'config', orgSlug: 'acme' }, allowed),
    ).toBe(true);
  });

  test('drops an event for an org the client is not a member of', () => {
    expect(
      shouldDeliverSseEvent({ type: 'config', orgSlug: 'globex' }, allowed),
    ).toBe(false);
  });

  // Default-deny: an event without an orgSlug must reach no client — the
  // legacy behavior fanned it out to everyone, which is the cross-org
  // metadata leak this predicate closes (R18-P2-a).
  test('drops an event that carries no orgSlug', () => {
    expect(shouldDeliverSseEvent({ type: 'config' }, allowed)).toBe(false);
  });

  test('drops a non-string orgSlug and non-object events', () => {
    expect(
      shouldDeliverSseEvent({ type: 'config', orgSlug: 42 }, allowed),
    ).toBe(false);
    expect(shouldDeliverSseEvent(null, allowed)).toBe(false);
    expect(shouldDeliverSseEvent('acme', allowed)).toBe(false);
  });
});
