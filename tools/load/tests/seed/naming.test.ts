import { describe, expect, test } from 'bun:test';

import { getCookies } from 'better-auth/cookies';
import { makeSignature } from 'better-auth/crypto';

import {
  organizationSlug,
  sessionCookieName,
  sessionId,
  signedSessionCookieValue,
  userEmail,
  userId,
} from '../../src/plan.ts';
import { mintedSessionCookie } from '../../src/seed/auth.ts';
import {
  accountId,
  displayNames,
  memberId,
  organizationName,
  populationFor,
} from '../../src/seed/population.ts';

const population = populationFor({
  runId: 'abcd1234',
  emailDomain: 'load.tale.invalid',
  password: 'Aa1!aaaaaaaaaaaa',
  sessionsMinted: true,
  users: 300,
  orgSize: 50,
  megaOrgSize: 100,
});

/** The platform's org slug rule (`lib/shared/constants/org-slug.ts`). */
const ORG_SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;

describe('deterministic naming', () => {
  test('ids and e-mails derive from the run id and index alone', () => {
    expect(userId('abcd1234', 7)).toBe('load_abcd1234_u7');
    expect(sessionId('abcd1234', 7)).toBe('load_abcd1234_s7');
    expect(accountId('abcd1234', 7)).toBe('load_abcd1234_a7');
    expect(memberId('abcd1234', 3, 7)).toBe('load_abcd1234_m3_7');
    expect(userEmail(population, 7)).toBe('load-abcd1234-u7@load.tale.invalid');
    expect(organizationSlug('abcd1234', 6)).toBe('load-abcd1234-o6');
  });

  test('organization slugs pass the platform slug rule at any scale', () => {
    expect(organizationSlug('a'.repeat(16), 9_999_999)).toMatch(ORG_SLUG);
    expect(organizationSlug('abcd1234', 0)).toMatch(ORG_SLUG);
  });

  test('display names do not depend on batch boundaries', () => {
    const whole = displayNames('abcd1234', 0, 3000);
    const pieces = [
      ...displayNames('abcd1234', 0, 1000),
      ...displayNames('abcd1234', 1000, 2047),
      ...displayNames('abcd1234', 2047, 3000),
    ];
    expect(pieces).toEqual(whole);
    expect(displayNames('abcd1234', 1500, 1501)).toEqual([whole[1500] ?? '']);
    expect(new Set(whole).size).toBeGreaterThan(2900);
  });

  test('names differ between runs and are stable within one', () => {
    expect(displayNames('abcd1234', 0, 20)).toEqual(
      displayNames('abcd1234', 0, 20),
    );
    expect(displayNames('zzzz9999', 0, 20)).not.toEqual(
      displayNames('abcd1234', 0, 20),
    );
    expect(organizationName('abcd1234', 4)).toBe(
      organizationName('abcd1234', 4),
    );
    expect(organizationName('abcd1234', 4).length).toBeGreaterThan(0);
  });
});

describe('session cookies', () => {
  test('the cookie name follows Better Auth for http and https sites', () => {
    for (const site of ['http://127.0.0.1:4105', 'https://tale.example.com']) {
      const expected = getCookies({
        baseURL: site,
        advanced: {
          cookiePrefix: 'better-auth',
          useSecureCookies: site.startsWith('https:'),
        },
      }).sessionToken.name;
      expect(sessionCookieName(site)).toBe(expected);
    }
  });

  test('the signed value is what Better Auth signs and verifies', async () => {
    const secret = 'test-secret-with-enough-entropy-0123456789';
    const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    const signature = await makeSignature(token, secret);
    expect(signedSessionCookieValue(secret, token)).toBe(
      encodeURIComponent(`${token}.${signature}`),
    );
    // better-call refuses a signature that is not 44 chars ending in '='.
    const decoded = decodeURIComponent(signedSessionCookieValue(secret, token));
    const sig = decoded.slice(decoded.lastIndexOf('.') + 1);
    expect(sig).toHaveLength(44);
    expect(sig.endsWith('=')).toBe(true);
  });

  test('a minted cookie header names the cookie and carries the token', () => {
    const header = mintedSessionCookie(
      'http://127.0.0.1:4105',
      's3cret',
      'abcd1234',
      5,
    );
    expect(header.startsWith('better-auth.session_token=')).toBe(true);
    expect(header).not.toContain(';');
  });
});
