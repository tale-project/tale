import { describe, expect, it } from 'vitest';

import {
  LOCALE_COOKIE_NAME,
  readLocaleCookie,
  serializeLocaleCookie,
} from './cookie';

describe('serializeLocaleCookie', () => {
  it('serializes a minimal dev cookie (no domain, not secure)', () => {
    expect(serializeLocaleCookie({ value: 'de', secure: false })).toBe(
      'tale_locale=de; Path=/; Max-Age=31536000; SameSite=Lax',
    );
  });

  it('includes Domain when provided', () => {
    expect(
      serializeLocaleCookie({
        value: 'fr',
        domain: '.tale.dev',
        secure: true,
      }),
    ).toBe(
      'tale_locale=fr; Path=/; Max-Age=31536000; SameSite=Lax; Domain=.tale.dev; Secure',
    );
  });

  it('honors a custom maxAgeSeconds', () => {
    expect(
      serializeLocaleCookie({
        value: 'en',
        secure: false,
        maxAgeSeconds: 60,
      }),
    ).toBe('tale_locale=en; Path=/; Max-Age=60; SameSite=Lax');
  });

  it('throws on unsupported locale values', () => {
    expect(() =>
      // @ts-expect-error — exercising the runtime guard
      serializeLocaleCookie({ value: 'es', secure: false }),
    ).toThrow(/unsupported value/);
  });

  it('exposes the canonical cookie name', () => {
    expect(LOCALE_COOKIE_NAME).toBe('tale_locale');
  });
});

describe('readLocaleCookie', () => {
  it('returns null for missing or empty header', () => {
    expect(readLocaleCookie(null)).toBeNull();
    expect(readLocaleCookie(undefined)).toBeNull();
    expect(readLocaleCookie('')).toBeNull();
  });

  it('reads the locale cookie from a single-cookie header', () => {
    expect(readLocaleCookie('tale_locale=de')).toBe('de');
  });

  it('reads the locale cookie among several cookies', () => {
    expect(readLocaleCookie('session=abc; tale_locale=fr; theme=dark')).toBe(
      'fr',
    );
  });

  it('returns null when the cookie is unset', () => {
    expect(readLocaleCookie('session=abc; theme=dark')).toBeNull();
  });

  it('rejects unsupported values (e.g. legacy regional or other languages)', () => {
    expect(readLocaleCookie('tale_locale=de-CH')).toBeNull();
    expect(readLocaleCookie('tale_locale=es')).toBeNull();
  });

  it('handles surrounding whitespace around values', () => {
    expect(readLocaleCookie('  tale_locale = en ')).toBe('en');
  });
});
