// @vitest-environment node

/**
 * The member-facing password forms read the rules the password write holds
 * the caller to. The per-org policy read is admin-only, so a member used to
 * see the built-in default instead: looser than a stricter organization's
 * rules, which the write then refused. `GET /me/password-policy` and
 * `POST /update-password` resolve ONE policy — the strictest across every
 * organization the caller belongs to — so the two cannot disagree.
 */

import {
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicyConfig,
} from '@tale/shared/schemas/governance';
import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isPasswordValid } from '../../../lib/shared/schemas/password.ts';
import type { AuthEnv } from '../../auth/session.ts';

const { getUserOrganizations, readGovernancePolicyForOrg } = vi.hoisted(() => ({
  getUserOrganizations: vi.fn(),
  readGovernancePolicyForOrg: vi.fn(),
}));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<AuthEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'member-1', email: 'member@example.test' },
      } as never);
      await next();
    },
}));
vi.mock('../../auth/membership.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/membership.ts')>()),
  getUserOrganizations,
}));
vi.mock('../../lib/org-config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/org-config.ts')>()),
  readGovernancePolicyForOrg,
  // No slug, so no policy-file mtime: the rotation anchor is not what these
  // cases are about.
  resolveOrgSlug: vi.fn().mockResolvedValue(null),
}));

import { createUserRoutes } from './routes.ts';

/** Longer than the default, but without the special-character rule. */
const STRICT_ORG_POLICY: PasswordPolicyConfig = {
  ...DEFAULT_PASSWORD_POLICY,
  minLength: 20,
  requireSpecial: false,
};

/** Fifteen characters and every character class: the default accepts it. */
const DEFAULT_GRADE_PASSWORD = 'Tale-Passw0rd!2';

function routes() {
  return createUserRoutes({ sql: {} as never, auth: {} as never });
}

function policyOf(
  organizationId: string,
): Promise<PasswordPolicyConfig | null> {
  return Promise.resolve(
    organizationId === 'org-strict' ? STRICT_ORG_POLICY : null,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /me/password-policy', () => {
  it('answers the strictest policy across every organization the caller belongs to', async () => {
    getUserOrganizations.mockResolvedValue([
      { organizationId: 'org-strict', role: 'member' },
      { organizationId: 'org-default', role: 'member' },
    ]);
    readGovernancePolicyForOrg.mockImplementation(
      (_sql: unknown, organizationId: string) => policyOf(organizationId),
    );

    const response = await routes().request('/me/password-policy');

    expect(response.status).toBe(200);
    // The length comes from the strict organization and the special-character
    // rule from the one without a policy file: neither organization alone.
    expect(await response.json()).toEqual({
      policy: { ...DEFAULT_PASSWORD_POLICY, minLength: 20 },
    });
    expect(getUserOrganizations).toHaveBeenCalledWith(
      expect.anything(),
      'member-1',
    );
  });

  it('answers the built-in default for a user in no organization', async () => {
    getUserOrganizations.mockResolvedValue([]);

    const response = await routes().request('/me/password-policy');

    expect(await response.json()).toEqual({ policy: DEFAULT_PASSWORD_POLICY });
    expect(readGovernancePolicyForOrg).not.toHaveBeenCalled();
  });
});

describe('POST /update-password', () => {
  it('refuses a password the read rules refuse, though the default accepts it', async () => {
    getUserOrganizations.mockResolvedValue([
      { organizationId: 'org-strict', role: 'member' },
    ]);
    readGovernancePolicyForOrg.mockImplementation(
      (_sql: unknown, organizationId: string) => policyOf(organizationId),
    );
    const app = routes();
    const read = (await (await app.request('/me/password-policy')).json()) as {
      policy: PasswordPolicyConfig;
    };
    expect(
      isPasswordValid(DEFAULT_GRADE_PASSWORD, DEFAULT_PASSWORD_POLICY),
    ).toBe(true);
    expect(isPasswordValid(DEFAULT_GRADE_PASSWORD, read.policy)).toBe(false);

    const response = await app.request('/update-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'current-password',
        newPassword: DEFAULT_GRADE_PASSWORD,
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'password_policy_violation',
    });
  });
});
