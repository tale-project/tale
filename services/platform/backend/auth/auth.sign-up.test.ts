// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
 * asked for anything, and the paths that decide without the database must
 * never ask it.
 */

/** A deployment that would answer the emptiness probe, and counts the asking. */
function deployment(hasUsers: boolean) {
  let asked = 0;
  return {
    deploymentHasUsers: () => {
      asked += 1;
      return Promise.resolve(hasUsers);
    },
    timesAsked: () => asked,
  };
}

describe('signUpAllowed', () => {
  it('lets the deployment create its first account over HTTP', async () => {
    const empty = deployment(false);
    await expect(
      signUpAllowed({
        overHttp: true,
        openSignUp: false,
        deploymentHasUsers: empty.deploymentHasUsers,
      }),
    ).resolves.toBe(true);
  });

  it('closes the route once an account exists', async () => {
    const occupied = deployment(true);
    await expect(
      signUpAllowed({
        overHttp: true,
        openSignUp: false,
        deploymentHasUsers: occupied.deploymentHasUsers,
      }),
    ).resolves.toBe(false);
  });

  it('always allows the server-side call an administrator door makes', async () => {
    // `POST /api/app/users/members` reaches Better Auth without a request; so
    // does provisioning. Closing those would close account creation entirely.
    for (const hasUsers of [false, true]) {
      const target = deployment(hasUsers);
      await expect(
        signUpAllowed({
          overHttp: false,
          openSignUp: false,
          deploymentHasUsers: target.deploymentHasUsers,
        }),
      ).resolves.toBe(true);
      // An administrator's door must not pay for — or fail on — a query whose
      // answer it ignores.
      expect(target.timesAsked()).toBe(0);
    }
  });

  it('reopens the route only where a test deployment asks for it', async () => {
    const occupied = deployment(true);
    await expect(
      signUpAllowed({
        overHttp: true,
        openSignUp: true,
        deploymentHasUsers: occupied.deploymentHasUsers,
      }),
    ).resolves.toBe(true);
    expect(occupied.timesAsked()).toBe(0);
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

describe('the sign-up route', () => {
  /** One row is enough to say the deployment is not empty; any other query
   * would mean the hook let the request through to the adapter. */
  function stubSql(rows: { id: string }[]) {
    const queries: string[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      queries.push(strings.join('?').replaceAll(/\s+/g, ' ').trim());
      return Promise.resolve(rows);
    }) as unknown as Sql;
    return { sql, queries };
  }

  function signUpRequest() {
    return new Request('https://tale.example.com/api/auth/sign-up/email', {
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
    });
  }

  function authWith(sql: Sql) {
    return createAuth({
      databaseUrl: 'postgresql://tale:pw@127.0.0.1:1/tale_app',
      secret: 'test-secret-at-least-16-chars',
      baseUrl: 'https://tale.example.com',
      sql,
    });
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses an HTTP sign-up before the adapter is touched', async () => {
    // A tester who opened their own stack must not turn this green.
    vi.stubEnv(OPEN_SIGN_UP_ENV, '');
    const { sql, queries } = stubSql([{ id: 'existing-account' }]);
    const response = await authWith(sql).handler(signUpRequest());
    expect(response.status).toBe(403);
    const body = (await response.json()) as {
      message?: string;
      code?: string;
    };
    expect(body.message).toBe(SIGN_UP_CLOSED_MESSAGE);
    // The manual box and the app-only registry row both name this code.
    expect(body.code).toBe('SIGN_UP_CLOSED');
    // The only question asked was whether the deployment already has one.
    expect(queries).toEqual(['SELECT "id" FROM "user" LIMIT 1']);
  });

  it('lets an empty deployment past the gate to create its first account', async () => {
    vi.stubEnv(OPEN_SIGN_UP_ENV, '');
    const { sql } = stubSql([]);
    const response = await authWith(sql).handler(signUpRequest());
    // The stub answers no adapter query, so account creation itself fails —
    // what this pins is that the GATE let the request through rather than
    // refusing it, which a wrong emptiness test would break silently.
    expect(response.status).not.toBe(403);
  });

  it('answers an opened test deployment without asking the database', async () => {
    vi.stubEnv(OPEN_SIGN_UP_ENV, 'true');
    const { sql, queries } = stubSql([{ id: 'existing-account' }]);
    const response = await authWith(sql).handler(signUpRequest());
    expect(response.status).not.toBe(403);
    expect(queries).toEqual([]);
  });
});
