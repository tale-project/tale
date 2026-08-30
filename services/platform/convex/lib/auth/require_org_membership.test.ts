import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';

const mockGetAuthUser = vi.fn();

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
    auth: {
      getUserIdentity: vi.fn(async () => {
        const u = await mockGetAuthUser();
        return u ? { subject: u._id, email: u.email, name: u.name } : null;
      }),
    },
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

  it('throws ORG_ID_REQUIRED on an empty organization id (no adapter call)', async () => {
    const ctx = makeCtx({});
    // ORG_ID_REQUIRED, not ORG_NOT_FOUND: an empty id is a caller-side gap
    // (a component racing its data), and the client's dead-org recovery —
    // which keys on ORG_NOT_FOUND — must not fire for it.
    await expect(
      requireOrgMembershipById(ctx as never, ''),
    ).rejects.toMatchObject({
      data: { code: 'ORG_ID_REQUIRED' },
    });
    // The empty id must never reach the adapter (`db.get('')` would throw).
    expect(ctx.runQuery).not.toHaveBeenCalled();
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

  it('uses AppError so codes are dispatchable on the wire', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const ctx = makeCtx({});
    await expect(
      requireOrgMembershipById(ctx as never, 'org_a'),
    ).rejects.toBeInstanceOf(AppError);
  });
});
