// @vitest-environment node

import { DEFAULT_PASSWORD_POLICY } from '@tale/shared/schemas/governance';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import { updateUserPassword } from './service.ts';

/**
 * A password the person replaces at the forced rotation — the temporary one
 * an admin set, or one that expired — [AGCONN-R17]. That rotation writes the
 * credential itself instead of asking Better Auth to change it, so the hook
 * that ends the person's coding agents after Better Auth's own change never
 * sees it: the service ends them, in the same transaction as the credential.
 */

const USER_ID = 'user-ada';
const NEW_PASSWORD = 'Correct-Horse-Battery-9!';

const { events, endAgentsOf } = vi.hoisted(() => {
  const log: string[] = [];
  return {
    events: log,
    endAgentsOf: vi.fn((_tx: unknown, userId: string) => {
      log.push(`agents of ${userId} ended`);
      return Promise.resolve();
    }),
  };
});

vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: async (
    sql: unknown,
    run: (tx: unknown) => Promise<unknown>,
  ) => {
    events.push('transaction opened');
    const result = await run(sql);
    events.push('transaction committed');
    return result;
  },
}));
vi.mock('../../auth/account-security.ts', () => ({
  CHANGE_PASSWORD_PATH: '/change-password',
  endAgentsOf,
  endAllAccessOf: vi.fn(),
}));
vi.mock('../../auth/membership.ts', () => ({
  evaluateCredentialResetAuthority: vi.fn(),
  findOrganizationMember: vi.fn(),
  getUserOrganizations: vi.fn(() =>
    Promise.resolve([{ organizationId: 'org-acme' }]),
  ),
  isAdminRole: vi.fn(),
}));
vi.mock('../../lib/governance-policies.ts', () => ({
  getStrictestPasswordPolicyForUser: vi.fn(() =>
    Promise.resolve({ policy: DEFAULT_PASSWORD_POLICY, effectiveAt: null }),
  ),
}));
vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(() => Promise.resolve()),
}));
vi.mock('../members/service.ts', () => ({ addMember: vi.fn() }));
vi.mock('better-auth/crypto', () => ({
  hashPassword: vi.fn((password: string) =>
    Promise.resolve(`hashed:${password}`),
  ),
  verifyPassword: vi.fn(
    ({ hash, password }: { hash: string; password: string }) =>
      Promise.resolve(hash === `hashed:${password}`),
  ),
}));

interface Scenario {
  /** The person has a password at all. */
  credential: boolean;
  /** The password they have now, as stored. */
  stored?: string;
}

function fakeSql(scenario: Scenario): Sql {
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.raw.join('?').replaceAll(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT "id" FROM "account"')) {
      return Promise.resolve(scenario.credential ? [{ id: 'account-1' }] : []);
    }
    if (text.includes('FROM app.user_password_metadata')) {
      return Promise.resolve([
        { passwordChangedAt: 0, forceChangeOnNextLogin: true },
      ]);
    }
    if (text.startsWith('SELECT "password" FROM "account"')) {
      return Promise.resolve([{ password: scenario.stored ?? 'hashed:old' }]);
    }
    if (text.startsWith('UPDATE "account" SET "password"')) {
      events.push('credential written');
      return Promise.resolve([]);
    }
    if (text.startsWith('INSERT INTO app.user_password_metadata')) {
      return Promise.resolve([]);
    }
    throw new Error(`unexpected SQL: ${text}`);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SQL tag test double
  return tag as unknown as Sql;
}

function fakeAuth() {
  const revokeOtherSessions = vi.fn(() => {
    events.push('other sessions revoked');
    return Promise.resolve();
  });
  const setPassword = vi.fn(() => Promise.resolve());
  const auth = { api: { revokeOtherSessions, setPassword } };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the two endpoints the service calls
  return { auth: auth as unknown as Auth, revokeOtherSessions, setPassword };
}

beforeEach(() => {
  events.length = 0;
  endAgentsOf.mockClear();
});

describe('replacing a password at the forced rotation [AGCONN-R17]', () => {
  it('ends the person’s coding agents in the transaction that writes the new credential, then signs out their other sessions', async () => {
    const { auth, revokeOtherSessions } = fakeAuth();
    await updateUserPassword(
      { sql: fakeSql({ credential: true }), auth },
      { userId: USER_ID },
      new Headers(),
      { newPassword: NEW_PASSWORD },
    );
    expect(events).toEqual([
      'transaction opened',
      'credential written',
      `agents of ${USER_ID} ended`,
      'transaction committed',
      'other sessions revoked',
      // The rotation anchor and the audit rows, in a transaction of their own.
      'transaction opened',
      'transaction committed',
    ]);
    expect(revokeOtherSessions).toHaveBeenCalledTimes(1);
  });

  it('ends nothing when the new password is the one they have: the rotation is refused', async () => {
    const { auth, revokeOtherSessions } = fakeAuth();
    await expect(
      updateUserPassword(
        {
          sql: fakeSql({ credential: true, stored: `hashed:${NEW_PASSWORD}` }),
          auth,
        },
        { userId: USER_ID },
        new Headers(),
        { newPassword: NEW_PASSWORD },
      ),
    ).rejects.toMatchObject({ code: 'password_reused', status: 400 });
    expect(endAgentsOf).not.toHaveBeenCalled();
    expect(revokeOtherSessions).not.toHaveBeenCalled();
    expect(events).not.toContain('credential written');
  });

  it('ends nothing when the person had no password: a first one takes nothing away', async () => {
    const { auth, setPassword } = fakeAuth();
    await updateUserPassword(
      { sql: fakeSql({ credential: false }), auth },
      { userId: USER_ID },
      new Headers(),
      { newPassword: NEW_PASSWORD },
    );
    expect(setPassword).toHaveBeenCalledTimes(1);
    expect(endAgentsOf).not.toHaveBeenCalled();
  });
});
