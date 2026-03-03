import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { QueryCtx } from '../../_generated/server';

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
  getUserOrganizations: vi.fn(),
}));

vi.mock('../../lib/rls/errors', () => ({
  UnauthenticatedError: class extends Error {
    constructor() {
      super('Unauthenticated');
    }
  },
  UnauthorizedError: class extends Error {
    constructor() {
      super('Unauthorized');
    }
  },
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
    query: (config: Record<string, unknown>) => config,
  };
});

const { getAuthUserIdentity, getOrganizationMember } =
  await import('../../lib/rls');
const {
  getMyTeamsHandler,
  approxCountMyTeamsHandler,
  listByOrganizationHandler,
} = await import('../queries');

const mockedGetAuthUser = vi.mocked(getAuthUserIdentity);
const mockedGetOrgMember = vi.mocked(getOrganizationMember);

function createMockCtx() {
  return {
    runQuery: vi.fn(),
    db: {},
    auth: {},
  };
}

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
      });

    const result = await getMyTeamsHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual([
      { id: 'team_1', name: 'Alpha' },
      { id: 'team_2', name: 'Beta' },
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
      });

    const result = await getMyTeamsHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual([
      { id: 'team_1', name: 'Alpha' },
      { id: 'team_3', name: 'Gamma' },
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

    ctx.runQuery.mockResolvedValueOnce({
      name: 'Alice',
      email: 'alice@example.com',
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
      },
    ]);
  });

  it('returns member without name/email when user lookup fails', async () => {
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

    ctx.runQuery
      .mockRejectedValueOnce(new Error('lookup failed'))
      .mockResolvedValueOnce({ name: 'Bob', email: 'bob@example.com' });

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
      },
      {
        _id: 'm_2',
        organizationId: 'org_1',
        userId: 'u_2',
        role: 'admin',
        createdAt: 2000,
        displayName: 'Bob',
        email: 'bob@example.com',
      },
    ]);
  });
});
