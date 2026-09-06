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
