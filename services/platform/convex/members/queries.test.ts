import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { QueryCtx } from '../_generated/server';

vi.mock('../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth:adapter:findMany',
        findOne: 'betterAuth:adapter:findOne',
      },
    },
  },
}));

vi.mock('../lib/rls', () => ({
  getAuthUserIdentity: vi.fn(),
  getOrganizationMember: vi.fn(),
  getUserOrganizations: vi.fn(),
}));

vi.mock('../lib/rls/errors', () => {
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
    UnauthenticatedError: class extends RLSError {
      constructor() {
        super('Authentication required', 'UNAUTHENTICATED');
      }
    },
    UnauthorizedError: class extends RLSError {
      // Mirrors the real signature: org-membership gates pass ORG_NOT_FOUND /
      // ORG_FORBIDDEN so getCurrentMemberContext can map code → status.
      constructor(
        message = 'Not authorized to access this resource',
        code = 'UNAUTHORIZED',
      ) {
        super(message, code);
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

vi.mock('./validators', () => ({
  memberRoleValidator: 'memberRoleValidator',
}));

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    query: (config: Record<string, unknown>) => config,
  };
});

const { getAuthUserIdentity, getOrganizationMember } =
  await import('../lib/rls');
const { UnauthorizedError } = await import('../lib/rls/errors');
const {
  getMyTeamsHandler,
  approxCountMyTeamsHandler,
  listByOrganizationHandler,
  listOrgTeamsHandler,
} = await import('./queries');

const mockedGetAuthUser = vi.mocked(getAuthUserIdentity);
const mockedGetOrgMember = vi.mocked(getOrganizationMember);

function createMockCtx() {
  return {
    runQuery: vi.fn(),
    db: {},
    auth: {},
  };
}

describe('getCurrentMemberContext handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getHandler() {
    const { getCurrentMemberContext } = await import('./queries');
    return (getCurrentMemberContext as unknown as { handler: Function })
      .handler;
  }

  it('returns null when not authenticated', async () => {
    mockedGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();
    const handler = await getHandler();

    const result = await handler(ctx, { organizationId: 'org_1' });

    expect(result).toBeNull();
  });

  it('returns not_found when the organization no longer exists', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1', name: 'Alice' });
    // getOrganizationMember classifies a dead/malformed org id as ORG_NOT_FOUND.
    mockedGetOrgMember.mockRejectedValue(
      new UnauthorizedError('Organization "org_1" not found.', 'ORG_NOT_FOUND'),
    );
    const ctx = createMockCtx();
    const handler = await getHandler();

    const result = await handler(ctx, { organizationId: 'org_1' });

    expect(result).toEqual({ status: 'not_found' });
  });

  it('returns not_member when the org exists but the user is not in it', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1', name: 'Alice' });
    mockedGetOrgMember.mockRejectedValue(
      new UnauthorizedError(
        'Not a member of organization org_1',
        'ORG_FORBIDDEN',
      ),
    );
    const ctx = createMockCtx();
    const handler = await getHandler();

    const result = await handler(ctx, { organizationId: 'org_1' });

    expect(result).toEqual({ status: 'not_member' });
  });

  it('returns not_member for a generic UnauthorizedError without a code', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1', name: 'Alice' });
    mockedGetOrgMember.mockRejectedValue(new UnauthorizedError());
    const ctx = createMockCtx();
    const handler = await getHandler();

    const result = await handler(ctx, { organizationId: 'org_1' });

    expect(result).toEqual({ status: 'not_member' });
  });

  it('re-throws non-authorization errors from getOrganizationMember', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1', name: 'Alice' });
    mockedGetOrgMember.mockRejectedValue(new Error('DB failure'));
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(handler(ctx, { organizationId: 'org_1' })).rejects.toThrow(
      'DB failure',
    );
  });

  it('returns member context on success', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1', name: 'Alice' });
    mockedGetOrgMember.mockResolvedValue({
      _id: 'om_1',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'admin',
      createdAt: 1000,
    });
    const ctx = createMockCtx();
    const handler = await getHandler();

    const result = await handler(ctx, { organizationId: 'org_1' });

    expect(result).toEqual({
      status: 'ok',
      memberId: 'om_1',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'admin',
      createdAt: 1000,
      displayName: 'Alice',
      isAdmin: true,
    });
  });

  it('returns isAdmin true for owner role', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1', name: 'Alice' });
    mockedGetOrgMember.mockResolvedValue({
      _id: 'om_1',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'owner',
      createdAt: 1000,
    });
    const ctx = createMockCtx();
    const handler = await getHandler();

    const result = await handler(ctx, { organizationId: 'org_1' });

    expect(result).toEqual({
      status: 'ok',
      memberId: 'om_1',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'owner',
      createdAt: 1000,
      displayName: 'Alice',
      isAdmin: true,
    });
  });

  it('defaults to member role for invalid roles', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1', name: 'Bob' });
    mockedGetOrgMember.mockResolvedValue({
      _id: 'om_2',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'superadmin',
      createdAt: 2000,
    });
    const ctx = createMockCtx();
    const handler = await getHandler();

    const result = await handler(ctx, { organizationId: 'org_1' });

    expect(result).toEqual({
      status: 'ok',
      memberId: 'om_2',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'member',
      createdAt: 2000,
      displayName: 'Bob',
      isAdmin: false,
    });
  });
});

