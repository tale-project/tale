import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth:adapter:findMany',
        create: 'betterAuth:adapter:create',
        updateMany: 'betterAuth:adapter:updateMany',
        deleteMany: 'betterAuth:adapter:deleteMany',
      },
    },
  },
}));

const mockGetAuthUser = vi.fn();
vi.mock('../../auth', () => ({
  authComponent: {
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
}));

vi.mock('better-auth/crypto', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed_new_password'),
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

const AUTH_USER = {
  _id: 'caller_user_id',
  email: 'admin@example.com',
  name: 'Admin',
};

const VALID_PASSWORD = 'StrongP@ss1';

describe('setMemberPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getHandler() {
    const { setMemberPassword } = await import('../mutations');
    return (setMemberPassword as unknown as { handler: Function }).handler;
  }

  const defaultArgs = {
    memberId: 'member_1',
    newPassword: VALID_PASSWORD,
  };

  it('throws when unauthenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow('Unauthenticated');
  });

  it('throws when password is invalid', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(
      handler(ctx, { ...defaultArgs, newPassword: 'weak' }),
    ).rejects.toThrow('Password must be at least 8 characters');
  });

  it('throws when member not found', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // findMany for member - empty
    ctx.runQuery.mockResolvedValueOnce({ page: [] });
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow('Member not found');
  });

  it('throws when caller is not admin', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // findMany for target member
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'member_1',
          userId: 'target_user_id',
          organizationId: 'org_1',
        },
      ],
    });
    // findMany for caller member - non-admin role
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        { _id: 'caller_member', userId: 'caller_user_id', role: 'member' },
      ],
    });
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow(
      'Only admins can set member passwords',
    );
  });

  it('updates existing credential and invalidates all sessions', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // findMany for target member
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'member_1',
          userId: 'target_user_id',
          organizationId: 'org_1',
        },
      ],
    });
    // findMany for caller member - admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'caller_member', userId: 'caller_user_id', role: 'admin' }],
    });
    // findMany for existing credential account
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'account_1',
          userId: 'target_user_id',
          providerId: 'credential',
        },
      ],
    });
    // updateMany for password
    ctx.runMutation.mockResolvedValueOnce(undefined);
    // deleteMany for sessions
    ctx.runMutation.mockResolvedValueOnce(undefined);
    // findMany to check remaining sessions - empty means done
    ctx.runQuery.mockResolvedValueOnce({ page: [] });
    const handler = await getHandler();

    await handler(ctx, defaultArgs);

    // Verify password was updated
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'betterAuth:adapter:updateMany',
      expect.objectContaining({
        input: expect.objectContaining({
          model: 'account',
          update: expect.objectContaining({
            password: 'hashed_new_password',
          }),
        }),
      }),
    );

    // Verify sessions were invalidated
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'betterAuth:adapter:deleteMany',
      {
        input: {
          model: 'session',
          where: [{ field: 'userId', value: 'target_user_id', operator: 'eq' }],
        },
        paginationOpts: { cursor: null, numItems: 100 },
      },
    );
  });

  it('creates new credential and invalidates all sessions', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // findMany for target member
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'member_1',
          userId: 'target_user_id',
          organizationId: 'org_1',
        },
      ],
    });
    // findMany for caller member - owner
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'caller_member', userId: 'caller_user_id', role: 'owner' }],
    });
    // findMany for existing credential - empty (OAuth-only user)
    ctx.runQuery.mockResolvedValueOnce({ page: [] });
    // create for new credential account
    ctx.runMutation.mockResolvedValueOnce({ _id: 'new_account' });
    // deleteMany for sessions
    ctx.runMutation.mockResolvedValueOnce(undefined);
    // findMany to check remaining sessions - empty means done
    ctx.runQuery.mockResolvedValueOnce({ page: [] });
    const handler = await getHandler();

    await handler(ctx, defaultArgs);

    // Verify credential was created
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'betterAuth:adapter:create',
      expect.objectContaining({
        input: expect.objectContaining({
          model: 'account',
          data: expect.objectContaining({
            userId: 'target_user_id',
            providerId: 'credential',
            password: 'hashed_new_password',
          }),
        }),
      }),
    );

    // Verify sessions were invalidated
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'betterAuth:adapter:deleteMany',
      {
        input: {
          model: 'session',
          where: [{ field: 'userId', value: 'target_user_id', operator: 'eq' }],
        },
        paginationOpts: { cursor: null, numItems: 100 },
      },
    );
  });
});
