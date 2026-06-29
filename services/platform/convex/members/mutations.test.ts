import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth:adapter:findMany',
        findOne: 'betterAuth:adapter:findOne',
        create: 'betterAuth:adapter:create',
        deleteOne: 'betterAuth:adapter:deleteOne',
        updateMany: 'betterAuth:adapter:updateMany',
      },
    },
  },
}));

const mockGetAuthUser = vi.fn();
vi.mock('../auth', () => ({
  authComponent: {
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
}));

vi.mock('../audit_logs/helpers', () => ({
  logSuccess: vi.fn(),
}));

vi.mock('convex/values', () => {
  const stub = () => 'validator';
  class ConvexError extends Error {
    data: unknown;
    constructor(data: unknown) {
      super(typeof data === 'string' ? data : JSON.stringify(data));
      this.name = 'ConvexError';
      this.data = data;
    }
  }
  return {
    ConvexError,
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
    mutation: (config: Record<string, unknown>) => config,
  };
});

function createMockCtx() {
  return {
    runQuery: vi.fn(),
    runMutation: vi.fn(),
    // Stub the minimum surface the personalization cascade hook touches
    // when a member is removed: legacy paths use `.collect()`; the new
    // GDPR Art 17 TTS sweep uses `.take(PAGE_SIZE)` per page until the
    // returned slice is shorter than the page size (signals end-of-pages).
    db: {
      query: vi.fn().mockReturnValue({
        withIndex: vi.fn().mockReturnValue({
          collect: async () => [],
          take: async () => [],
          // The inline member-mirror sync looks up the existing row by memberId
          // before writing; an empty cache means it inserts (no-op here).
          first: async () => null,
        }),
      }),
      insert: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
    storage: {
      delete: vi.fn(),
    },
    // The handler now resolves the caller via the JWT identity
    // (getAuthUserIdentity → ctx.auth.getUserIdentity) instead of the
    // cross-component authComponent.getAuthUser. Derive the identity from the
    // same `mockGetAuthUser` source so existing per-test setup still drives it.
    auth: {
      getUserIdentity: vi.fn(async () => {
        const u = (await mockGetAuthUser()) as {
          _id: string;
          email?: string;
          name?: string;
        } | null;
        return u ? { subject: u._id, email: u.email, name: u.name } : null;
      }),
    },
  };
}

const AUTH_USER = {
  _id: 'user_caller',
  email: 'admin@example.com',
  name: 'Admin',
};

// ---------------------------------------------------------------------------
// removeMember
// ---------------------------------------------------------------------------

describe('removeMember handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getHandler() {
    const { removeMember } = await import('./mutations');
    return (removeMember as unknown as { handler: Function }).handler;
  }

  it('throws when unauthenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(handler(ctx, { memberId: 'm_1' })).rejects.toThrow(
      'UNAUTHENTICATED',
    );
  });

  it('throws when member not found', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({ page: [] });
    const handler = await getHandler();

    await expect(handler(ctx, { memberId: 'm_1' })).rejects.toThrow(
      'MEMBER_NOT_FOUND',
    );
  });

  it('throws when caller is not admin', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member lookup
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_target',
          organizationId: 'org_1',
          userId: 'user_target',
          role: 'member',
        },
      ],
    });
    // caller member lookup — non-admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'member' }],
    });
    const handler = await getHandler();

    await expect(handler(ctx, { memberId: 'm_target' })).rejects.toThrow(
      'MEMBER_REMOVE_FORBIDDEN',
    );
  });

  it('throws when trying to remove the owner', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member is the owner
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_owner',
          organizationId: 'org_1',
          userId: 'user_owner',
          role: 'owner',
        },
      ],
    });
    // caller is admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'admin' }],
    });
    const handler = await getHandler();

    await expect(handler(ctx, { memberId: 'm_owner' })).rejects.toThrow(
      'MEMBER_OWNER_REMOVAL_FORBIDDEN',
    );
  });

  it('allows owner to remove a non-owner member', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_target',
          organizationId: 'org_1',
          userId: 'user_target',
          role: 'member',
        },
      ],
    });
    // caller is owner
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'owner' }],
    });
    // user lookup for target
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'user_target', email: 'target@example.com' }],
    });
    // deleteOne
    ctx.runMutation.mockResolvedValueOnce(undefined);
    const handler = await getHandler();

    const result = await handler(ctx, { memberId: 'm_target' });

    expect(result).toBeNull();
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'betterAuth:adapter:deleteOne',
      expect.objectContaining({
        input: {
          model: 'member',
          where: [{ field: '_id', value: 'm_target', operator: 'eq' }],
        },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// updateMemberRole
// ---------------------------------------------------------------------------

describe('updateMemberRole handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getHandler() {
    const { updateMemberRole } = await import('./mutations');
    return (updateMemberRole as unknown as { handler: Function }).handler;
  }

  it('throws when unauthenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(
      handler(ctx, { memberId: 'm_1', role: 'editor' }),
    ).rejects.toThrow('UNAUTHENTICATED');
  });

  it('throws when member not found', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member lookup — empty
    ctx.runQuery.mockResolvedValueOnce({ page: [] });
    const handler = await getHandler();

    await expect(
      handler(ctx, { memberId: 'm_1', role: 'editor' }),
    ).rejects.toThrow('MEMBER_NOT_FOUND');
  });

  it('throws when caller is not admin', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_target',
          organizationId: 'org_1',
          userId: 'user_target',
          role: 'member',
        },
      ],
    });
    // caller — non-admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'editor' }],
    });
    const handler = await getHandler();

    await expect(
      handler(ctx, { memberId: 'm_target', role: 'admin' }),
    ).rejects.toThrow('MEMBER_ROLE_UPDATE_FORBIDDEN');
  });

  it('throws when trying to change the owner role', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member is owner
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_owner',
          organizationId: 'org_1',
          userId: 'user_owner',
          role: 'owner',
        },
      ],
    });
    // caller is admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'admin' }],
    });
    const handler = await getHandler();

    await expect(
      handler(ctx, { memberId: 'm_owner', role: 'member' }),
    ).rejects.toThrow('MEMBER_OWNER_ROLE_IMMUTABLE');
  });

  it('throws when trying to assign owner role manually', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member is a regular member
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_target',
          organizationId: 'org_1',
          userId: 'user_target',
          role: 'member',
        },
      ],
    });
    // caller is admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'admin' }],
    });
    const handler = await getHandler();

    await expect(
      handler(ctx, { memberId: 'm_target', role: 'owner' }),
    ).rejects.toThrow('MEMBER_OWNER_ROLE_ASSIGN_FORBIDDEN');
  });

  it('throws when target is the organization creator', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member is admin (not owner, but is the creator)
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_creator',
          organizationId: 'org_1',
          userId: 'user_creator',
          role: 'admin',
        },
      ],
    });
    // caller is admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'admin' }],
    });
    // org lookup — metadata contains creatorId matching target
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'org_1',
          metadata: JSON.stringify({ creatorId: 'user_creator' }),
        },
      ],
    });
    const handler = await getHandler();

    await expect(
      handler(ctx, { memberId: 'm_creator', role: 'member' }),
    ).rejects.toThrow('MEMBER_CREATOR_ROLE_IMMUTABLE');
  });

  it('throws when demoting the last admin', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member is admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_target',
          organizationId: 'org_1',
          userId: 'user_target',
          role: 'admin',
        },
      ],
    });
    // caller is the same admin (self-demotion scenario)
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_target', role: 'admin' }],
    });
    // org lookup — no matching creatorId
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'org_1',
          metadata: JSON.stringify({ creatorId: 'user_other' }),
        },
      ],
    });
    // user lookup for target
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'user_target', email: 'target@example.com' }],
    });
    // findMany for all org members — only 1 admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        { _id: 'm_target', role: 'admin' },
        { _id: 'm_other', role: 'member' },
      ],
    });
    const handler = await getHandler();

    await expect(
      handler(ctx, { memberId: 'm_target', role: 'member' }),
    ).rejects.toThrow('MEMBER_LAST_ADMIN');
  });

  it('allows demoting admin when owner exists', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member is admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_target',
          organizationId: 'org_1',
          userId: 'user_target',
          role: 'admin',
        },
      ],
    });
    // caller is owner
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'owner' }],
    });
    // org lookup — no matching creatorId
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'org_1',
          metadata: JSON.stringify({ creatorId: 'user_other' }),
        },
      ],
    });
    // user lookup for target
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'user_target', email: 'target@example.com' }],
    });
    // findMany for all org members — owner + admin = 2 admin-level
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        { _id: 'm_caller', role: 'owner' },
        { _id: 'm_target', role: 'admin' },
        { _id: 'm_other', role: 'member' },
      ],
    });
    // updateMany
    ctx.runMutation.mockResolvedValueOnce(undefined);
    const handler = await getHandler();

    const result = await handler(ctx, {
      memberId: 'm_target',
      role: 'member',
    });

    expect(result).toBeNull();
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'betterAuth:adapter:updateMany',
      expect.objectContaining({
        input: expect.objectContaining({
          model: 'member',
          update: { role: 'member' },
        }),
      }),
    );
  });

  it('allows non-admin role change without last-admin check', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member is editor (not admin)
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_target',
          organizationId: 'org_1',
          userId: 'user_target',
          role: 'editor',
        },
      ],
    });
    // caller is admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'admin' }],
    });
    // org lookup — no matching creatorId
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'org_1',
          metadata: JSON.stringify({ creatorId: 'user_other' }),
        },
      ],
    });
    // user lookup for target
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'user_target', email: 'target@example.com' }],
    });
    // updateMany — no last-admin query needed
    ctx.runMutation.mockResolvedValueOnce(undefined);
    const handler = await getHandler();

    const result = await handler(ctx, {
      memberId: 'm_target',
      role: 'developer',
    });

    expect(result).toBeNull();
    // Should only have 4 runQuery calls (member, caller, org, user) — no admin count query
    expect(ctx.runQuery).toHaveBeenCalledTimes(4);
  });
});

