import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAuthUser = vi.fn();
vi.mock('../../auth', () => ({
  authComponent: {
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
}));

vi.mock('../../_generated/api', () => ({
  components: {
    betterAuth: { adapter: { findOne: 'findOne', findMany: 'findMany' } },
  },
}));

const { requireOrgAdminOrDeveloper } =
  await import('./require_org_admin_or_developer');

function makeCtx(role: 'owner' | 'admin' | 'developer' | 'member') {
  return {
    runQuery: vi.fn(async (ref: string) => {
      if (ref === 'findOne') return { _id: 'org_a', slug: 'acme' };
      if (ref === 'findMany') return { page: [{ _id: 'mem_1', role }] };
      throw new Error(`Unexpected runQuery ref: ${ref}`);
    }),
  };
}

const happyAuthUser = {
  _id: 'user_1',
  email: 'u@example.com',
  name: 'User One',
};

describe('requireOrgAdminOrDeveloper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockResolvedValue(happyAuthUser);
  });

  it.each(['owner', 'admin', 'developer'] as const)(
    'resolves for role %s',
    async (role) => {
      const ctx = makeCtx(role);
      const auth = await requireOrgAdminOrDeveloper(ctx as never, 'org_a');
      expect(auth.member.role).toBe(role);
      expect(auth.orgSlug).toBe('acme');
    },
  );

  it('throws FORBIDDEN_DEVELOPER_SETTINGS for plain member', async () => {
    const ctx = makeCtx('member');
    await expect(
      requireOrgAdminOrDeveloper(ctx as never, 'org_a'),
    ).rejects.toMatchObject({
      data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' },
    });
  });

  it('lets the inner helper surface unauthenticated callers', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const ctx = makeCtx('admin');
    await expect(
      requireOrgAdminOrDeveloper(ctx as never, 'org_a'),
    ).rejects.toMatchObject({
      data: { code: 'UNAUTHENTICATED' },
    });
  });
});
