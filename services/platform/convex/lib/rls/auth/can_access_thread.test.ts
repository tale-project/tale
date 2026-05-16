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

const { canAccessThread, assertThreadAccess } =
  await import('./can_access_thread');

const authUser = { userId: 'user_1', email: 'larry@tale.dev' };

interface MockMetadata {
  _id: string;
  threadId: string;
  userId: string;
  organizationId?: string;
  isShared?: boolean;
  status?: string;
}

interface BetterAuthMember {
  _id: string;
  organizationId: string;
  userId: string;
  role: string;
}

function createMockCtx(opts: {
  metadata: MockMetadata | null;
  members?: BetterAuthMember[]; // Better Auth `member` rows the user belongs to (active)
}) {
  return {
    db: {
      query: vi.fn().mockReturnValue({
        withIndex: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(opts.metadata),
        }),
      }),
    },
    runQuery: vi
      .fn()
      .mockImplementation(
        (_ref, args: { where: { field: string; value: string }[] }) => {
          const orgIdFilter = args.where.find(
            (w) => w.field === 'organizationId',
          );
          const userIdFilter = args.where.find((w) => w.field === 'userId');
          const match = (opts.members ?? []).find(
            (m) =>
              m.organizationId === orgIdFilter?.value &&
              m.userId === userIdFilter?.value,
          );
          return Promise.resolve({ page: match ? [match] : [] });
        },
      ),
    auth: {},
  };
}

describe('canAccessThread — owner branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns metadata when owner is still a member of the thread org (no hint)', async () => {
    const meta: MockMetadata = {
      _id: 'tm_1',
      threadId: 't_1',
      userId: 'user_1',
      organizationId: 'org_1',
    };
    const ctx = createMockCtx({
      metadata: meta,
      members: [
        {
          _id: 'm_1',
          organizationId: 'org_1',
          userId: 'user_1',
          role: 'admin',
        },
      ],
    });

    const result = await canAccessThread(ctx as never, 't_1', authUser);

    expect(result).toEqual(meta);
    // No hint passed → membership lookup happens sequentially after metadata
    // read. Exactly one runQuery (Better Auth findMany).
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
  });

  it('returns metadata via fast path when matching hint is supplied', async () => {
    const meta: MockMetadata = {
      _id: 'tm_1',
      threadId: 't_1',
      userId: 'user_1',
      organizationId: 'org_1',
    };
    const ctx = createMockCtx({
      metadata: meta,
      members: [
        {
          _id: 'm_1',
          organizationId: 'org_1',
          userId: 'user_1',
          role: 'admin',
        },
      ],
    });

    const result = await canAccessThread(
      ctx as never,
      't_1',
      authUser,
      'org_1',
    );

    expect(result).toEqual(meta);
    // Fast path reuses the parallel-fired membership lookup → single call.
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
  });

  it('falls back to a second lookup when hint org mismatches actual org', async () => {
    const meta: MockMetadata = {
      _id: 'tm_1',
      threadId: 't_1',
      userId: 'user_1',
      organizationId: 'org_actual',
    };
    const ctx = createMockCtx({
      metadata: meta,
      members: [
        // User is member of both, but only org_actual matters
        {
          _id: 'm_hint',
          organizationId: 'org_hint',
          userId: 'user_1',
          role: 'member',
        },
        {
          _id: 'm_actual',
          organizationId: 'org_actual',
          userId: 'user_1',
          role: 'admin',
        },
      ],
    });

    const result = await canAccessThread(
      ctx as never,
      't_1',
      authUser,
      'org_hint',
    );

    expect(result).toEqual(meta);
    // First call (parallel hint), then fallback against actual orgId.
    expect(ctx.runQuery).toHaveBeenCalledTimes(2);
  });

  it('returns null when owner is no longer a member of the thread org (no hint)', async () => {
    const meta: MockMetadata = {
      _id: 'tm_1',
      threadId: 't_1',
      userId: 'user_1',
      organizationId: 'org_deleted',
    };
    const ctx = createMockCtx({ metadata: meta, members: [] });

    const result = await canAccessThread(ctx as never, 't_1', authUser);

    expect(result).toBeNull();
  });

  it('returns null on the fast path when the matching hint reveals non-membership', async () => {
    const meta: MockMetadata = {
      _id: 'tm_1',
      threadId: 't_1',
      userId: 'user_1',
      organizationId: 'org_deleted',
    };
    const ctx = createMockCtx({ metadata: meta, members: [] });

    const result = await canAccessThread(
      ctx as never,
      't_1',
      authUser,
      'org_deleted',
    );

    expect(result).toBeNull();
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
  });

  it('returns metadata for legacy threads without organizationId regardless of hint', async () => {
    const meta: MockMetadata = {
      _id: 'tm_legacy',
      threadId: 't_legacy',
      userId: 'user_1',
      // organizationId intentionally omitted — pre-org-scoping legacy row
    };
    const ctx = createMockCtx({ metadata: meta, members: [] });

    const result = await canAccessThread(
      ctx as never,
      't_legacy',
      authUser,
      'org_anything',
    );

    expect(result).toEqual(meta);
  });
});

