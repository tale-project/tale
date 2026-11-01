import { describe, expect, it } from 'vitest';

import { isProxiedSession } from './proxied-session';

/** Which sessions the app leaves to a proxy to sign out of. The rows the
 * doors write are read back in `backend:integration`
 * (`session-authority.integration.ts`, `checkTrustedHeaders`). */
describe('isProxiedSession', () => {
  it("reads a session as a proxy's only by the mark the proxy's door writes", () => {
    expect(
      isProxiedSession({
        trustedOrganizationId: 'org-1',
        trustedRole: 'editor',
        signedInByProxy: true,
      }),
    ).toBe(true);
  });

  it('leaves a single sign-on session, bound but with no role, to its person [SSO-R21]', () => {
    expect(
      isProxiedSession({
        trustedOrganizationId: 'org-1',
        trustedRole: null,
        signedInByProxy: false,
      }),
    ).toBe(false);
    expect(isProxiedSession({ trustedOrganizationId: 'org-1' })).toBe(false);
  });

  it('leaves a passkey sign-in that keeps the role ceiling of its proxy to its person', () => {
    expect(
      isProxiedSession({
        trustedOrganizationId: 'org-1',
        trustedRole: 'member',
        signedInByProxy: false,
      }),
    ).toBe(false);
    expect(
      isProxiedSession({
        trustedOrganizationId: 'org-1',
        trustedRole: 'member',
      }),
    ).toBe(false);
  });

  it("reads an unbound session, and no session at all, as nobody else's", () => {
    expect(
      isProxiedSession({ trustedOrganizationId: null, trustedRole: null }),
    ).toBe(false);
    expect(isProxiedSession({ signedInByProxy: 'true' })).toBe(false);
    expect(isProxiedSession(undefined)).toBe(false);
    expect(isProxiedSession(null)).toBe(false);
  });
});
