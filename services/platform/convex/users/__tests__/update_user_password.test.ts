import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockChangePassword = vi.fn();
const mockSetPassword = vi.fn();
const mockGetAuth = vi.fn();
const mockGetAuthUser = vi.fn();

vi.mock('../../auth', () => ({
  authComponent: {
    getAuth: (...args: unknown[]) => mockGetAuth(...args),
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
  createAuth: 'createAuth',
}));

const mockHasCredentialAccount = vi.fn();
vi.mock('../../accounts/helpers', () => ({
  hasCredentialAccount: (...args: unknown[]) =>
    mockHasCredentialAccount(...args),
}));

const mockGetUserOrganizations = vi.fn();
vi.mock('../../lib/rls/organization/get_user_organizations', () => ({
  getUserOrganizations: (...args: unknown[]) =>
    mockGetUserOrganizations(...args),
}));

const mockGetStrictestPasswordPolicyForUser = vi.fn();
vi.mock('../../governance/helpers', () => ({
  getStrictestPasswordPolicyForUser: (...args: unknown[]) =>
    mockGetStrictestPasswordPolicyForUser(...args),
}));

vi.mock('../password_metadata', () => ({
  recordPasswordChange: vi.fn(),
}));

vi.mock('../../audit_logs/helpers', () => ({
  createAuditLog: vi.fn(),
}));

vi.mock('convex/values', () => {
  const stub = () => 'validator';
  return {
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

vi.mock('../../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth:adapter:findMany',
      },
    },
  },
}));

vi.mock('../../_generated/server', async (importOriginal) => {
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
    auth: {},
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
        maxAgeDays: null,
      },
      effectiveAt: null,
    });
  });

  async function getHandler() {
    const mod = await import('../update_user_password');
    return mod.updateUserPassword;
  }

  it('throws when password is invalid', async () => {
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(
      handler(ctx as never, { newPassword: 'weak' }),
    ).rejects.toThrow('Password does not meet policy');
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
    ).rejects.toThrow('Current password is required');
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
});
