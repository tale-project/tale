// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildSessionCookie } from '../../core/enterprise_sso/login/finish_login.ts';
import type { ActionCtx } from '../../core/lib/ctx.ts';
import { createSsoRoutes, finishLoginPg } from './routes.ts';

/**
 * The pre-auth `/api/sso` surface: only the protocol doors the login page
 * and the IdPs actually drive exist. Two doors used to be mounted with no
 * caller anywhere — `GET /set-session` minted a session cookie for ANY
 * token in the query string (a login-CSRF primitive), and `POST /discover`
 * let anonymous callers learn which org owns an email domain — so their
 * absence is pinned here.
 */

const SECRET = 'route-test-secret';

/** A Sql double that refuses every query — these doors must answer before
 * touching the database. */
function refusingSql(): Sql {
  const tag = () => {
    throw new Error('the database must not be reached');
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(tag, { begin: tag }) as unknown as Sql;
}

describe('/api/sso — retired doors are gone', () => {
  it('answers 404 for GET /set-session (the token→cookie interstitial)', async () => {
    const app = createSsoRoutes({ sql: refusingSql() });

    const res = await app.request(
      'http://backend-api:3005/set-session?token=attacker-session-token',
    );

    expect(res.status).toBe(404);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('answers 404 for POST /discover (email-domain routing)', async () => {
    const app = createSsoRoutes({ sql: refusingSql() });

    const res = await app.request('http://backend-api:3005/discover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'someone@acme.test' }),
    });

    expect(res.status).toBe(404);
  });
});

describe("finishLoginPg — the session cookie is the shared builder's", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = SECRET;
    delete process.env.BASE_PATH;
  });

  afterEach(() => {
    delete process.env.BETTER_AUTH_SECRET;
  });

  it("sets exactly buildSessionCookie's value and redirects to the dashboard", async () => {
    const ctx = {} as unknown as ActionCtx;

    const res = await finishLoginPg(ctx, {
      sessionToken: 'tok-1',
      frontendOrigin: 'https://app.example.com',
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://app.example.com/dashboard',
    );
    expect(res.headers.get('set-cookie')).toBe(
      await buildSessionCookie('tok-1', 'https://app.example.com', SECRET),
    );
  });

  it('refuses to mint a cookie without BETTER_AUTH_SECRET', async () => {
    delete process.env.BETTER_AUTH_SECRET;
    const ctx = {} as unknown as ActionCtx;

    await expect(
      finishLoginPg(ctx, {
        sessionToken: 'tok-1',
        frontendOrigin: 'http://localhost:3000',
      }),
    ).rejects.toThrow(/BETTER_AUTH_SECRET/);
  });
});
