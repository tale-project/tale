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
  /** How the account signs in: `credential` is a password of its own. */
  signIns?: string[];
  /** The stored end of a grace period that already started. */
  graceUntil?: number;
  firstRequiredSignInAt?: number | null;
}

/** A `db` that answers the four reads of the decision from one account. */
function accountDb(account: Account): Sql {
  const tag = (strings: TemplateStringsArray): Promise<unknown[]> => {
    const text = strings.join('?');
    if (text.includes('FROM "user"')) {
      return Promise.resolve([
        { twoFactorEnabled: account.authenticator ?? false },
      ]);
    }
    if (text.includes('FROM "passkey"')) {
      return Promise.resolve(account.passkey === true ? [{ id: 'pk-1' }] : []);
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

  it('holds the person to the strictest policy among their organizations [TFA-R1]', async () => {
    organizations(
      { enforced: false },
      { enforced: true, gracePeriodDays: 0, exemptSsoUsers: false },
    );
    expect(await decide({})).toMatchObject({ decision: 'blocked' });
  });

  it.each([
    ['an authenticator app', { authenticator: true }],
    ['a passkey alone', { passkey: true }],
  ])('is met by %s [TFA-R2]', async (_what, account) => {
    organizations({ enforced: true, gracePeriodDays: 0 });
    expect(await decide(account)).toMatchObject({ decision: 'ok' });
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
