import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  applySecurityHeaders,
  buildCspHeader,
  defaultReactServerSecurityHeaders,
  extractInlineScriptHashes,
  withScriptHashes,
  type SecurityHeadersConfig,
} from './security-headers';

function sha256Token(body: string): string {
  return `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;
}

function apply(config: SecurityHeadersConfig, isSecure = true): Headers {
  const res = new Response('<!doctype html>', {
    headers: { 'Content-Type': 'text/html' },
  });
  return applySecurityHeaders(res, config, isSecure).headers;
}

describe('defaultReactServerSecurityHeaders (web + docs contract)', () => {
  it('emits the full securityheaders.com / Observatory quick-test set on HTTPS', () => {
    const h = apply(defaultReactServerSecurityHeaders, true);
    expect(h.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(h.get('Content-Security-Policy')).toContain(
      "frame-ancestors 'none'",
    );
    expect(h.get('Content-Security-Policy')).toContain("object-src 'none'");
    // Regression: `media-src 'none'` blocked the docs tutorial videos —
    // same-origin media must stay allowed.
    expect(h.get('Content-Security-Policy')).toContain("media-src 'self'");
    expect(h.get('Strict-Transport-Security')).toBe('max-age=15552000');
    expect(h.get('X-Content-Type-Options')).toBe('nosniff');
    expect(h.get('X-Frame-Options')).toBe('DENY');
    expect(h.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    // The four headers that previously could not be emitted at all.
    expect(h.get('Permissions-Policy')).toBeTruthy();
    expect(h.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(h.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(h.get('X-Permitted-Cross-Domain-Policies')).toBe('none');
  });

  it('denies hardware/payment features but leaves clipboard on its default', () => {
    const pp = apply(defaultReactServerSecurityHeaders).get(
      'Permissions-Policy',
    );
    expect(pp).toContain('camera=()');
    expect(pp).toContain('microphone=()');
    expect(pp).toContain('geolocation=()');
    expect(pp).toContain('payment=()');
    // Clipboard is intentionally NOT locked — the docs copy buttons need it.
    expect(pp).not.toContain('clipboard');
  });

  it('omits HSTS on a plaintext (dev) request', () => {
    const h = apply(defaultReactServerSecurityHeaders, false);
    expect(h.get('Strict-Transport-Security')).toBeNull();
    // Non-transport headers still apply in dev.
    expect(h.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('applySecurityHeaders omission semantics', () => {
  it('omits each header when its key is false', () => {
    const h = apply({
      contentSecurityPolicy: false,
      strictTransportSecurity: false,
      xContentTypeOptions: false,
      xFrameOptions: false,
      referrerPolicy: false,
      permissionsPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      xPermittedCrossDomainPolicies: false,
    });
    expect(h.get('Content-Security-Policy')).toBeNull();
    expect(h.get('Strict-Transport-Security')).toBeNull();
    expect(h.get('X-Content-Type-Options')).toBeNull();
    expect(h.get('X-Frame-Options')).toBeNull();
    expect(h.get('Referrer-Policy')).toBeNull();
    expect(h.get('Permissions-Policy')).toBeNull();
    expect(h.get('Cross-Origin-Opener-Policy')).toBeNull();
    expect(h.get('Cross-Origin-Resource-Policy')).toBeNull();
    expect(h.get('X-Permitted-Cross-Domain-Policies')).toBeNull();
  });
});

describe('buildCspHeader', () => {
  it('kebab-cases camelCase directive names and space-joins sources', () => {
    expect(
      buildCspHeader({
        defaultSrc: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
      }),
    ).toBe(
      "default-src 'self'; frame-ancestors 'none'; img-src 'self' data: blob:",
    );
  });
});

describe('extractInlineScriptHashes', () => {
  it('hashes a bare inline <script> and matches the browser hash', () => {
    const body = `(function(){document.documentElement.classList.add('dark')})()`;
    const html = `<!doctype html><head><script>${body}</script></head>`;
    expect(extractInlineScriptHashes(html)).toEqual([sha256Token(body)]);
  });

  it('skips external (src=) scripts and application/ld+json data blocks', () => {
    const html = `
      <script src="/app/main.js"></script>
      <script type="application/ld+json">{"@type":"WebSite"}</script>
      <script>theme()</script>
    `;
    expect(extractInlineScriptHashes(html)).toEqual([sha256Token('theme()')]);
  });

  it('returns [] when there are no bare inline scripts', () => {
    expect(extractInlineScriptHashes('<script src="/x.js"></script>')).toEqual(
      [],
    );
  });
});

describe('withScriptHashes', () => {
  it('pins script-src to self + hashes and drops unsafe-inline', () => {
    const hashes = [sha256Token('theme()')];
    const tightened = withScriptHashes(
      defaultReactServerSecurityHeaders,
      hashes,
    );
    const csp = tightened.contentSecurityPolicy;
    if (!csp) throw new Error('expected a CSP');
    expect(csp.scriptSrc).toEqual(["'self'", ...hashes]);
    expect(csp.scriptSrc).not.toContain("'unsafe-inline'");
    // style-src keeps unsafe-inline (Tailwind) — 0-penalty on Observatory.
    expect(csp.styleSrc).toContain("'unsafe-inline'");
  });

  it('is a no-op with no hashes or no CSP', () => {
    expect(withScriptHashes(defaultReactServerSecurityHeaders, [])).toBe(
      defaultReactServerSecurityHeaders,
    );
    const noCsp: SecurityHeadersConfig = { contentSecurityPolicy: false };
    expect(withScriptHashes(noCsp, [sha256Token('x')])).toBe(noCsp);
  });

  it('emits an Observatory-A+-grade script-src (self + hash, no unsafe-inline)', () => {
    const hashes = [sha256Token('theme()')];
    const h = apply(
      withScriptHashes(defaultReactServerSecurityHeaders, hashes),
    );
    const csp = h.get('Content-Security-Policy') ?? '';
    const scriptSrc = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('script-src'));
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain(hashes[0]);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });
});
