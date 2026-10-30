// @vitest-environment node

/**
 * Whether a person must have a second factor is decided at sign-in from the
 * policies of their organizations and from what their account holds: an
 * authenticator, a passkey, a password of its own. The decision is one pure
 * read of that state; the grace anchor it asks to be stored is written by
 * the sign-in door.
 */

import type { TwoFactorPolicyConfig } from '@tale/shared/schemas/governance';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  userOrgIds: vi.fn(),
  readGovernancePolicyForOrg: vi.fn(),
}));

vi.mock('../audit_logs/user-scoped.ts', () => ({
  userOrgIds: h.userOrgIds,
  recordUserScopedSecurityEvent: vi.fn(),
}));
vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: h.readGovernancePolicyForOrg,
}));

import { evaluateTwoFactorEnforcement } from './service.ts';

const NOW = Date.UTC(2026, 0, 15, 12);
const DAY_MS = 24 * 60 * 60 * 1000;

interface Account {
  /** An authenticator app is set up. */
  authenticator?: boolean;
  passkey?: boolean;
  passkeyRealm?: string;
  pendingPasskey?: boolean;
  /** How the account signs in: `credential` is a password of its own. */
  signIns?: string[];
  /** The stored end of a grace period that already started. */
  graceUntil?: number;
  firstRequiredSignInAt?: number | null;
}

/** A `db` that answers the four reads of the decision from one account. */
function accountDb(account: Account): Sql {
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?');
    if (text.includes('FROM "user"')) {
      return Promise.resolve([
        { twoFactorEnabled: account.authenticator ?? false },
      ]);
    }
    if (text.includes('FROM "passkey"')) {
      return Promise.resolve(
        account.passkey === true && values[1] === ''
          ? [{ id: 'pk-1', userId: 'user-1', credentialID: 'public-handle-1' }]
          : [],
      );
    }
    if (text.includes('FROM app.auth_factor_authorities')) {
      return Promise.resolve(
        account.passkeyRealm === undefined && !account.pendingPasskey
          ? []
          : [
              {
                fingerprint:
                  'f40338c65ef90be2d23133f9e23231335d2a627194115e2d52e820dd8e910a3a',
                credentialId: account.pendingPasskey ? null : 'pk-1',
                userId: 'user-1',
                organizationId: account.passkeyRealm ?? null,
                authority:
                  account.passkeyRealm === undefined
                    ? 'global'
                    : 'organization',
                state: account.pendingPasskey ? 'pending' : 'bound',
              },
            ],
      );
    }
    if (text.includes('FROM "account"')) {
      return Promise.resolve(
        (account.signIns ?? ['credential']).map((providerId) => ({
          providerId,
        })),
      );
    }
    if (text.includes('FROM app.two_factor_grace')) {
      return Promise.resolve(
        account.graceUntil === undefined &&
          account.firstRequiredSignInAt === undefined
          ? []
          : [
              {
                graceUntil: account.graceUntil,
                firstRequiredSignInAt: account.firstRequiredSignInAt ?? null,
              },
            ],
      );
    }
    return Promise.reject(new Error(`unexpected SQL: ${text}`));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return tag as unknown as Sql;
}

/** One organization per policy, in order. */
function organizations(...policies: Partial<TwoFactorPolicyConfig>[]): void {
  h.userOrgIds.mockResolvedValue(policies.map((_, index) => `org-${index}`));
  h.readGovernancePolicyForOrg.mockImplementation(
    (_db: unknown, organizationId: string) =>
      Promise.resolve({
        enforced: false,
        gracePeriodDays: 7,
        exemptSsoUsers: true,
        ...policies[Number(organizationId.slice('org-'.length))],
      }),
  );
}

const decide = (account: Account) =>
  evaluateTwoFactorEnforcement(accountDb(account), 'user-1');

