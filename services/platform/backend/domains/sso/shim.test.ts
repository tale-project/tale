// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { ssoShimHandlers } from './shim.ts';

/** A Sql double that refuses every query — the boundary must refuse before
 * provisioning touches the database. */
function refusingSql(): Sql {
  const tag = () => {
    throw new Error('the database must not be reached');
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(tag, { begin: tag }) as unknown as Sql;
}

const HANDLE_SSO_LOGIN = 'enterprise_sso/internal_actions:handleSsoLogin';

const validArgs = {
  email: 'user@example.test',
  name: '',
  externalId: 'idp-1',
  providerId: 'saml',
  accessToken: '',
  organizationId: 'org-1',
};

/**
 * The protocol handlers hand `handleSsoLogin` whatever the IdP produced;
 * 0.4's Convex validator rejected a bad shape at this boundary, and the 0.5
 * shim must too — an undefined email used to reach `.toLowerCase()` and the
 * raw TypeError landed on the login page and in the audit row.
 */
describe('ssoShimHandlers — handleSsoLogin validates its payload', () => {
  const handler = ssoShimHandlers(refusingSql())[HANDLE_SSO_LOGIN];
  if (handler === undefined) throw new Error('handleSsoLogin shim missing');

  it('refuses a payload without an email before touching the database', async () => {
    const { email: _email, ...withoutEmail } = validArgs;
    void _email;

    await expect(handler(withoutEmail)).rejects.toThrow(
      /SSO identity payload rejected: .*email/s,
    );
  });

  it('refuses an empty externalId the same way', async () => {
    await expect(handler({ ...validArgs, externalId: '' })).rejects.toThrow(
      /SSO identity payload rejected: .*externalId/s,
    );
  });

  it('lets a well-formed payload through to provisioning', async () => {
    // Provisioning is the first database read — the refusing double is the
    // proof the boundary accepted the payload.
    await expect(handler(validArgs)).resolves.toMatchObject({
      success: false,
      error: 'the database must not be reached',
    });
  });
});
