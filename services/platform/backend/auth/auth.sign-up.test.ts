// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { createAuth } from './auth.ts';
import {
  openSignUpEnabled,
  OPEN_SIGN_UP_ENV,
  SIGN_UP_CLOSED_MESSAGE,
  signUpAllowed,
} from './sign-up-gate.ts';

/**
 * The deployment's first account is created over HTTP — the setup flow, or the
 * managed CLI's bootstrap. Every later account is an administrator's
 * server-side call. An open `/sign-up/email` answers anyone who can reach the
 * backend, and `backend-api` is dual-homed onto the sandbox network, so that
 * includes code inside an agent session. These tests hold the gate and its
 * wiring: the refusal must happen in the before-hook, before the adapter is
 * asked for anything.
 */

describe('signUpAllowed', () => {
  it('lets the deployment create its first account over HTTP', () => {
    expect(
      signUpAllowed({
        overHttp: true,
        deploymentHasUsers: false,
        openSignUp: false,
      }),
    ).toBe(true);
  });

  it('closes the route once an account exists', () => {
    expect(
      signUpAllowed({
        overHttp: true,
        deploymentHasUsers: true,
        openSignUp: false,
      }),
    ).toBe(false);
  });

  it('always allows the server-side call an administrator door makes', () => {
    // `POST /api/app/users/members` reaches Better Auth without a request; so
    // does provisioning. Closing those would close account creation entirely.
    for (const deploymentHasUsers of [false, true])
      expect(
        signUpAllowed({
          overHttp: false,
          deploymentHasUsers,
          openSignUp: false,
        }),
      ).toBe(true);
  });

  it('reopens the route only where a test deployment asks for it', () => {
    expect(
      signUpAllowed({
        overHttp: true,
        deploymentHasUsers: true,
        openSignUp: true,
      }),
    ).toBe(true);
  });
});

describe('openSignUpEnabled', () => {
  it('is off unless the environment says exactly true', () => {
    expect(openSignUpEnabled({})).toBe(false);
    expect(openSignUpEnabled({ [OPEN_SIGN_UP_ENV]: '' })).toBe(false);
    expect(openSignUpEnabled({ [OPEN_SIGN_UP_ENV]: 'false' })).toBe(false);
    // A careless truthy value must not open a deployment.
    expect(openSignUpEnabled({ [OPEN_SIGN_UP_ENV]: '1' })).toBe(false);
    expect(openSignUpEnabled({ [OPEN_SIGN_UP_ENV]: 'TRUE' })).toBe(false);
    expect(openSignUpEnabled({ [OPEN_SIGN_UP_ENV]: 'true' })).toBe(true);
  });
});

describe('the sign-up route of a deployment that has accounts', () => {
  /** One row is enough to say the deployment is not empty; any other query
   * would mean the hook let the request through to the adapter. */
  function stubSql() {
    const queries: string[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      queries.push(strings.join('?').replaceAll(/\s+/g, ' ').trim());
      return Promise.resolve([{ id: 'existing-account' }]);
    }) as unknown as Sql;
    return { sql, queries };
  }

  it('refuses an HTTP sign-up before the adapter is touched', async () => {
    const { sql, queries } = stubSql();
    const auth = createAuth({
      databaseUrl: 'postgresql://tale:pw@127.0.0.1:1/tale_app',
      secret: 'test-secret-at-least-16-chars',
      baseUrl: 'https://tale.example.com',
      sql,
    });
    const response = await auth.handler(
      new Request('https://tale.example.com/api/auth/sign-up/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://tale.example.com',
        },
        body: JSON.stringify({
          email: 'stranger@example.com',
          password: 'Stranger!Password1',
          name: 'Stranger',
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toContain(SIGN_UP_CLOSED_MESSAGE);
    // The only question asked was whether the deployment already has one.
    expect(queries).toEqual(['SELECT "id" FROM "user" LIMIT 1']);
  });
});
