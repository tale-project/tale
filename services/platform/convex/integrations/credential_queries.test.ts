import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
//
// `verifyCredentialAccess` backs the destructive `'use node'` credential actions
// (saveCredentials, testConnection, generateOAuth2Url,
// saveOAuth2ClientCredentials). It must return the credential ONLY for callers
// holding the `developerSettings` capability and `null` otherwise. These tests
// run the REAL `defineAbilityFor` check against member rows returned from a
// mocked Better Auth adapter query.
// ---------------------------------------------------------------------------

vi.mock('../_generated/server', () => ({
  query: vi.fn((config) => config),
  internalQuery: vi.fn((config) => config),
}));

vi.mock('../_generated/api', () => ({
  components: {
    betterAuth: { adapter: { findMany: 'findMany' } },
  },
}));

vi.mock('../lib/rls', () => ({
  getAuthUserIdentity: vi.fn(),
  getOrganizationMember: vi.fn(),
}));

vi.mock('../lib/rls/errors', () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

const { verifyCredentialAccess } = await import('./credential_queries');

type QueryConfig = {
  handler: (ctx: never, args: never) => Promise<unknown>;
};

const verifyHandler = (verifyCredentialAccess as unknown as QueryConfig)
  .handler;

const cred = { _id: 'cred-1', organizationId: 'org-123', slug: 'slack' };

function ctxForRole(role: string | undefined) {
  return {
    db: { get: vi.fn().mockResolvedValue(cred) },
    runQuery: vi
      .fn()
      .mockResolvedValue({ page: role === undefined ? [] : [{ role }] }),
  };
}

describe('verifyCredentialAccess capability gate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null for a plain member (lacks developerSettings)', async () => {
    const ctx = ctxForRole('member');
    const result = await verifyHandler(
      ctx as never,
      {
        credentialId: 'cred-1',
        userId: 'user-1',
      } as never,
    );
    expect(result).toBeNull();
  });

  it('returns null for a disabled member', async () => {
    const ctx = ctxForRole('disabled');
    const result = await verifyHandler(
      ctx as never,
      {
        credentialId: 'cred-1',
        userId: 'user-1',
      } as never,
    );
    expect(result).toBeNull();
  });

  it('returns null when there is no member row', async () => {
    const ctx = ctxForRole(undefined);
    const result = await verifyHandler(
      ctx as never,
      {
        credentialId: 'cred-1',
        userId: 'user-1',
      } as never,
    );
    expect(result).toBeNull();
  });

  it('returns the credential for a developer', async () => {
    const ctx = ctxForRole('developer');
    const result = await verifyHandler(
      ctx as never,
      {
        credentialId: 'cred-1',
        userId: 'user-1',
      } as never,
    );
    expect(result).toEqual(cred);
  });

  it('returns the credential for an admin', async () => {
    const ctx = ctxForRole('admin');
    const result = await verifyHandler(
      ctx as never,
      {
        credentialId: 'cred-1',
        userId: 'user-1',
      } as never,
    );
    expect(result).toEqual(cred);
  });
});