// ---------------------------------------------------------------------------
// addMember
// ---------------------------------------------------------------------------

describe('addMember handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getHandler() {
    const { addMember } = await import('./mutations');
    return (addMember as unknown as { handler: Function }).handler;
  }

  const defaultArgs = {
    organizationId: 'org_1',
    userId: 'user_target',
  };

  it('throws when unauthenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow('Unauthenticated');
  });

  it('throws when caller is not admin', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'member' }],
    });
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow(
      'Only admins can add members',
    );
  });

  it('rejects assigning the owner role', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // caller is admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'admin' }],
    });
    const handler = await getHandler();

    await expect(
      handler(ctx, { ...defaultArgs, role: 'owner' }),
    ).rejects.toThrow('The owner role cannot be assigned manually');
  });

  it('rejects adding a user who is already a member', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // caller is admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'admin' }],
    });
    // target user lookup
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'user_target', email: 'target@example.com' }],
    });
    // existing-membership lookup returns a row
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_existing', role: 'member' }],
    });
    const handler = await getHandler();

    await expect(handler(ctx, defaultArgs)).rejects.toThrow(
      'User is already a member of this organization',
    );
  });

  it('allows owner to add members', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // caller is owner
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'owner' }],
    });
    // target user lookup
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'user_target', email: 'target@example.com' }],
    });
    // existing-membership lookup — none, so the add proceeds
    ctx.runQuery.mockResolvedValueOnce({ page: [] });
    // create
    ctx.runMutation.mockResolvedValueOnce({ _id: 'm_new' });
    const handler = await getHandler();

    const result = await handler(ctx, defaultArgs);

    expect(result).toBe('m_new');
  });
});

