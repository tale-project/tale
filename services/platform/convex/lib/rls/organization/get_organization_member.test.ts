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

import { UnauthorizedError } from '../errors';
import { getOrganizationMember } from './get_organization_member';

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

// An org id that passes `looksLikeConvexDocumentId` (the convex-test synthetic
// shape), so the failure path's existence re-check actually runs — `org_1`
// style sentinels are rejected by the shape guard before any component read.
const ID_SHAPED_ORG = '101;organization';

/** Resolve to the thrown `UnauthorizedError`'s code, or undefined. */
async function rejectionCode(p: Promise<unknown>): Promise<string | undefined> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  return err instanceof UnauthorizedError ? err.code : undefined;
}

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

  it('reports ORG_FORBIDDEN for a disabled member found in the mirror', async () => {
    const ctx = createMockCtx({
      memberId: 'om_1',
      organizationId: ID_SHAPED_ORG,
      userId: 'user_1',
      role: 'disabled',
      createdAt: 1000,
    });

    await expect(
      rejectionCode(
        getOrganizationMember(ctx as never, ID_SHAPED_ORG, authUser),
      ),
    ).resolves.toBe('ORG_FORBIDDEN');
    // The member row exists, so no existence re-check either.
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it('reports ORG_FORBIDDEN when member role is disabled', async () => {
    const ctx = createMockCtx();
    const member = {
      _id: 'om_1',
      organizationId: ID_SHAPED_ORG,
      userId: 'user_1',
      role: 'disabled',
      createdAt: 1000,
    };
    ctx.runQuery.mockResolvedValueOnce({ page: [member] });

    await expect(
      rejectionCode(
        getOrganizationMember(ctx as never, ID_SHAPED_ORG, authUser),
      ),
    ).resolves.toBe('ORG_FORBIDDEN');
  });

  it('reports ORG_FORBIDDEN when the org exists and the caller is not in it', async () => {
    const ctx = createMockCtx();
    // (1) member lookup: empty; (2) existence re-check: the org row is there.
    // No email on the auth user, so the email fallback stays out of the way.
    ctx.runQuery.mockResolvedValueOnce({ page: [] });
    ctx.runQuery.mockResolvedValueOnce({ _id: ID_SHAPED_ORG, slug: 'acme' });

    const err = await getOrganizationMember(ctx as never, ID_SHAPED_ORG, {
      userId: 'user_1',
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(UnauthorizedError);
    if (!(err instanceof UnauthorizedError)) return;
    expect(err.code).toBe('ORG_FORBIDDEN');
    expect(err.message).toBe(`Not a member of organization ${ID_SHAPED_ORG}`);
    // The wire contract: a ConvexError whose data carries the code, so
    // clients read `{ code, message }` instead of a redacted "Server Error".
    expect(err.data).toEqual({
      code: 'ORG_FORBIDDEN',
      message: `Not a member of organization ${ID_SHAPED_ORG}`,
    });
  });

  it('reports ORG_NOT_FOUND when the organization row is gone', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({ page: [] });
    ctx.runQuery.mockResolvedValueOnce(null);

    const err = await getOrganizationMember(ctx as never, ID_SHAPED_ORG, {
      userId: 'user_1',
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(UnauthorizedError);
    if (!(err instanceof UnauthorizedError)) return;
    expect(err.code).toBe('ORG_NOT_FOUND');
    expect(err.message).toBe(`Organization ${ID_SHAPED_ORG} not found`);
    expect(ctx.runQuery).toHaveBeenCalledTimes(2);
    expect(ctx.runQuery).toHaveBeenLastCalledWith(
      'betterAuth:adapter:findOne',
      {
        model: 'organization',
        where: [{ field: '_id', value: ID_SHAPED_ORG, operator: 'eq' }],
      },
    );
  });

  it('reports ORG_NOT_FOUND without a component read for a non-id-shaped org id', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({ page: [] });

    await expect(
      rejectionCode(
        getOrganizationMember(ctx as never, 'org_1', { userId: 'user_1' }),
      ),
    ).resolves.toBe('ORG_NOT_FOUND');
    // Only the member lookup ran — `org_1` cannot be a document id, so the
    // existence re-check must not reach the betterAuth component (db.get
    // would throw on it inside the component).
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
  });

  it('falls back to ORG_NOT_FOUND when the existence re-check itself fails', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({ page: [] });
    ctx.runQuery.mockRejectedValueOnce(new Error('adapter unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      rejectionCode(
        getOrganizationMember(ctx as never, ID_SHAPED_ORG, {
          userId: 'user_1',
        }),
      ),
    ).resolves.toBe('ORG_NOT_FOUND');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reports ORG_FORBIDDEN for disabled member found via email fallback', async () => {
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
      rejectionCode(getOrganizationMember(ctx as never, 'org_1', authUser)),
    ).resolves.toBe('ORG_FORBIDDEN');
  });
});
