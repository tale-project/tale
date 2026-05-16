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

vi.mock('../auth/get_trusted_auth_data', () => ({
  getTrustedAuthData: vi.fn().mockResolvedValue(null),
}));

const { getUserOrganizations } = await import('./get_user_organizations');

function createMockCtx() {
  return {
    runQuery: vi.fn(),
    db: {},
    auth: {},
  };
}

const authUser = { userId: 'user_1', email: 'test@example.com' };

describe('getUserOrganizations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns non-disabled memberships', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        { organizationId: 'org_1', role: 'admin' },
        { organizationId: 'org_2', role: 'member' },
      ],
    });

    const result = await getUserOrganizations(ctx as never, authUser);

    expect(result).toHaveLength(2);
    expect(result[0].organizationId).toBe('org_1');
    expect(result[1].organizationId).toBe('org_2');
  });

  it('filters out disabled memberships', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        { organizationId: 'org_1', role: 'admin' },
        { organizationId: 'org_2', role: 'disabled' },
        { organizationId: 'org_3', role: 'member' },
      ],
    });

    const result = await getUserOrganizations(ctx as never, authUser);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.organizationId)).toEqual(['org_1', 'org_3']);
  });

  it('returns empty array when all memberships are disabled', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ organizationId: 'org_1', role: 'disabled' }],
    });

    const result = await getUserOrganizations(ctx as never, authUser);

    expect(result).toEqual([]);
  });

  it('returns empty array when no memberships exist', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({ page: [] });

    const result = await getUserOrganizations(ctx as never, authUser);

    expect(result).toEqual([]);
  });
});