// ---------------------------------------------------------------------------
// transferOwnership
// ---------------------------------------------------------------------------

describe('updateMemberDisplayName handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getHandler() {
    const { updateMemberDisplayName } = await import('./mutations');
    return (updateMemberDisplayName as unknown as { handler: Function })
      .handler;
  }

  it('throws when unauthenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(
      handler(ctx, { memberId: 'm_1', displayName: 'New Name' }),
    ).rejects.toThrow('UNAUTHENTICATED');
  });

  it('throws when member not found', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member lookup — empty
    ctx.runQuery.mockResolvedValueOnce({ page: [] });
    const handler = await getHandler();

    await expect(
      handler(ctx, { memberId: 'm_1', displayName: 'New Name' }),
    ).rejects.toThrow('MEMBER_NOT_FOUND');
  });

  it('throws when a non-admin edits another members name', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member is someone else
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_target',
          organizationId: 'org_1',
          userId: 'user_target',
          role: 'member',
        },
      ],
    });
    // target user lookup
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'user_target', name: 'Old Name' }],
    });
    // caller member lookup — non-admin
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'member' }],
    });
    const handler = await getHandler();

    await expect(
      handler(ctx, { memberId: 'm_target', displayName: 'New Name' }),
    ).rejects.toThrow('MEMBER_NAME_UPDATE_FORBIDDEN');
  });

  it('allows a member to update their own name without an admin check', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member is the caller themselves
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_self',
          organizationId: 'org_1',
          userId: 'user_caller',
          role: 'member',
        },
      ],
    });
    // target user lookup (own profile)
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'user_caller', name: 'Old Name' }],
    });
    // updateMany for the name change
    ctx.runMutation.mockResolvedValueOnce(undefined);
    const handler = await getHandler();

    const result = await handler(ctx, {
      memberId: 'm_self',
      displayName: 'New Name',
    });

    expect(result).toBeNull();
    // Own-profile edit skips the caller-admin lookup: only member + user
    // queries run (no third caller-member query).
    expect(ctx.runQuery).toHaveBeenCalledTimes(2);
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'betterAuth:adapter:updateMany',
      expect.objectContaining({
        input: expect.objectContaining({
          model: 'user',
          where: [{ field: '_id', value: 'user_caller', operator: 'eq' }],
          update: { name: 'New Name' },
        }),
      }),
    );
  });
});