describe('canAccessThread — shared branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns metadata for non-owner who is a member of the shared org (fast path)', async () => {
    const meta: MockMetadata = {
      _id: 'tm_shared',
      threadId: 't_shared',
      userId: 'user_owner',
      organizationId: 'org_shared',
      isShared: true,
    };
    const ctx = createMockCtx({
      metadata: meta,
      members: [
        {
          _id: 'm_1',
          organizationId: 'org_shared',
          userId: 'user_1',
          role: 'member',
        },
      ],
    });

    const result = await canAccessThread(
      ctx as never,
      't_shared',
      authUser,
      'org_shared',
    );

    expect(result).toEqual(meta);
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
  });

  it('returns null for non-owner who is not a member of the shared org', async () => {
    const meta: MockMetadata = {
      _id: 'tm_shared',
      threadId: 't_shared',
      userId: 'user_owner',
      organizationId: 'org_shared',
      isShared: true,
    };
    const ctx = createMockCtx({ metadata: meta, members: [] });

    const result = await canAccessThread(ctx as never, 't_shared', authUser);

    expect(result).toBeNull();
  });

  it('returns null for non-owner when thread is not shared', async () => {
    const meta: MockMetadata = {
      _id: 'tm_private',
      threadId: 't_private',
      userId: 'user_owner',
      organizationId: 'org_1',
    };
    const ctx = createMockCtx({
      metadata: meta,
      members: [
        {
          _id: 'm_1',
          organizationId: 'org_1',
          userId: 'user_1',
          role: 'member',
        },
      ],
    });

    const result = await canAccessThread(ctx as never, 't_private', authUser);

    expect(result).toBeNull();
  });
});

describe('canAccessThread — missing thread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when threadMetadata row does not exist', async () => {
    const ctx = createMockCtx({ metadata: null });

    const result = await canAccessThread(ctx as never, 't_missing', authUser);

    expect(result).toBeNull();
  });
});

describe('assertThreadAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns metadata when accessible', async () => {
    const meta: MockMetadata = {
      _id: 'tm_1',
      threadId: 't_1',
      userId: 'user_1',
      organizationId: 'org_1',
    };
    const ctx = createMockCtx({
      metadata: meta,
      members: [
        {
          _id: 'm_1',
          organizationId: 'org_1',
          userId: 'user_1',
          role: 'admin',
        },
      ],
    });

    const result = await assertThreadAccess(
      ctx as never,
      't_1',
      authUser,
      'org_1',
    );

    expect(result).toEqual(meta);
  });

  it('throws ConvexError(forbidden) when access is denied', async () => {
    const meta: MockMetadata = {
      _id: 'tm_1',
      threadId: 't_1',
      userId: 'user_1',
      organizationId: 'org_deleted',
    };
    const ctx = createMockCtx({ metadata: meta, members: [] });

    await expect(
      assertThreadAccess(ctx as never, 't_1', authUser),
    ).rejects.toMatchObject({ data: { code: 'forbidden' } });
  });
});
