// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { createAuth } from './auth.ts';

/**
 * Better Auth's origin check refuses a cookie-bearing POST whose `Origin` is
 * not trusted (403 INVALID_ORIGIN). On a multi-domain deployment that is the
 * difference between "sign-in works on the second domain" and "the login form
 * fails with an opaque 403" — so every configured origin must reach
 * `trustedOrigins`, and the passkey ceremony's origin list with it.
 *
 * `createAuth` only constructs a lazy `pg.Pool`, so no database is touched.
 */

const BASE = {
  databaseUrl: 'postgresql://tale:pw@localhost:5432/tale_app',
  secret: 'test-secret-at-least-16-chars',
  // The auth config never queries through this in construction.
  sql: null as unknown as Sql,
};

describe('createAuth — trusted origins across domains', () => {
  it('trusts exactly the canonical origin when no extras are configured', () => {
    const auth = createAuth({ ...BASE, baseUrl: 'https://tale.example.com' });
    expect(auth.options.trustedOrigins).toEqual(['https://tale.example.com']);
  });

  it('trusts every additional origin alongside the canonical one', () => {
    const auth = createAuth({
      ...BASE,
      baseUrl: 'https://tale.example.com',
      additionalOrigins: [
        'https://tale.partner.example',
        'https://app.other.example',
      ],
    });
    expect(auth.options.trustedOrigins).toEqual([
      'https://tale.example.com',
      'https://tale.partner.example',
      'https://app.other.example',
    ]);
  });

  it('does not list the canonical origin twice when it repeats in the extras', () => {
    // Better Auth would tolerate a duplicate, but a doubled entry in the
    // logged trustedOrigins list is a false lead when debugging a 403.
    const auth = createAuth({
      ...BASE,
      baseUrl: 'https://tale.example.com',
      additionalOrigins: [
        'https://tale.example.com',
        'https://tale.partner.example',
      ],
    });
    expect(auth.options.trustedOrigins).toEqual([
      'https://tale.example.com',
      'https://tale.partner.example',
    ]);
  });

  it('keeps the passkey RP ID on the canonical host while accepting each origin', () => {
    // WebAuthn binds a credential to ONE Relying Party ID, so the rpID stays
    // the canonical host; the origin list is what lets the ceremony run.
    const auth = createAuth({
      ...BASE,
      baseUrl: 'https://tale.example.com',
      additionalOrigins: ['https://tale.partner.example'],
    });
    const passkey = auth.options.plugins?.find((p) => p.id === 'passkey') as
      | { options?: { rpID?: string; origin?: string | string[] } }
      | undefined;
    expect(passkey?.options?.rpID).toBe('tale.example.com');
    expect(passkey?.options?.origin).toEqual([
      'https://tale.example.com',
      'https://tale.partner.example',
    ]);
  });

  it('still refuses a non-loopback http base URL (no silent cookie downgrade)', () => {
    expect(() =>
      createAuth({ ...BASE, baseUrl: 'http://tale.example.com' }),
    ).toThrow(/must use HTTPS/);
  });
});

describe('createAuth — additional origins hold the HTTPS line', () => {
  it('refuses a plaintext additional origin on an HTTPS deployment', () => {
    // Better Auth's origin check would otherwise TRUST http://plain.example,
    // so anyone able to tamper with that origin's traffic could mount the very
    // cross-site requests the check exists to stop. The proxy blocks a
    // plaintext entry in its default modes but not under TLS_MODE=external.
    expect(() =>
      createAuth({
        ...BASE,
        baseUrl: 'https://tale.example.com',
        additionalOrigins: ['http://plain.example'],
      }),
    ).toThrow(/ADDITIONAL_SITE_URLS must use HTTPS/);
  });

  it('still allows a loopback http origin, exactly as SITE_URL does (dev)', () => {
    const auth = createAuth({
      ...BASE,
      baseUrl: 'http://localhost:3000',
      additionalOrigins: ['http://127.0.0.1:3000'],
    });
    expect(auth.options.trustedOrigins).toEqual([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ]);
  });

  it('names the offending origin so the operator can find it', () => {
    expect(() =>
      createAuth({
        ...BASE,
        baseUrl: 'https://tale.example.com',
        additionalOrigins: [
          'https://fine.example',
          'http://the-bad-one.example',
        ],
      }),
    ).toThrow(/http:\/\/the-bad-one\.example/);
  });
});
