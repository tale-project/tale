import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth:adapter:findMany',
        findOne: 'betterAuth:adapter:findOne',
      },
    },
  },
}));

vi.mock('../../lib/rls', () => ({
  getAuthUserIdentity: vi.fn(),
  getOrganizationMember: vi.fn(),
}));

vi.mock('../../lib/rls/errors', () => {
  class RLSError extends Error {
    constructor(
      message: string,
      public code: string,
    ) {
      super(message);
      this.name = 'RLSError';
    }
  }
  return {
    UnauthorizedError: class extends RLSError {
      constructor() {
        super('Not authorized to access this resource', 'UNAUTHORIZED');
      }
    },
  };
});

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
    query: (config: Record<string, unknown>) => config,
  };
});

const { getAuthUserIdentity, getOrganizationMember } =
  await import('../../lib/rls');
const { UnauthorizedError } = await import('../../lib/rls/errors');

const mockedGetAuthUser = vi.mocked(getAuthUserIdentity);
const mockedGetOrgMember = vi.mocked(getOrganizationMember);

function createMockCtx() {
  return {
    runQuery: vi.fn(),
    db: {},
    auth: {},
  };
}

describe('listByTeam handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getHandler() {
    const { listByTeam } = await import('../queries');
    return (listByTeam as unknown as { handler: Function }).handler;
  }

  it('returns empty array when not authenticated', async () => {
    mockedGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();
    const handler = await getHandler();

    const result = await handler(ctx, { teamId: 'team_1' });

    expect(result).toEqual([]);
  });

  it('returns empty array when team not found', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce(null);
    const handler = await getHandler();

    const result = await handler(ctx, { teamId: 'team_1' });

    expect(result).toEqual([]);
  });

  it('returns empty array when unauthorized', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({
      _id: 'team_1',
      organizationId: 'org_1',
    });
    mockedGetOrgMember.mockRejectedValue(new UnauthorizedError());
    const handler = await getHandler();

    const result = await handler(ctx, { teamId: 'team_1' });

    expect(result).toEqual([]);
  });

  it('re-throws non-authorization errors from getOrganizationMember', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({
      _id: 'team_1',
      organizationId: 'org_1',
    });
    mockedGetOrgMember.mockRejectedValue(new Error('DB failure'));
    const handler = await getHandler();

    await expect(handler(ctx, { teamId: 'team_1' })).rejects.toThrow(
      'DB failure',
    );
  });

  it('returns members with user details', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    const ctx = createMockCtx();

    ctx.runQuery.mockResolvedValueOnce({
      _id: 'team_1',
      organizationId: 'org_1',
    });
    mockedGetOrgMember.mockResolvedValue({} as never);

    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'tm_1',
          teamId: 'team_1',
          userId: 'u_1',
          role: 'admin',
          createdAt: 1000,
        },
      ],
    });

    ctx.runQuery.mockResolvedValueOnce({
      name: 'Alice',
      email: 'alice@example.com',
    });

    const handler = await getHandler();
    const result = await handler(ctx, { teamId: 'team_1' });

    expect(result).toEqual([
      {
        _id: 'tm_1',
        teamId: 'team_1',
        userId: 'u_1',
        role: 'admin',
        joinedAt: 1000,
        displayName: 'Alice',
        email: 'alice@example.com',
      },
    ]);
  });

  it('returns member without name/email when user lookup fails', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    const ctx = createMockCtx();

    ctx.runQuery.mockResolvedValueOnce({
      _id: 'team_1',
      organizationId: 'org_1',
    });
    mockedGetOrgMember.mockResolvedValue({} as never);

    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'tm_1',
          teamId: 'team_1',
          userId: 'u_1',
          role: 'member',
          createdAt: 2000,
        },
      ],
    });

    ctx.runQuery.mockRejectedValueOnce(new Error('lookup failed'));

    const handler = await getHandler();
    const result = await handler(ctx, { teamId: 'team_1' });

    expect(result).toEqual([
      {
        _id: 'tm_1',
        teamId: 'team_1',
        userId: 'u_1',
        role: 'member',
        joinedAt: 2000,
        displayName: undefined,
        email: undefined,
      },
    ]);
  });
});
