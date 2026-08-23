import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth:adapter:findMany',
        findOne: 'betterAuth:adapter:findOne',
      },
    },
  },
}));

vi.mock('../auth/require_authenticated_user', () => ({
  requireAuthenticatedUser: vi.fn(),
}));

// Real errors module (not mocked): the structured `data` payload and the
// `instanceof UnauthorizedError` identity are part of the contract under test.
const { UnauthorizedError } = await import('../errors');
const { getOrganizationMember } = await import('./get_organization_member');

// A syntactically valid Better Auth organization id (32-char base-32), so the
// failure-path organization-existence check actually reaches the adapter.
const ORG_ID = 'jh7csd7ks8740bza6qsxbz6sph7yegh2';

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

/** Reject and return the thrown error for payload assertions. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected promise to reject');
}

describe('getOrganizationMember', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns member when role is not disabled', async () => {
    const ctx = createMockCtx();
    const member = {
      _id: 'om_1',
      organizationId: ORG_ID,
      userId: 'user_1',
      role: 'admin',
      createdAt: 1000,
    };
    ctx.runQuery.mockResolvedValueOnce({ page: [member] });

    const result = await getOrganizationMember(ctx as never, ORG_ID, authUser);

    expect(result).toEqual(member);
  });

  it('reads the local mirror without any cross-component query', async () => {
    const ctx = createMockCtx({
      memberId: 'om_1',
      organizationId: ORG_ID,
      userId: 'user_1',
      role: 'admin',
      createdAt: 1000,
    });

    const result = await getOrganizationMember(ctx as never, ORG_ID, authUser);

    // Reconstructed OrganizationMember._id is the Better Auth member id.
    expect(result).toEqual({
      _id: 'om_1',
      organizationId: ORG_ID,
      userId: 'user_1',
      role: 'admin',
      createdAt: 1000,
    });
    // The whole point: no Better Auth round-trip on the hot path.
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it('rejects an empty organization id at the boundary with ORG_NOT_FOUND', async () => {
    const ctx = createMockCtx();

    const error = await rejection(
      getOrganizationMember(ctx as never, '', authUser),
    );

    expect(error).toBeInstanceOf(UnauthorizedError);
    // Structured wire payload: clients dispatch stale-org recovery on this.
    expect(error).toMatchObject({
      code: 'ORG_NOT_FOUND',
      data: { code: 'ORG_NOT_FOUND', message: 'Organization id is required.' },
      message: 'Organization id is required.',
    });
    // Terminal before any lookup — no mirror read, no adapter round-trip.
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it('serializes as a ConvexError (structured data reaches the client)', async () => {
    const ctx = createMockCtx();

    const error = await rejection(
      getOrganizationMember(ctx as never, '', authUser),
    );

    // Convex's runtime detects application errors via this symbol field, not
    // instanceof — the guarantee that `data` (not a redacted "Server Error")
    // goes over the wire.
    expect(
      typeof error === 'object' &&
        error !== null &&
        Symbol.for('ConvexError') in error,
    ).toBe(true);
  });

  it('throws ORG_FORBIDDEN when the org exists but the user is not a member', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockImplementation(async (ref: string) => {
      if (ref === 'betterAuth:adapter:findOne') return { _id: ORG_ID };
      return { page: [] };
    });

    const error = await rejection(
      getOrganizationMember(ctx as never, ORG_ID, { userId: 'user_1' }),
    );

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error).toMatchObject({
      code: 'ORG_FORBIDDEN',
      message: `Not a member of organization ${ORG_ID}`,
    });
  });

  it('throws ORG_NOT_FOUND when the organization row no longer exists', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockImplementation(async (ref: string) => {
      if (ref === 'betterAuth:adapter:findOne') return null;
      return { page: [] };
    });

    const error = await rejection(
      getOrganizationMember(ctx as never, ORG_ID, { userId: 'user_1' }),
    );

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error).toMatchObject({
      code: 'ORG_NOT_FOUND',
      message: `Organization "${ORG_ID}" not found.`,
    });
  });

  it('classifies a non-id-shaped organization id as ORG_NOT_FOUND without an adapter lookup', async () => {
    const ctx = createMockCtx();
    // Member lookup misses; the existence check must NOT reach the adapter
    // (db.get on a non-id string throws an opaque decode error there).
    ctx.runQuery.mockResolvedValue({ page: [] });

    const error = await rejection(
      getOrganizationMember(ctx as never, 'org_1', { userId: 'user_1' }),
    );

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error).toMatchObject({ code: 'ORG_NOT_FOUND' });
    const findOneCalls = ctx.runQuery.mock.calls.filter(
      ([ref]) => ref === 'betterAuth:adapter:findOne',
    );
    expect(findOneCalls).toHaveLength(0);
  });

  it('throws ORG_FORBIDDEN for a disabled member found in the mirror', async () => {
    const ctx = createMockCtx({
      memberId: 'om_1',
      organizationId: ORG_ID,
      userId: 'user_1',
      role: 'disabled',
      createdAt: 1000,
    });

    const error = await rejection(
      getOrganizationMember(ctx as never, ORG_ID, authUser),
    );

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error).toMatchObject({ code: 'ORG_FORBIDDEN' });
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it('throws ORG_FORBIDDEN when member role is disabled', async () => {
    const ctx = createMockCtx();
    const member = {
      _id: 'om_1',
      organizationId: ORG_ID,
      userId: 'user_1',
      role: 'disabled',
      createdAt: 1000,
    };
    ctx.runQuery.mockResolvedValueOnce({ page: [member] });

    const error = await rejection(
      getOrganizationMember(ctx as never, ORG_ID, authUser),
    );

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error).toMatchObject({ code: 'ORG_FORBIDDEN' });
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
          organizationId: ORG_ID,
          userId: 'user_2',
          role: 'disabled',
          createdAt: 1000,
        },
      ],
    });

    await expect(
      getOrganizationMember(ctx as never, ORG_ID, authUser),
    ).rejects.toThrow(UnauthorizedError);
  });
});