describe('evaluateTwoFactorEnforcement', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('asks nothing while no organization of the person requires a second factor [TFA-R1]', async () => {
    organizations({ enforced: false });
    expect(await decide({})).toMatchObject({ decision: 'ok' });
  });

  const REQUIRED_AT_ONCE = {
    enforced: true,
    gracePeriodDays: 0,
    exemptSsoUsers: false,
  };

  it.each([
    ['first', [REQUIRED_AT_ONCE, { enforced: false }]],
    ['last', [{ enforced: false }, REQUIRED_AT_ONCE]],
  ])(
    'holds the person to the strictest policy among their organizations, listed %s [TFA-R1]',
    async (_listed, policies) => {
      organizations(...policies);
      expect(await decide({})).toMatchObject({
        decision: 'blocked',
        policy: { enforced: true, exemptSsoUsers: false },
      });
    },
  );

  // Both organizations require a second factor; only one exempts SSO
  // accounts, so the stricter one holds an account without a password.
  it.each([
    [
      'first',
      [REQUIRED_AT_ONCE, { ...REQUIRED_AT_ONCE, exemptSsoUsers: true }],
    ],
    ['last', [{ ...REQUIRED_AT_ONCE, exemptSsoUsers: true }, REQUIRED_AT_ONCE]],
  ])(
    'holds an SSO account when one organization does not exempt it, listed %s [TFA-R1]',
    async (_listed, policies) => {
      organizations(...policies);
      expect(await decide({ signIns: ['saml'] })).toMatchObject({
        decision: 'blocked',
        policy: { enforced: true, exemptSsoUsers: false },
      });
    },
  );

  it.each([
    ['an authenticator app', { authenticator: true }],
    ['a passkey alone', { passkey: true }],
  ])('is met by %s [TFA-R2]', async (_what, account) => {
    organizations({ enforced: true, gracePeriodDays: 0 });
    expect(await decide(account)).toMatchObject({ decision: 'ok' });
  });

  it('does not count a realm passkey for the global or another realm policy', async () => {
    organizations(
      { enforced: true, gracePeriodDays: 0, exemptSsoUsers: false },
      { enforced: true, gracePeriodDays: 0, exemptSsoUsers: false },
    );
    const db = accountDb({ passkey: true, passkeyRealm: 'org-0' });
    expect(
      await evaluateTwoFactorEnforcement(db, 'user-1', {
        organizationIds: ['org-0'],
        organizationId: 'org-0',
      }),
    ).toMatchObject({ decision: 'ok' });
    expect(
      await evaluateTwoFactorEnforcement(db, 'user-1', {
        organizationIds: ['org-1'],
        organizationId: 'org-1',
      }),
    ).toMatchObject({ decision: 'blocked' });
    expect(await evaluateTwoFactorEnforcement(db, 'user-1')).toMatchObject({
      decision: 'blocked',
    });
  });

  it('does not count an unfinished new credential as a historical factor', async () => {
    organizations({
      enforced: true,
      gracePeriodDays: 0,
      exemptSsoUsers: false,
    });
    expect(await decide({ passkey: true, pendingPasskey: true })).toMatchObject(
      { decision: 'blocked' },
    );
  });

  it('takes the authenticator flag the caller already holds instead of reading the user [TFA-R2]', async () => {
    organizations({
      enforced: true,
      gracePeriodDays: 0,
      exemptSsoUsers: false,
    });
    const reads: string[] = [];
    const db = accountDb({ authenticator: false });
    const spy = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      reads.push(strings.join('?'));
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- forwards the template call to the stand-in
      return (
        db as unknown as (s: TemplateStringsArray, ...v: unknown[]) => unknown
      )(strings, ...values);
    }) as unknown as Sql;
    expect(
      await evaluateTwoFactorEnforcement(spy, 'user-1', {
        organizationIds: ['org-0'],
        twoFactorEnabled: true,
      }),
    ).toMatchObject({ decision: 'ok' });
    expect(reads.some((text) => text.includes('FROM "user"'))).toBe(false);
    // Off in the caller's row: the other factors are still looked for.
    expect(
      await evaluateTwoFactorEnforcement(spy, 'user-1', {
        organizationIds: ['org-0'],
        twoFactorEnabled: false,
      }),
    ).toMatchObject({ decision: 'blocked' });
    expect(reads.some((text) => text.includes('FROM "user"'))).toBe(false);
    expect(reads.some((text) => text.includes('FROM "passkey"'))).toBe(true);
  });

  it('exempts an account that signs in only through SSO when the policy says so [TFA-R3]', async () => {
    organizations({ enforced: true, gracePeriodDays: 0, exemptSsoUsers: true });
    expect(await decide({ signIns: ['saml'] })).toMatchObject({
      decision: 'ok',
    });
    // A password of its own ends the exemption.
    expect(await decide({ signIns: ['saml', 'credential'] })).toMatchObject({
      decision: 'blocked',
    });
  });

  it('exempts nobody when the policy does not say so [TFA-R3]', async () => {
    organizations({
      enforced: true,
      gracePeriodDays: 0,
      exemptSsoUsers: false,
    });
    expect(await decide({ signIns: ['saml'] })).toMatchObject({
      decision: 'blocked',
    });
  });

  it('starts the grace period at the first sign-in [TFA-R4]', async () => {
    organizations({ enforced: true, gracePeriodDays: 7 });
    expect(await decide({})).toMatchObject({
      decision: 'grace',
      graceUntilToSet: NOW + 7 * DAY_MS,
      graceDeadline: NOW + 7 * DAY_MS,
    });
  });

  it('recomputes from the persisted anchor when policy lengthens or shortens [TFA-R4]', async () => {
    organizations({ enforced: true, gracePeriodDays: 2 });
    expect(await decide({ firstRequiredSignInAt: NOW - DAY_MS })).toMatchObject(
      {
        decision: 'grace',
        graceDeadline: NOW + DAY_MS,
      },
    );
    organizations({ enforced: true, gracePeriodDays: 7 });
    expect(await decide({ firstRequiredSignInAt: NOW - DAY_MS })).toMatchObject(
      {
        decision: 'grace',
        graceDeadline: NOW + 6 * DAY_MS,
      },
    );
  });

  it('never restarts grace at later sign-ins and blocks after the anchored deadline [TFA-R4]', async () => {
    organizations({ enforced: true, gracePeriodDays: 2 });
    expect(
      await decide({ firstRequiredSignInAt: NOW - 3 * DAY_MS }),
    ).toMatchObject({
      decision: 'blocked',
      graceUntilToSet: null,
      graceDeadline: NOW - DAY_MS,
    });
  });

  it('keeps a legacy row deadline unchanged [TFA-R4]', async () => {
    organizations({ enforced: true, gracePeriodDays: 2 });
    expect(await decide({ graceUntil: NOW + 5 * DAY_MS })).toMatchObject({
      decision: 'grace',
      graceDeadline: NOW + 5 * DAY_MS,
    });
  });

  it('blocks once the grace period is over, and at once with a period of zero days [TFA-R5]', async () => {
    organizations({ enforced: true, gracePeriodDays: 7 });
    expect(await decide({ graceUntil: NOW - 1 })).toMatchObject({
      decision: 'blocked',
    });
    organizations({ enforced: true, gracePeriodDays: 0 });
    expect(await decide({})).toMatchObject({
      decision: 'blocked',
      graceUntilToSet: null,
    });
  });
});
