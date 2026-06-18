import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth:adapter:findMany',
      },
    },
  },
}));

vi.mock('../auth/require_authenticated_user', () => ({
  requireAuthenticatedUser: vi.fn(),
}));

vi.mock('../errors', () => {
  class RLSError extends Error {
    constructor(
      message: string,
      public code: string,
    ) {
      super(message);
      this.name = 'RLSError';
    }
  }
  class UnauthorizedError extends RLSError {
    constructor(message = 'Not authorized to access this resource') {
      super(message, 'UNAUTHORIZED');
    }
  }
  return { UnauthorizedError };
});

const { UnauthorizedError } = await import('../errors');
const { getOrganizationMember } = await import('./get_organization_member');

// `mirrorRow` seeds the local memberMirror lookup (the hot path). Default null
// → mirror miss → fall back to the authoritative Better Auth `runQuery` path the
// existing tests drive.
function createMockCtx(mirrorRow: unknown = null) {
  return {
    runQuery: vi.fn(),
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => mirrorRow,
        }),
      }),
    },
    auth: {},
  };
}

const authUser = { userId: 'user_1', email: 'test@example.com' };

describe('getOrganizationMember', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns member when role is not disabled', async () => {
    const ctx = createMockCtx();
    const member = {
      _id: 'om_1',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'admin',
      createdAt: 1000,
    };
    ctx.runQuery.mockResolvedValueOnce({ page: [member] });

    const result = await getOrganizationMember(ctx as never, 'org_1', authUser);

    expect(result).toEqual(member);
  });

  it('reads the local mirror without any cross-component query', async () => {
    const ctx = createMockCtx({
      memberId: 'om_1',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'admin',
      createdAt: 1000,
    });

    const result = await getOrganizationMember(ctx as never, 'org_1', authUser);

    // Reconstructed OrganizationMember._id is the Better Auth member id.
    expect(result).toEqual({
      _id: 'om_1',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'admin',
      createdAt: 1000,
    });
    // The whole point: no Better Auth round-trip on the hot path.
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedError for a disabled member found in the mirror', async () => {
    const ctx = createMockCtx({
      memberId: 'om_1',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'disabled',
      createdAt: 1000,
    });

    await expect(
      getOrganizationMember(ctx as never, 'org_1', authUser),
    ).rejects.toThrow(UnauthorizedError);
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedError when member role is disabled', async () => {
    const ctx = createMockCtx();
    const member = {
      _id: 'om_1',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'disabled',
      createdAt: 1000,
    };
    ctx.runQuery.mockResolvedValueOnce({ page: [member] });

    await expect(
      getOrganizationMember(ctx as never, 'org_1', authUser),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when member not found', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({ page: [] });

    await expect(
      getOrganizationMember(ctx as never, 'org_1', {
        userId: 'user_1',
      }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError for disabled member found via email fallback', async () => {
    const ctx = createMockCtx();
    // First query: no direct match
    ctx.runQuery.mockResolvedValueOnce({ page: [] });
    // Email lookup: find user by email
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'user_2', email: 'test@example.com' }],
    });
    // Second member lookup by email-resolved userId
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'om_2',
          organizationId: 'org_1',
          userId: 'user_2',
          role: 'disabled',
          createdAt: 1000,
        },
      ],
    });

    await expect(
      getOrganizationMember(ctx as never, 'org_1', authUser),
    ).rejects.toThrow(UnauthorizedError);
  });
});