describe('getMyTeamsHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when not authenticated', async () => {
    mockedGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();

    const result = await getMyTeamsHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual([]);
  });

  it('returns empty array when user has no team memberships', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    const ctx = createMockCtx();

    ctx.runQuery.mockResolvedValueOnce({ page: [] });

    const result = await getMyTeamsHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual([]);
  });

  it('returns teams for user with memberships', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    const ctx = createMockCtx();

    ctx.runQuery.mockResolvedValueOnce({
      page: [
        { _id: 'tm_1', teamId: 'team_1', userId: 'user_1' },
        { _id: 'tm_2', teamId: 'team_2', userId: 'user_1' },
      ],
    });

    ctx.runQuery
      .mockResolvedValueOnce({
        page: [{ _id: 'team_1', name: 'Alpha', organizationId: 'org_1' }],
      })
      .mockResolvedValueOnce({
        page: [{ _id: 'team_2', name: 'Beta', organizationId: 'org_1' }],
      })
      // member count queries
      .mockResolvedValueOnce({ page: [{ _id: 'tm_1' }, { _id: 'tm_3' }] })
      .mockResolvedValueOnce({ page: [{ _id: 'tm_2' }] });

    const result = await getMyTeamsHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual([
      { id: 'team_1', name: 'Alpha', memberCount: 2, createdAt: null },
      { id: 'team_2', name: 'Beta', memberCount: 1, createdAt: null },
    ]);
  });

  it('returns partial results when some team lookups fail', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    const ctx = createMockCtx();

    ctx.runQuery.mockResolvedValueOnce({
      page: [
        { _id: 'tm_1', teamId: 'team_1', userId: 'user_1' },
        { _id: 'tm_2', teamId: 'team_2', userId: 'user_1' },
        { _id: 'tm_3', teamId: 'team_3', userId: 'user_1' },
      ],
    });

    ctx.runQuery
      .mockResolvedValueOnce({
        page: [{ _id: 'team_1', name: 'Alpha', organizationId: 'org_1' }],
      })
      .mockRejectedValueOnce(new Error('DB connection lost'))
      .mockResolvedValueOnce({
        page: [{ _id: 'team_3', name: 'Gamma', organizationId: 'org_1' }],
      })
      // member count queries
      .mockResolvedValueOnce({ page: [{ _id: 'tm_1' }] })
      .mockResolvedValueOnce({ page: [{ _id: 'tm_4' }, { _id: 'tm_5' }] });

    const result = await getMyTeamsHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual([
      { id: 'team_1', name: 'Alpha', memberCount: 1, createdAt: null },
      { id: 'team_3', name: 'Gamma', memberCount: 2, createdAt: null },
    ]);
  });

  it('returns empty array when all team lookups fail', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    const ctx = createMockCtx();

    ctx.runQuery.mockResolvedValueOnce({
      page: [
        { _id: 'tm_1', teamId: 'team_1', userId: 'user_1' },
        { _id: 'tm_2', teamId: 'team_2', userId: 'user_1' },
      ],
    });

    ctx.runQuery
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'));

    const result = await getMyTeamsHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual([]);
  });
});

