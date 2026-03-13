import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth:adapter:findMany',
        findOne: 'betterAuth:adapter:findOne',
        create: 'betterAuth:adapter:create',
        deleteOne: 'betterAuth:adapter:deleteOne',
        updateMany: 'betterAuth:adapter:updateMany',
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

vi.mock('../../audit_logs/helpers', () => ({
  logSuccess: vi.fn(),
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

vi.mock('../validators', () => ({
  memberRoleValidator: 'memberRoleValidator',
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

const AUTH_USER = {
  _id: 'user_caller',
  email: 'admin@example.com',
  name: 'Admin',
};

// ---------------------------------------------------------------------------
// removeMember
// ---------------------------------------------------------------------------

describe('removeMember handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getHandler() {
    const { removeMember } = await import('../mutations');
    return (removeMember as unknown as { handler: Function }).handler;
  }

  it('throws when unauthenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(handler(ctx, { memberId: 'm_1' })).rejects.toThrow(
      'Unauthenticated',
    );
  });

  it('throws when member not found', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({ page: [] });
    const handler = await getHandler();

    await expect(handler(ctx, { memberId: 'm_1' })).rejects.toThrow(
      'Member not found',
    );
  });

  it('throws when caller is not admin', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member lookup
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_target',
          organizationId: 'org_1',
          userId: 'user_target',
          role: 'member',
        },
      ],
    });
    // caller member lookup — non-admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'member' }],
    });
    const handler = await getHandler();

    await expect(handler(ctx, { memberId: 'm_target' })).rejects.toThrow(
      'Only admins can remove members',
    );
  });

  it('throws when trying to remove the owner', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member is the owner
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_owner',
          organizationId: 'org_1',
          userId: 'user_owner',
          role: 'owner',
        },
      ],
    });
    // caller is admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'admin' }],
    });
    const handler = await getHandler();

    await expect(handler(ctx, { memberId: 'm_owner' })).rejects.toThrow(
      'The organization owner cannot be removed',
    );
  });

  it('allows owner to remove a non-owner member', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_target',
          organizationId: 'org_1',
          userId: 'user_target',
          role: 'member',
        },
      ],
    });
    // caller is owner
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'owner' }],
    });
    // user lookup for target
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'user_target', email: 'target@example.com' }],
    });
    // deleteOne
    ctx.runMutation.mockResolvedValueOnce(undefined);
    const handler = await getHandler();

    const result = await handler(ctx, { memberId: 'm_target' });

    expect(result).toBeNull();
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'betterAuth:adapter:deleteOne',
      expect.objectContaining({
        input: {
          model: 'member',
          where: [{ field: '_id', value: 'm_target', operator: 'eq' }],
        },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// updateMemberRole
// ---------------------------------------------------------------------------

describe('updateMemberRole handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getHandler() {
    const { updateMemberRole } = await import('../mutations');
    return (updateMemberRole as unknown as { handler: Function }).handler;
  }

  it('throws when unauthenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(
      handler(ctx, { memberId: 'm_1', role: 'editor' }),
    ).rejects.toThrow('Unauthenticated');
  });

  it('throws when caller is not admin', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_target',
          organizationId: 'org_1',
          userId: 'user_target',
          role: 'member',
        },
      ],
    });
    // caller — non-admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'editor' }],
    });
    const handler = await getHandler();

    await expect(
      handler(ctx, { memberId: 'm_target', role: 'admin' }),
    ).rejects.toThrow('Only admins can update member roles');
  });

  it('throws when trying to change the owner role', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member is owner
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_owner',
          organizationId: 'org_1',
          userId: 'user_owner',
          role: 'owner',
        },
      ],
    });
    // caller is admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'admin' }],
    });
    const handler = await getHandler();

    await expect(
      handler(ctx, { memberId: 'm_owner', role: 'member' }),
    ).rejects.toThrow('The organization owner role cannot be changed');
  });

  it('throws when trying to assign owner role manually', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member is a regular member
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_target',
          organizationId: 'org_1',
          userId: 'user_target',
          role: 'member',
        },
      ],
    });
    // caller is admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'admin' }],
    });
    const handler = await getHandler();

    await expect(
      handler(ctx, { memberId: 'm_target', role: 'owner' }),
    ).rejects.toThrow('The owner role cannot be assigned manually');
  });

  it('throws when demoting the last admin', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member is admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_target',
          organizationId: 'org_1',
          userId: 'user_target',
          role: 'admin',
        },
      ],
    });
    // caller is the same admin (self-demotion scenario)
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_target', role: 'admin' }],
    });
    // user lookup for target
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'user_target', email: 'target@example.com' }],
    });
    // findMany for all org members — only 1 admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        { _id: 'm_target', role: 'admin' },
        { _id: 'm_other', role: 'member' },
      ],
    });
    const handler = await getHandler();

    await expect(
      handler(ctx, { memberId: 'm_target', role: 'member' }),
    ).rejects.toThrow(
      'Cannot demote the last admin. The organization must have at least one admin or owner.',
    );
  });

  it('allows demoting admin when owner exists', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member is admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_target',
          organizationId: 'org_1',
          userId: 'user_target',
          role: 'admin',
        },
      ],
    });
    // caller is owner
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'owner' }],
    });
    // user lookup for target
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'user_target', email: 'target@example.com' }],
    });
    // findMany for all org members — owner + admin = 2 admin-level
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        { _id: 'm_caller', role: 'owner' },
        { _id: 'm_target', role: 'admin' },
        { _id: 'm_other', role: 'member' },
      ],
    });
    // updateMany
    ctx.runMutation.mockResolvedValueOnce(undefined);
    const handler = await getHandler();

    const result = await handler(ctx, {
      memberId: 'm_target',
      role: 'member',
    });

    expect(result).toBeNull();
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'betterAuth:adapter:updateMany',
      expect.objectContaining({
        input: expect.objectContaining({
          model: 'member',
          update: { role: 'member' },
        }),
      }),
    );
  });

  it('allows non-admin role change without last-admin check', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member is editor (not admin)
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_target',
          organizationId: 'org_1',
          userId: 'user_target',
          role: 'editor',
        },
      ],
    });
    // caller is admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'admin' }],
    });
    // user lookup for target
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'user_target', email: 'target@example.com' }],
    });
    // updateMany — no last-admin query needed
    ctx.runMutation.mockResolvedValueOnce(undefined);
    const handler = await getHandler();

    const result = await handler(ctx, {
      memberId: 'm_target',
      role: 'developer',
    });

    expect(result).toBeNull();
    // Should only have 3 runQuery calls (member, caller, user) — no admin count query
    expect(ctx.runQuery).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// addMember
// ---------------------------------------------------------------------------

describe('addMember handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getHandler() {
    const { addMember } = await import('../mutations');
    return (addMember as unknown as { handler: Function }).handler;
  }

  const defaultArgs = {
    organizationId: 'org_1',
    userId: 'user_target',
  };

  it('throws when unauthenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow('Unauthenticated');
  });

  it('throws when caller is not admin', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'member' }],
    });
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow(
      'Only admins can add members',
    );
  });

  it('allows owner to add members', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // caller is owner
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'owner' }],
    });
    // target user lookup
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'user_target', email: 'target@example.com' }],
    });
    // create
    ctx.runMutation.mockResolvedValueOnce({ _id: 'm_new' });
    const handler = await getHandler();

    const result = await handler(ctx, defaultArgs);

    expect(result).toBe('m_new');
  });
});
