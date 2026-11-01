import { describe, expect, it } from 'vitest';

import { isProxiedSession } from './proxied-session';

/** Which sessions the app leaves to a proxy to sign out of. The rows the
 * two doors write are read back in `backend:integration`
 * (`session-authority.integration.ts`, `checkTrustedHeaders`). */
describe('isProxiedSession', () => {
  it("reads a session as a proxy's only by the role the proxy asserted", () => {
    expect(
      isProxiedSession({
        trustedOrganizationId: 'org-1',
        trustedRole: 'editor',
      }),
    ).toBe(true);
  });

  it('leaves a single sign-on session, bound but with no role, to its person [SSO-R21]', () => {
    expect(
      isProxiedSession({ trustedOrganizationId: 'org-1', trustedRole: null }),
    ).toBe(false);
    expect(isProxiedSession({ trustedOrganizationId: 'org-1' })).toBe(false);
  });

  it("reads an unbound session, and no session at all, as nobody else's", () => {
    expect(
      isProxiedSession({ trustedOrganizationId: null, trustedRole: null }),
    ).toBe(false);
    expect(isProxiedSession(undefined)).toBe(false);
    expect(isProxiedSession(null)).toBe(false);
  });
});