describe('approxCountMyTeamsHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 when not authenticated', async () => {
    mockedGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();

    const result = await approxCountMyTeamsHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toBe(0);
  });

  it('counts teams correctly', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    const ctx = createMockCtx();

    ctx.runQuery.mockResolvedValueOnce({
      page: [
        { _id: 'tm_1', teamId: 'team_1', userId: 'user_1' },
        { _id: 'tm_2', teamId: 'team_2', userId: 'user_1' },
      ],
    });

    ctx.runQuery
      .mockResolvedValueOnce({ page: [{ _id: 'team_1' }] })
      .mockResolvedValueOnce({ page: [{ _id: 'team_2' }] });

    const result = await approxCountMyTeamsHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toBe(2);
  });

  it('counts only successful lookups on partial failure', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    const ctx = createMockCtx();

    ctx.runQuery.mockResolvedValueOnce({
      page: [
        { _id: 'tm_1', teamId: 'team_1', userId: 'user_1' },
        { _id: 'tm_2', teamId: 'team_2', userId: 'user_1' },
        { _id: 'tm_3', teamId: 'team_3', userId: 'user_1' },
      ],
    });

    ctx.runQuery
      .mockResolvedValueOnce({ page: [{ _id: 'team_1' }] })
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({ page: [{ _id: 'team_3' }] });

    const result = await approxCountMyTeamsHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toBe(2);
  });
});

describe('listByOrganizationHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when not authenticated', async () => {
    mockedGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();

    const result = await listByOrganizationHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual([]);
  });

  it('returns empty array when unauthorized', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetOrgMember.mockRejectedValue(new UnauthorizedError());
    const ctx = createMockCtx();

    const result = await listByOrganizationHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual([]);
  });

  it('re-throws non-authorization errors from getOrganizationMember', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetOrgMember.mockRejectedValue(new Error('DB connection lost'));
    const ctx = createMockCtx();

    await expect(
      listByOrganizationHandler(ctx as unknown as QueryCtx, {
        organizationId: 'org_1',
      }),
    ).rejects.toThrow('DB connection lost');
  });

  it('returns members with user details', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetOrgMember.mockResolvedValue({
      _id: 'om_1',
      createdAt: 1000,
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'admin',
    });
    const ctx = createMockCtx();

    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_1',
          organizationId: 'org_1',
          userId: 'u_1',
          role: 'admin',
          createdAt: 1000,
        },
      ],
    });

    // Single batched user lookup (findMany with `in`) returns a page.
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'u_1', name: 'Alice', email: 'alice@example.com' }],
    });

    const result = await listByOrganizationHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual([
      {
        _id: 'm_1',
        organizationId: 'org_1',
        userId: 'u_1',
        role: 'admin',
        createdAt: 1000,
        displayName: 'Alice',
        email: 'alice@example.com',
        twoFactorEnabled: false,
        passkeyCount: 0,
      },
    ]);
  });

  it('returns member without name/email when its user is absent from the batch lookup', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetOrgMember.mockResolvedValue({
      _id: 'om_1',
      createdAt: 1000,
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'admin',
    });
    const ctx = createMockCtx();

    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_1',
          organizationId: 'org_1',
          userId: 'u_1',
          role: 'member',
          createdAt: 1000,
        },
        {
          _id: 'm_2',
          organizationId: 'org_1',
          userId: 'u_2',
          role: 'admin',
          createdAt: 2000,
        },
      ],
    });

    // Batched user lookup returns only u_2 — u_1 is missing, so m_1 gets no
    // user details while m_2 is enriched.
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'u_2', name: 'Bob', email: 'bob@example.com' }],
    });

    const result = await listByOrganizationHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual([
      {
        _id: 'm_1',
        organizationId: 'org_1',
        userId: 'u_1',
        role: 'member',
        createdAt: 1000,
        displayName: undefined,
        email: undefined,
        twoFactorEnabled: false,
        passkeyCount: 0,
      },
      {
        _id: 'm_2',
        organizationId: 'org_1',
        userId: 'u_2',
        role: 'admin',
        createdAt: 2000,
        displayName: 'Bob',
        email: 'bob@example.com',
        twoFactorEnabled: false,
        passkeyCount: 0,
      },
    ]);
  });

  it('aggregates passkey counts per member from one batched lookup (#1508)', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetOrgMember.mockResolvedValue({
      _id: 'om_1',
      createdAt: 1000,
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'admin',
    });
    const ctx = createMockCtx();

    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_1',
          organizationId: 'org_1',
          userId: 'u_1',
          role: 'member',
          createdAt: 1000,
        },
        {
          _id: 'm_2',
          organizationId: 'org_1',
          userId: 'u_2',
          role: 'admin',
          createdAt: 2000,
        },
      ],
    });

    // Batched user lookup.
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        { _id: 'u_1', name: 'Alice', email: 'alice@example.com' },
        { _id: 'u_2', name: 'Bob', email: 'bob@example.com' },
      ],
    });

    // Batched passkey lookup: u_1 has two credentials, u_2 has none.
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        { _id: 'pk_1', userId: 'u_1' },
        { _id: 'pk_2', userId: 'u_1' },
      ],
      isDone: true,
    });

    const result = await listByOrganizationHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    // Exactly three adapter queries — members, users, passkeys. The passkey
    // count must never become a per-member N+1.
    expect(ctx.runQuery).toHaveBeenCalledTimes(3);
    expect(result.map((m) => m.passkeyCount)).toEqual([2, 0]);
  });
});