describe('transferOwnership handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getHandler() {
    const { transferOwnership } = await import('./mutations');
    return (transferOwnership as unknown as { handler: Function }).handler;
  }

  it('throws when unauthenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(handler(ctx, { targetMemberId: 'm_target' })).rejects.toThrow(
      'UNAUTHENTICATED',
    );
  });

  it('throws when target member not found', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({ page: [] });
    const handler = await getHandler();

    await expect(handler(ctx, { targetMemberId: 'm_target' })).rejects.toThrow(
      'MEMBER_NOT_FOUND',
    );
  });

  it('throws when caller is not the owner', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_target',
          organizationId: 'org_1',
          userId: 'user_target',
          role: 'admin',
        },
      ],
    });
    // caller is admin, not owner
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'admin' }],
    });
    const handler = await getHandler();

    await expect(handler(ctx, { targetMemberId: 'm_target' })).rejects.toThrow(
      'OWNERSHIP_TRANSFER_FORBIDDEN',
    );
  });

  it('throws when target is already the owner', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member is already owner
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_target',
          organizationId: 'org_1',
          userId: 'user_target',
          role: 'owner',
        },
      ],
    });
    // caller is owner
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'owner' }],
    });
    const handler = await getHandler();

    await expect(handler(ctx, { targetMemberId: 'm_target' })).rejects.toThrow(
      'MEMBER_ALREADY_OWNER',
    );
  });

  it('transfers ownership: promotes target and demotes caller', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // target member
    ctx.runQuery.mockResolvedValueOnce({
      page: [
        {
          _id: 'm_target',
          organizationId: 'org_1',
          userId: 'user_target',
          role: 'admin',
        },
      ],
    });
    // caller is owner
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'owner' }],
    });
    // updateMany for promote
    ctx.runMutation.mockResolvedValueOnce(undefined);
    // updateMany for demote
    ctx.runMutation.mockResolvedValueOnce(undefined);
    // user lookup for audit
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'user_target', email: 'target@example.com' }],
    });
    const handler = await getHandler();

    const result = await handler(ctx, { targetMemberId: 'm_target' });

    expect(result).toBeNull();
    // First mutation: promote target to owner
    expect(ctx.runMutation).toHaveBeenNthCalledWith(
      1,
      'betterAuth:adapter:updateMany',
      expect.objectContaining({
        input: expect.objectContaining({
          model: 'member',
          where: [{ field: '_id', value: 'm_target', operator: 'eq' }],
          update: { role: 'owner' },
        }),
      }),
    );
    // Second mutation: demote caller to admin
    expect(ctx.runMutation).toHaveBeenNthCalledWith(
      2,
      'betterAuth:adapter:updateMany',
      expect.objectContaining({
        input: expect.objectContaining({
          model: 'member',
          where: [{ field: '_id', value: 'm_caller', operator: 'eq' }],
          update: { role: 'admin' },
        }),
      }),
    );
  });
});
