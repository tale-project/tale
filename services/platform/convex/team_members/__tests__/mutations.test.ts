import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth:adapter:findMany',
        findOne: 'betterAuth:adapter:findOne',
        create: 'betterAuth:adapter:create',
        deleteOne: 'betterAuth:adapter:deleteOne',
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

vi.mock('../../lib/rls', () => ({
  getOrganizationMember: vi.fn(),
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

const { getOrganizationMember } = await import('../../lib/rls');
const mockedGetOrgMember = vi.mocked(getOrganizationMember);

function createMockCtx() {
  return {
    runQuery: vi.fn(),
    runMutation: vi.fn(),
    db: {},
    auth: {},
  };
}

const AUTH_USER = {
  _id: 'user_1',
  email: 'admin@example.com',
  name: 'Admin',
};

describe('addMember handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getHandler() {
    const { addMember } = await import('../mutations');
    return (addMember as unknown as { handler: Function }).handler;
  }

  const defaultArgs = {
    teamId: 'team_1',
    userId: 'user_2',
    organizationId: 'org_1',
  };

  it('throws when unauthenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow('Unauthenticated');
  });

  it('throws when caller is not admin or owner', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    mockedGetOrgMember.mockResolvedValue({ role: 'member' } as never);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow(
      'Only admins can add team members',
    );
  });

  it('throws when team not found in organization', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    mockedGetOrgMember.mockResolvedValue({ role: 'admin' } as never);
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce(null);
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow(
      'Team not found in this organization',
    );
  });

  it('throws when team belongs to different organization', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    mockedGetOrgMember.mockResolvedValue({ role: 'admin' } as never);
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({
      _id: 'team_1',
      organizationId: 'other_org',
    });
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow(
      'Team not found in this organization',
    );
  });

  it('throws when target user is not an org member', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    mockedGetOrgMember.mockResolvedValue({ role: 'admin' } as never);
    const ctx = createMockCtx();
    // findOne for team
    ctx.runQuery.mockResolvedValueOnce({
      _id: 'team_1',
      organizationId: 'org_1',
    });
    // findMany for target org member - empty
    ctx.runQuery.mockResolvedValueOnce({ page: [] });
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow(
      'User is not a member of this organization',
    );
  });

  it('throws when user is already a team member', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    mockedGetOrgMember.mockResolvedValue({ role: 'admin' } as never);
    const ctx = createMockCtx();
    // findOne for team
    ctx.runQuery.mockResolvedValueOnce({
      _id: 'team_1',
      organizationId: 'org_1',
    });
    // findMany for target org member
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'member_1', userId: 'user_2' }],
    });
    // findMany for existing team member
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'tm_existing', userId: 'user_2' }],
    });
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow(
      'User is already a member of this team',
    );
  });

  it('creates team member successfully', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    mockedGetOrgMember.mockResolvedValue({ role: 'admin' } as never);
    const ctx = createMockCtx();
    // findOne for team
    ctx.runQuery.mockResolvedValueOnce({
      _id: 'team_1',
      organizationId: 'org_1',
    });
    // findMany for target org member
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'member_1', userId: 'user_2' }],
    });
    // findMany for existing team member - empty
    ctx.runQuery.mockResolvedValueOnce({ page: [] });
    // create mutation
    ctx.runMutation.mockResolvedValueOnce({ _id: 'tm_new' });
    const handler = await getHandler();

    const result = await handler(ctx, defaultArgs);

    expect(result).toEqual({ _id: 'tm_new' });
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'betterAuth:adapter:create',
      expect.objectContaining({
        input: expect.objectContaining({
          model: 'teamMember',
          data: expect.objectContaining({
            teamId: 'team_1',
            userId: 'user_2',
          }),
        }),
      }),
    );
  });

  it('allows owner role to add members', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    mockedGetOrgMember.mockResolvedValue({ role: 'owner' } as never);
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({
      _id: 'team_1',
      organizationId: 'org_1',
    });
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'member_1', userId: 'user_2' }],
    });
    ctx.runQuery.mockResolvedValueOnce({ page: [] });
    ctx.runMutation.mockResolvedValueOnce({ _id: 'tm_new' });
    const handler = await getHandler();

    const result = await handler(ctx, defaultArgs);

    expect(result).toEqual({ _id: 'tm_new' });
  });
});

