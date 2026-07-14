import { describe, expect, it } from 'vitest';

import {
  applySecurityHeaders,
  buildCspHeader,
  defaultReactServerSecurityHeaders,
  type SecurityHeadersConfig,
} from './security-headers';

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
