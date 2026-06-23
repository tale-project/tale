import * as vm from 'node:vm';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { wrapCanvasPreviewHtml } from './lib/canvas-preview-shell';
import { authorizeScreencast, createApp, SCREENCAST_ROUTE_RE } from './server';

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
  test('returns 401 when no session cookie is present', async () => {
    const app = createApp(baseEnv);
    // No cookie → convex auth is never even called; the handler short-
    // circuits the early-null branch in resolveAllowedOrgSlugs.
    const res = await app.fetch(new Request('http://localhost/events/file'));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Cookie');
    expect(res.headers.get('vary')).toBe('Cookie');
  });

  test('returns 401 when convex auth lookup rejects the session', async () => {
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

  test('returns 404 when FILE_EVENTS_ENABLED is false', async () => {
    const app = createApp({ ...baseEnv, FILE_EVENTS_ENABLED: false });
    const res = await app.fetch(new Request('http://localhost/events/file'));
    expect(res.status).toBe(404);
  });
});

describe('SCREENCAST_ROUTE_RE', () => {
  test('matches /screencast/<threadId> and captures the (encoded) segment', () => {
    const m = SCREENCAST_ROUTE_RE.exec('/screencast/thread-abc');
    expect(m?.[1]).toBe('thread-abc');
    // Percent-encoded segment (the client encodeURIComponent's the threadId).
    expect(SCREENCAST_ROUTE_RE.exec('/screencast/a%2Fb')?.[1]).toBe('a%2Fb');
  });

  test('does NOT match a deeper path or a bare /screencast', () => {
    expect(SCREENCAST_ROUTE_RE.exec('/screencast/a/b')).toBeNull();
    expect(SCREENCAST_ROUTE_RE.exec('/screencast/')).toBeNull();
    expect(SCREENCAST_ROUTE_RE.exec('/screencast')).toBeNull();
  });
});

describe('authorizeScreencast — auth oracle propagation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns 401 without ever calling convex when no cookie is present', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await authorizeScreencast('thread-1', undefined);
    expect(res).toEqual({
      ok: false,
      status: 401,
      body: 'Unauthenticated',
      contentType: 'text/plain',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('returns the resolved sessionId on a 200 from the oracle', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ sessionId: 'sess-x' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const res = await authorizeScreencast('thread-1', 'better-auth.x=1');
    // A view request (control omitted) → control:false in the result.
    expect(res).toEqual({ ok: true, sessionId: 'sess-x', control: false });
  });

  test('reflects an oracle-granted control flag and requests it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ sessionId: 'sess-x', control: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const res = await authorizeScreencast('thread-1', 'c=1', true);
    expect(res).toEqual({ ok: true, sessionId: 'sess-x', control: true });
    const calledArg = fetchSpy.mock.calls[0]?.[0];
    if (typeof calledArg !== 'string') {
      throw new Error('expected fetch to be called with a string URL');
    }
    expect(calledArg).toContain('control=1');
  });

  test('forwards the threadId to the oracle as a query param', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ sessionId: 's' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await authorizeScreencast('thread/weird', 'c=1');
    const calledArg = fetchSpy.mock.calls[0]?.[0];
    // authorizeScreencast always passes a string URL to fetch.
    if (typeof calledArg !== 'string') {
      throw new Error('expected fetch to be called with a string URL');
    }
    expect(calledArg).toContain('/api/sandbox/screencast-auth');
    expect(calledArg).toContain(
      `threadId=${encodeURIComponent('thread/weird')}`,
    );
  });

  test('propagates a 403 (cross-org / no thread access) verbatim', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Forbidden', { status: 403 }),
    );
    const res = await authorizeScreencast('thread-1', 'c=1');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(403);
      expect(res.body).toBe('Forbidden');
      // The oracle sends plain text; we forward whatever content-type it set.
      expect(res.contentType).toContain('text/plain');
    }
  });

  test('propagates a 409 session_not_running with its JSON body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'session_not_running' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const res = await authorizeScreencast('thread-1', 'c=1');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(409);
      expect(res.contentType).toContain('application/json');
      expect(JSON.parse(res.body)).toEqual({ error: 'session_not_running' });
    }
  });

  test('maps a 200 with no sessionId to a 502 (malformed oracle answer)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const res = await authorizeScreencast('thread-1', 'c=1');
    expect(res).toMatchObject({ ok: false, status: 502 });
  });

  test('maps a fetch transport failure to a 502', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('connection refused'),
    );
    const res = await authorizeScreencast('thread-1', 'c=1');
    expect(res).toMatchObject({ ok: false, status: 502 });
  });
});