describe('listOrgTeamsHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when not authenticated', async () => {
    mockedGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();

    const result = await listOrgTeamsHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual([]);
  });

  it('returns all org teams for admin role', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetOrgMember.mockResolvedValue({
      _id: 'om_1',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'admin',
      createdAt: 1000,
    });
    const ctx = createMockCtx();

    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'team_1',
          name: 'Alpha',
          organizationId: 'org_1',
          createdAt: 1000,
        },
        {
          _id: 'team_2',
          name: 'Beta',
          organizationId: 'org_1',
          createdAt: 2000,
        },
        { _id: 'team_3', name: 'Gamma', organizationId: 'org_1' },
      ],
    });

    // member count queries
    ctx.runQuery
      .mockResolvedValueOnce({ page: [{ _id: 'tm_1' }, { _id: 'tm_2' }] })
      .mockResolvedValueOnce({ page: [{ _id: 'tm_3' }] })
      .mockResolvedValueOnce({ page: [] });

    const result = await listOrgTeamsHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual([
      { id: 'team_1', name: 'Alpha', memberCount: 2, createdAt: 1000 },
      { id: 'team_2', name: 'Beta', memberCount: 1, createdAt: 2000 },
      { id: 'team_3', name: 'Gamma', memberCount: 0, createdAt: null },
    ]);
  });

  it('returns all org teams for owner role', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetOrgMember.mockResolvedValue({
      _id: 'om_1',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'owner',
      createdAt: 1000,
    });
    const ctx = createMockCtx();

    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'team_1',
          name: 'Alpha',
          organizationId: 'org_1',
          createdAt: 5000,
        },
      ],
    });

    // member count query
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'tm_1' }, { _id: 'tm_2' }, { _id: 'tm_3' }],
    });

    const result = await listOrgTeamsHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual([
      { id: 'team_1', name: 'Alpha', memberCount: 3, createdAt: 5000 },
    ]);
  });

  it('falls back to getMyTeamsHandler for non-admin roles', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetOrgMember.mockResolvedValue({
      _id: 'om_1',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'member',
      createdAt: 1000,
    });
    const ctx = createMockCtx();

    // getMyTeamsHandler: first call fetches teamMember records
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'tm_1', teamId: 'team_1', userId: 'user_1' }],
    });
    // getMyTeamsHandler: second call fetches team details
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'team_1', name: 'Alpha', organizationId: 'org_1' }],
    });
    // member count query
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'tm_1' }],
    });

    const result = await listOrgTeamsHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual([
      { id: 'team_1', name: 'Alpha', memberCount: 1, createdAt: null },
    ]);
  });

  it('returns empty array when unauthorized', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetOrgMember.mockRejectedValue(new UnauthorizedError());
    const ctx = createMockCtx();

    const result = await listOrgTeamsHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual([]);
  });

  it('re-throws non-authorization errors', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetOrgMember.mockRejectedValue(new Error('DB failure'));
    const ctx = createMockCtx();

    await expect(
      listOrgTeamsHandler(ctx as unknown as QueryCtx, {
        organizationId: 'org_1',
      }),
    ).rejects.toThrow('DB failure');
  });

  it('returns empty array when no teams exist for admin', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetOrgMember.mockResolvedValue({
      _id: 'om_1',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'admin',
      createdAt: 1000,
    });
    const ctx = createMockCtx();

    ctx.runQuery.mockResolvedValueOnce({ page: [] });

    const result = await listOrgTeamsHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual([]);
  });
});
