import { hashPassword } from 'better-auth/crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockChangePassword = vi.fn();
const mockSetPassword = vi.fn();
const mockGetAuth = vi.fn();
const mockGetAuthUser = vi.fn();

vi.mock('../auth', () => ({
  authComponent: {
    getAuth: (...args: unknown[]) => mockGetAuth(...args),
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
  createAuth: 'createAuth',
}));

const mockHasCredentialAccount = vi.fn();
vi.mock('../accounts/helpers', () => ({
  hasCredentialAccount: (...args: unknown[]) =>
    mockHasCredentialAccount(...args),
}));

const mockGetUserOrganizations = vi.fn();
vi.mock('../lib/rls/organization/get_user_organizations', () => ({
  getUserOrganizations: (...args: unknown[]) =>
    mockGetUserOrganizations(...args),
}));

const mockGetStrictestPasswordPolicyForUser = vi.fn();
vi.mock('../governance/helpers', () => ({
  getStrictestPasswordPolicyForUser: (...args: unknown[]) =>
    mockGetStrictestPasswordPolicyForUser(...args),
}));

vi.mock('./password_metadata', () => ({
  recordPasswordChange: vi.fn(),
}));

vi.mock('../audit_logs/helpers', () => ({
  createAuditLog: vi.fn(),
}));

vi.mock('convex/values', () => {
  const stub = () => 'validator';
  class ConvexError extends Error {
    data: unknown;
    constructor(data: unknown) {
      super(typeof data === 'string' ? data : JSON.stringify(data));
      this.name = 'ConvexError';
      this.data = data;
    }
  }
  return {
    ConvexError,
    v: {
      string: stub,
      number: stub,
      boolean: stub,
      optional: stub,
      union: stub,
      object: stub,
      literal: stub,
      array: stub,
      null: stub,
      id: stub,
    },
  };
});

vi.mock('../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth:adapter:findMany',
      },
    },
  },
}));

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutation: (config: Record<string, unknown>) => config,
  };
});

function createMockCtx() {
  return {
    runQuery: vi.fn(),
    runMutation: vi.fn(),
    db: {},
    auth: {
      getUserIdentity: vi.fn(async () => {
        const u = await mockGetAuthUser();
        return u ? { subject: u._id, email: u.email, name: u.name } : null;
      }),
    },
  };
}

const VALID_PASSWORD = 'StrongP@ss1';
const MOCK_HEADERS = new Headers({ authorization: 'Bearer token' });

describe('updateUserPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuth.mockResolvedValue({
      auth: {
        api: {
          changePassword: mockChangePassword,
          setPassword: mockSetPassword,
        },
      },
      headers: MOCK_HEADERS,
    });
    mockGetAuthUser.mockResolvedValue({
      _id: 'user_1',
      email: 'user@example.com',
      name: 'User',
    });
    mockGetUserOrganizations.mockResolvedValue([]);
    mockGetStrictestPasswordPolicyForUser.mockResolvedValue({
      policy: {
        minLength: 8,
        requireLower: true,
        requireUpper: true,
        requireDigit: true,
        requireSpecial: true,
        rotationDays: 0,
      },
      effectiveAt: null,
    });
  });

  async function getHandler() {
    const mod = await import('./update_user_password');
    return mod.updateUserPassword;
  }

  it('throws when password is invalid', async () => {
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(
      handler(ctx as never, { newPassword: 'weak' }),
    ).rejects.toMatchObject({ data: { code: 'password_policy_violation' } });
  });

  it('calls changePassword with revokeOtherSessions for credential users', async () => {
    mockHasCredentialAccount.mockResolvedValue(true);
    mockChangePassword.mockResolvedValue(undefined);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await handler(ctx as never, {
      currentPassword: 'OldP@ss1',
      newPassword: VALID_PASSWORD,
    });

    expect(mockChangePassword).toHaveBeenCalledWith({
      body: {
        currentPassword: 'OldP@ss1',
        newPassword: VALID_PASSWORD,
        revokeOtherSessions: true,
      },
      headers: MOCK_HEADERS,
    });
  });

  it('throws when currentPassword missing for credential users', async () => {
    mockHasCredentialAccount.mockResolvedValue(true);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(
      handler(ctx as never, { newPassword: VALID_PASSWORD }),
    ).rejects.toMatchObject({ data: { code: 'current_password_required' } });
  });

  it('calls setPassword without session revocation for OAuth-only users', async () => {
    mockHasCredentialAccount.mockResolvedValue(false);
    mockSetPassword.mockResolvedValue(undefined);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await handler(ctx as never, { newPassword: VALID_PASSWORD });

    expect(mockSetPassword).toHaveBeenCalledWith({
      body: {
        newPassword: VALID_PASSWORD,
      },
      headers: MOCK_HEADERS,
    });
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it('rejects a forced change that re-uses the current password (#2038)', async () => {
    mockHasCredentialAccount.mockResolvedValue(true);
    const currentHash = await hashPassword(VALID_PASSWORD);
    const ctx = createMockCtx();
    // forcedResetCredentialPassword's findMany returns the credential account
    // carrying the current password hash.
    ctx.runQuery.mockResolvedValue({
      page: [{ _id: 'acct_1', password: currentHash }],
    });
    const handler = await getHandler();

    await expect(
      handler(ctx as never, {
        newPassword: VALID_PASSWORD,
        trigger: 'forced',
      }),
    ).rejects.toMatchObject({ data: { code: 'password_reused' } });
    // The credential is never updated when reuse is detected.
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('allows a forced change to a new password and revokes other sessions', async () => {
    mockHasCredentialAccount.mockResolvedValue(true);
    const revokeOtherSessions = vi.fn().mockResolvedValue(undefined);
    mockGetAuth.mockResolvedValue({
      auth: {
        api: {
          changePassword: mockChangePassword,
          setPassword: mockSetPassword,
          revokeOtherSessions,
        },
      },
      headers: MOCK_HEADERS,
    });
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue({
      page: [{ _id: 'acct_1', password: await hashPassword('PreviousP@ss1') }],
    });
    ctx.runMutation.mockResolvedValue(undefined);
    const handler = await getHandler();

    await handler(ctx as never, {
      newPassword: VALID_PASSWORD,
      trigger: 'forced',
    });

    // The credential password is updated and sibling sessions revoked.
    expect(ctx.runMutation).toHaveBeenCalled();
    expect(revokeOtherSessions).toHaveBeenCalledWith({ headers: MOCK_HEADERS });
  });
});
