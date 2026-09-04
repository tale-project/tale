import { describe, expect, it } from 'vitest';

import {
  assertProviderCredentialNameFree,
  CredentialAdminError,
} from './service.ts';

/**
 * A second credential with a name the provider already carries is a
 * friendly 409, the twin of the connector-credential rule. Regression: the
 * only guard was the 0015 UNIQUE constraint, whose violation escaped the
 * route as an unexplained 500.
 */
describe('assertProviderCredentialNameFree', () => {
  const rows = [
    { id: 'cred-1', name: 'Production' },
    { id: 'cred-2', name: 'Staging' },
  ];

  it('lets a fresh name through', () => {
    expect(() =>
      assertProviderCredentialNameFree(rows, 'Sandbox'),
    ).not.toThrow();
  });

  it('refuses a name another credential carries, as a coded 409', () => {
    let caught: unknown;
    try {
      assertProviderCredentialNameFree(rows, 'Production');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CredentialAdminError);
    if (caught instanceof CredentialAdminError) {
      expect(caught.code).toBe('CREDENTIAL_NAME_TAKEN');
      expect(caught.status).toBe(409);
      expect(caught.message).toContain('"Production"');
    }
  });

  it('matches exactly, as the constraint does — case is a different name', () => {
    expect(() =>
      assertProviderCredentialNameFree(rows, 'production'),
    ).not.toThrow();
  });

  it('lets a rename keep its own name (the row itself is not a clash)', () => {
    expect(() =>
      assertProviderCredentialNameFree(rows, 'Production', 'cred-1'),
    ).not.toThrow();
  });

  it('refuses a rename onto a sibling name', () => {
    expect(() =>
      assertProviderCredentialNameFree(rows, 'Staging', 'cred-1'),
    ).toThrow(CredentialAdminError);
  });
});
