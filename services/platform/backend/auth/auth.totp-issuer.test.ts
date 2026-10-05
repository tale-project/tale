// @vitest-environment node

import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { createAuth } from './auth.ts';

const PASSWORD = 'Synthetic-password-123';
const EMAIL = 'authenticator@example.test';
const BASE = {
  databaseUrl: 'postgresql://tale:pw@localhost:5432/tale_app',
  secret: 'test-secret-at-least-16-chars',
  baseUrl: 'https://tale.example.test',
  sql: null as unknown as Sql,
};

describe('authenticator names', () => {
  it.each(['', ' ', '<TE>', 'te:issuer', 'te/pr', 'a'.repeat(33)])(
    'refuses the invalid environment %j before creating auth',
    (totpEnvironment) => {
      expect(() => createAuth({ ...BASE, totpEnvironment })).toThrow(
        /TOTP_ENVIRONMENT/,
      );
    },
  );
  it.each(['', ' ', 'Example: Admin', 'Example/Partner', 'a'.repeat(41)])(
    'refuses the invalid client name %j before creating auth',
    (totpClientName) => {
      expect(() => createAuth({ ...BASE, totpClientName })).toThrow(
        /TOTP_CLIENT_NAME/,
      );
    },
  );
  it.each([
    [undefined, undefined, 'Tale Platform'],
    [undefined, 'pr', 'Tale Platform'],
    [undefined, ' PR ', 'Tale Platform'],
    [undefined, 'te', 'Tale Platform TE'],
    ['Tale', 'te', 'Tale Platform TE'],
    ['Example plus', undefined, 'Example plus Tale Platform'],
    ['Example plus', 'pr', 'Example plus Tale Platform'],
    ['Example plus', 'te', 'Example plus Tale Platform TE'],
    [' Example  plus ', 'preview-42', 'Example plus Tale Platform PREVIEW-42'],
  ])(
    'names client %j in environment %j %j in enrollment and existing-secret URIs',
    async (totpClientName, totpEnvironment, issuer) => {
      const configured = createAuth({
        ...BASE,
        totpClientName,
        totpEnvironment,
      });
      // Exercise the configured two-factor plugin with its real URI generator.
      // In-memory credentials keep unrelated SQL hooks out of this proof.
      const auth = betterAuth({
        ...configured.options,
        database: memoryAdapter({
          user: [],
          account: [],
          session: [],
          verification: [],
          twoFactor: [],
        }),
        hooks: undefined,
        databaseHooks: undefined,
        plugins: configured.options.plugins.filter(
          (plugin) => plugin.id === 'two-factor',
        ),
      });
      await auth.api.signUpEmail({
        body: { email: EMAIL, name: 'Authenticator', password: PASSWORD },
      });
      const signedIn = await auth.api.signInEmail({
        body: { email: EMAIL, password: PASSWORD },
        asResponse: true,
      });
      const headers = new Headers({
        cookie: signedIn.headers
          .getSetCookie()
          .map((cookie) => cookie.split(';')[0])
          .join('; '),
      });
      const enrollment = await auth.api.enableTwoFactor({
        body: { password: PASSWORD },
        headers,
      });
      if (!('totpURI' in enrollment))
        throw new Error('Expected authenticator enrollment');
      const existing = await auth.api.getTOTPURI({
        body: { password: PASSWORD },
        headers,
      });
      for (const value of [enrollment.totpURI, existing.totpURI]) {
        const uri = new URL(value);
        expect(uri.protocol).toBe('otpauth:');
        expect(decodeURIComponent(uri.pathname.slice(1))).toBe(
          `${issuer}:${EMAIL}`,
        );
        expect(uri.searchParams.get('issuer')).toBe(issuer);
        expect(uri.searchParams.get('digits')).toBe('6');
        expect(uri.searchParams.get('period')).toBe('30');
      }
      expect(new URL(existing.totpURI).searchParams.get('secret')).toBe(
        new URL(enrollment.totpURI).searchParams.get('secret'),
      );
    },
  );
});
