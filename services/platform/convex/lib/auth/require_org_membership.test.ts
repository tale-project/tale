import { ConvexError } from 'convex/values';
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

const { requireOrgMembershipById } = await import('./require_org_membership');

function makeCtx(handlers: {
  findOne?: unknown;
  findMany?: { page?: unknown[] };
}) {
  return {
    runQuery: vi.fn(async (ref: string) => {
      if (ref === 'findOne') return handlers.findOne ?? null;
      if (ref === 'findMany') return handlers.findMany ?? { page: [] };
      throw new Error(`Unexpected runQuery ref: ${ref}`);
    }),
  };
}

const happyAuthUser = {
  _id: 'user_1',
  email: 'u@example.com',
  name: 'User One',
};

describe('requireOrgMembershipById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockResolvedValue(happyAuthUser);
  });

  it('returns the resolved membership on the happy path', async () => {
    const ctx = makeCtx({
      findOne: { _id: 'org_a', slug: 'acme' },
      findMany: { page: [{ _id: 'mem_1', role: 'admin' }] },
    });
    await expect(
      requireOrgMembershipById(ctx as never, 'org_a'),
    ).resolves.toEqual({
      orgId: 'org_a',
      orgSlug: 'acme',
      userId: 'user_1',
      email: 'u@example.com',
      name: 'User One',
      member: { _id: 'mem_1', role: 'admin' },
    });
  });

  it('throws UNAUTHENTICATED when getAuthUser returns null', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const ctx = makeCtx({});
    await expect(
      requireOrgMembershipById(ctx as never, 'org_a'),
    ).rejects.toMatchObject({
      data: { code: 'UNAUTHENTICATED' },
    });
  });

  it('throws ORG_NOT_FOUND when the organization does not exist', async () => {
    const ctx = makeCtx({ findOne: null });
    await expect(
      requireOrgMembershipById(ctx as never, 'org_missing'),
    ).rejects.toMatchObject({
      data: { code: 'ORG_NOT_FOUND' },
    });
  });

  it('throws ORG_NOT_FOUND when the org row is missing a slug', async () => {
    const ctx = makeCtx({ findOne: { _id: 'org_a' } });
    await expect(
      requireOrgMembershipById(ctx as never, 'org_a'),
    ).rejects.toMatchObject({
      data: { code: 'ORG_NOT_FOUND' },
    });
  });

  it('throws ORG_FORBIDDEN when the caller is not a member', async () => {
    const ctx = makeCtx({
      findOne: { _id: 'org_a', slug: 'acme' },
      findMany: { page: [] },
    });
    await expect(
      requireOrgMembershipById(ctx as never, 'org_a'),
    ).rejects.toMatchObject({
      data: { code: 'ORG_FORBIDDEN' },
    });
  });

  it('throws ORG_FORBIDDEN when the member is disabled', async () => {
    const ctx = makeCtx({
      findOne: { _id: 'org_a', slug: 'acme' },
      findMany: { page: [{ _id: 'mem_1', role: 'disabled' }] },
    });
    await expect(
      requireOrgMembershipById(ctx as never, 'org_a'),
    ).rejects.toMatchObject({
      data: { code: 'ORG_FORBIDDEN' },
    });
  });

  it('uses ConvexError so codes are dispatchable on the wire', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const ctx = makeCtx({});
    await expect(
      requireOrgMembershipById(ctx as never, 'org_a'),
    ).rejects.toBeInstanceOf(ConvexError);
  });
});
