// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { createAuth } from './auth.ts';

/**
 * Tale sends no mail and creates no account on its own: the first owner
 * comes from the setup wizard, everyone else from Settings > Members, and
 * the operator's account from the deploy. Each of those is someone with the
 * authority to name the address, so the account arrives verified — otherwise
 * nothing that needs a vouched-for address (an OIDC `email_verified` claim,
 * conversation synchronization, the notification mirror) would ever work for
 * a colleague an admin added, and no one could fix it: there is no
 * verification mail to send.
 *
 * `createAuth` only constructs a lazy `pg.Pool`, so no database is touched.
 */

const BASE = {
  databaseUrl: 'postgresql://tale:pw@localhost:5432/tale_app',
  secret: 'test-secret-at-least-16-chars',
  baseUrl: 'https://tale.example.com',
  // The auth config never queries through this in construction.
  sql: null as unknown as Sql,
};

describe('createAuth — a provisioned account is a verified account', () => {
  it('verifies the account it is asked to create', async () => {
    const before = createAuth(BASE).options.databaseHooks?.user?.create?.before;
    if (typeof before !== 'function') throw new Error('no user-create hook');
    const colleague = {
      id: 'user-1',
      name: 'Colleague',
      email: 'colleague@example.com',
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await before(colleague);

    expect(result).toEqual({ data: { ...colleague, emailVerified: true } });
  });

  it('leaves email verification switched off for sign-in', () => {
    // Nothing may start demanding a verification mail this deployment
    // cannot send — the flag says who vouched for the address, never
    // whether a mailbox answered.
    expect(
      createAuth(BASE).options.emailAndPassword?.requireEmailVerification,
    ).toBe(false);
  });
});