describe('removeMember handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getHandler() {
    const { removeMember } = await import('../mutations');
    return (removeMember as unknown as { handler: Function }).handler;
  }

  const defaultArgs = {
    teamMemberId: 'tm_1',
    organizationId: 'org_1',
  };

  it('throws when unauthenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow('Unauthenticated');
  });

  it('throws when team member not found', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    mockedGetOrgMember.mockResolvedValue({ role: 'admin' } as never);
    const ctx = createMockCtx();
    // findOne for teamMember - not found
    ctx.runQuery.mockResolvedValueOnce(null);
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow(
      'Team member not found',
    );
  });

  it('throws when non-admin removes another member', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    mockedGetOrgMember.mockResolvedValue({ role: 'member' } as never);
    const ctx = createMockCtx();
    // findOne for teamMember - belongs to a different user
    ctx.runQuery.mockResolvedValueOnce({
      _id: 'tm_1',
      teamId: 'team_1',
      userId: 'user_other',
    });
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow(
      'Only admins can remove other team members',
    );
  });

  it('allows self-removal for non-admin when team has multiple members', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    mockedGetOrgMember.mockResolvedValue({ role: 'member' } as never);
    const ctx = createMockCtx();
    // findOne for teamMember - belongs to caller
    ctx.runQuery.mockResolvedValueOnce({
      _id: 'tm_1',
      teamId: 'team_1',
      userId: 'user_1',
    });
    // findOne for team
    ctx.runQuery.mockResolvedValueOnce({
      _id: 'team_1',
      organizationId: 'org_1',
    });
    // findMany for member count - 2 members
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        { _id: 'tm_1', userId: 'user_1' },
        { _id: 'tm_2', userId: 'user_2' },
      ],
    });
    ctx.runMutation.mockResolvedValueOnce(undefined);
    const handler = await getHandler();

    const result = await handler(ctx, defaultArgs);

    expect(result).toBeNull();
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'betterAuth:adapter:deleteOne',
      {
        input: {
          model: 'teamMember',
          where: [{ field: '_id', value: 'tm_1', operator: 'eq' }],
        },
      },
    );
  });

  it('throws when removing the last team member', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    mockedGetOrgMember.mockResolvedValue({ role: 'admin' } as never);
    const ctx = createMockCtx();
    // findOne for teamMember
    ctx.runQuery.mockResolvedValueOnce({
      _id: 'tm_1',
      teamId: 'team_1',
      userId: 'user_1',
    });
    // findOne for team
    ctx.runQuery.mockResolvedValueOnce({
      _id: 'team_1',
      organizationId: 'org_1',
    });
    // findMany for member count - only 1 member
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'tm_1', userId: 'user_1' }],
    });
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow(
      'Cannot remove the last team member. Delete the team instead.',
    );
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('throws when member count query returns null', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    mockedGetOrgMember.mockResolvedValue({ role: 'admin' } as never);
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({
      _id: 'tm_1',
      teamId: 'team_1',
      userId: 'user_1',
    });
    ctx.runQuery.mockResolvedValueOnce({
      _id: 'team_1',
      organizationId: 'org_1',
    });
    // findMany for member count - returns null
    ctx.runQuery.mockResolvedValueOnce(null);
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow(
      'Cannot remove the last team member. Delete the team instead.',
    );
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('throws when team not found in organization', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    mockedGetOrgMember.mockResolvedValue({ role: 'admin' } as never);
    const ctx = createMockCtx();
    // findOne for teamMember
    ctx.runQuery.mockResolvedValueOnce({
      _id: 'tm_1',
      teamId: 'team_1',
      userId: 'user_other',
    });
    // findOne for team - not found
    ctx.runQuery.mockResolvedValueOnce(null);
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow(
      'Team not found in this organization',
    );
  });

  it('throws when team belongs to different organization', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    mockedGetOrgMember.mockResolvedValue({ role: 'admin' } as never);
    const ctx = createMockCtx();
    // findOne for teamMember
    ctx.runQuery.mockResolvedValueOnce({
      _id: 'tm_1',
      teamId: 'team_1',
      userId: 'user_other',
    });
    // findOne for team - different org
    ctx.runQuery.mockResolvedValueOnce({
      _id: 'team_1',
      organizationId: 'other_org',
    });
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow(
      'Team not found in this organization',
    );
  });

  it('successfully removes a member when team has multiple members', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    mockedGetOrgMember.mockResolvedValue({ role: 'admin' } as never);
    const ctx = createMockCtx();
    // findOne for teamMember
    ctx.runQuery.mockResolvedValueOnce({
      _id: 'tm_1',
      teamId: 'team_1',
      userId: 'user_other',
    });
    // findOne for team
    ctx.runQuery.mockResolvedValueOnce({
      _id: 'team_1',
      organizationId: 'org_1',
    });
    // findMany for member count - 3 members
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        { _id: 'tm_1', userId: 'user_other' },
        { _id: 'tm_2', userId: 'user_1' },
      ],
    });
    ctx.runMutation.mockResolvedValueOnce(undefined);
    const handler = await getHandler();

    const result = await handler(ctx, defaultArgs);

    expect(result).toBeNull();
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'betterAuth:adapter:deleteOne',
      {
        input: {
          model: 'teamMember',
          where: [{ field: '_id', value: 'tm_1', operator: 'eq' }],
        },
      },
    );
  });
});
