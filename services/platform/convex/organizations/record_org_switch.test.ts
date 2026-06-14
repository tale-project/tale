import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        updateMany: 'betterAuth:adapter:updateMany',
      },
    },
  },
}));

const mockGetAuthUser = vi.fn();
const mockLogSuccess = vi.fn();
vi.mock('../audit_logs/helpers', () => ({
  logSuccess: (...args: unknown[]) => mockLogSuccess(...args),
}));

const mockGetOrganizationMember = vi.fn();
// The handler now resolves identity via getAuthUserIdentity (0-DB, reads the
// JWT subject through ctx.auth.getUserIdentity) instead of
// authComponent.getAuthUser. Mock the rls barrel: keep getOrganizationMember
// mocked, and provide a faithful getAuthUserIdentity that maps the JWT identity
// (sourced from the same mockGetAuthUser fixture via ctx.auth) into the
// { userId, email, name } shape the real helper returns.
// Sources import these directly (not via the lib/rls barrel), so mock the
// concrete modules.
vi.mock('../lib/rls/organization/get_organization_member', () => ({
  getOrganizationMember: (...args: unknown[]) =>
    mockGetOrganizationMember(...args),
}));
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: async (ctx: {
    auth: { getUserIdentity: () => Promise<unknown> };
  }) => {
    const identity = (await ctx.auth.getUserIdentity()) as {
      subject?: string;
      email?: string;
      name?: string;
    } | null;
    if (!identity || !identity.subject) return null;
    return {
      userId: identity.subject,
      email: identity.email ?? undefined,
      name: identity.name ?? undefined,
    };
  },
}));

vi.mock('convex/values', () => {
  const stub = () => 'validator';
  return {
    v: {
      string: stub,
      null: stub,
    },
  };
});

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutation: (config: Record<string, unknown>) => config,
  };
});

type AuditEntry = {
  actorId: string;
  action: string;
  organizationId: string;
  category: string;
  timestamp: number;
};

function createMockCtx(recentEntries: AuditEntry[] = []) {
  // The handler now scopes the dedup scan via the
  // `by_org_category_actorId_timestamp` index (eq actorId + gte timestamp) and
  // no longer filters actorId in JS. Simulate that here: capture the bounds the
  // handler builds in its index callback and only yield matching entries, the
  // way the real index would.
  let filterActorId: string | undefined;
  let cutoff = Number.NEGATIVE_INFINITY;

  const order = vi.fn().mockImplementation(() => ({
    [Symbol.asyncIterator]: async function* () {
      for (const entry of recentEntries) {
        if (filterActorId !== undefined && entry.actorId !== filterActorId) {
          continue;
        }
        if (entry.timestamp < cutoff) continue;
        yield entry;
      }
    },
  }));
  const withIndex = vi
    .fn()
    .mockImplementation((_name: string, fn?: (q: unknown) => unknown) => {
      if (typeof fn === 'function') {
        const q = {
          eq: (field: string, value: unknown) => {
            if (field === 'actorId') filterActorId = value as string;
            return q;
          },
          gte: (_field: string, value: number) => {
            cutoff = value;
            return q;
          },
        };
        fn(q);
      }
      return { order };
    });
  const query = vi.fn().mockReturnValue({ withIndex });

  return {
    db: { query },
    runMutation: vi.fn().mockResolvedValue(undefined),
    auth: {
      getUserIdentity: vi.fn(async () => {
        const u = await mockGetAuthUser();
        return u ? { subject: u._id, email: u.email, name: u.name } : null;
      }),
    },
    _builders: { query, withIndex, order },
  };
}

const AUTH_USER = {
  _id: 'user_1',
  email: 'user@example.com',
};

const MEMBER = { role: 'admin' };

describe('recordOrgSwitch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    mockGetOrganizationMember.mockResolvedValue(MEMBER);
    mockLogSuccess.mockResolvedValue('audit_log_1');
  });

  async function getHandler() {
    const { recordOrgSwitch } = await import('./record_org_switch');
    return (recordOrgSwitch as unknown as { handler: Function }).handler;
  }

  it('throws when unauthenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(handler(ctx, { organizationId: 'org_1' })).rejects.toThrow(
      'Unauthenticated',
    );
    expect(mockLogSuccess).not.toHaveBeenCalled();
  });

  it('writes audit log on first entry for this (user, org)', async () => {
    const ctx = createMockCtx([]);
    const handler = await getHandler();

    await handler(ctx, { organizationId: 'org_1' });

    expect(mockLogSuccess).toHaveBeenCalledTimes(1);
    expect(mockLogSuccess).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        action: 'signed_in_to_organization',
        category: 'auth',
        resourceType: 'organization',
        resourceId: 'org_1',
        auditCtx: expect.objectContaining({
          organizationId: 'org_1',
          actor: expect.objectContaining({
            id: 'user_1',
            email: 'user@example.com',
            role: 'admin',
            type: 'user',
          }),
        }),
      }),
    );
  });

  it('skips audit log when same (user, org) entry exists within window', async () => {
    const ctx = createMockCtx([
      {
        actorId: 'user_1',
        action: 'signed_in_to_organization',
        organizationId: 'org_1',
        category: 'auth',
        timestamp: Date.now() - 5 * 60 * 1000,
      },
    ]);
    const handler = await getHandler();

    await handler(ctx, { organizationId: 'org_1' });

    expect(mockLogSuccess).not.toHaveBeenCalled();
  });

  it('writes audit log when previous same-org entry is from a different user', async () => {
    const ctx = createMockCtx([
      {
        actorId: 'user_2',
        action: 'signed_in_to_organization',
        organizationId: 'org_1',
        category: 'auth',
        timestamp: Date.now() - 5 * 60 * 1000,
      },
    ]);
    const handler = await getHandler();

    await handler(ctx, { organizationId: 'org_1' });

    expect(mockLogSuccess).toHaveBeenCalledTimes(1);
  });

  it('writes audit log when only unrelated auth entries exist for user', async () => {
    const ctx = createMockCtx([
      {
        actorId: 'user_1',
        action: 'login',
        organizationId: 'org_1',
        category: 'auth',
        timestamp: Date.now() - 5 * 60 * 1000,
      },
    ]);
    const handler = await getHandler();

    await handler(ctx, { organizationId: 'org_1' });

    expect(mockLogSuccess).toHaveBeenCalledTimes(1);
  });

  it('queries by_org_category_actorId_timestamp scoped to this user + last 30 minutes', async () => {
    const ctx = createMockCtx([]);
    const handler = await getHandler();
    const before = Date.now();

    await handler(ctx, { organizationId: 'org_1' });

    expect(ctx._builders.query).toHaveBeenCalledWith('auditLogs');
    expect(ctx._builders.withIndex).toHaveBeenCalledWith(
      'by_org_category_actorId_timestamp',
      expect.any(Function),
    );
    expect(ctx._builders.order).toHaveBeenCalledWith('desc');

    const indexFn = ctx._builders.withIndex.mock.calls[0][1] as (
      q: Record<string, ReturnType<typeof vi.fn>>,
    ) => unknown;
    const eq = vi.fn().mockReturnThis();
    const gte = vi.fn().mockReturnThis();
    indexFn({ eq, gte });

    expect(eq).toHaveBeenNthCalledWith(1, 'organizationId', 'org_1');
    expect(eq).toHaveBeenNthCalledWith(2, 'category', 'auth');
    expect(eq).toHaveBeenNthCalledWith(3, 'actorId', 'user_1');
    expect(gte).toHaveBeenCalledTimes(1);
    const cutoff = gte.mock.calls[0][1] as number;
    expect(cutoff).toBeGreaterThanOrEqual(before - 30 * 60 * 1000);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - 30 * 60 * 1000 + 1000);
  });

  it('always updates lastActiveOrganizationId, even when audit log is deduped', async () => {
    const ctx = createMockCtx([
      {
        actorId: 'user_1',
        action: 'signed_in_to_organization',
        organizationId: 'org_1',
        category: 'auth',
        timestamp: Date.now() - 5 * 60 * 1000,
      },
    ]);
    const handler = await getHandler();

    await handler(ctx, { organizationId: 'org_1' });

    expect(mockLogSuccess).not.toHaveBeenCalled();
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'betterAuth:adapter:updateMany',
      expect.objectContaining({
        input: expect.objectContaining({
          model: 'user',
          where: [{ field: '_id', value: 'user_1', operator: 'eq' }],
          update: { lastActiveOrganizationId: 'org_1' },
        }),
      }),
    );
  });

  it('updates lastActiveOrganizationId on first entry too', async () => {
    const ctx = createMockCtx([]);
    const handler = await getHandler();

    await handler(ctx, { organizationId: 'org_1' });

    expect(ctx.runMutation).toHaveBeenCalledWith(
      'betterAuth:adapter:updateMany',
      expect.objectContaining({
        input: expect.objectContaining({
          update: { lastActiveOrganizationId: 'org_1' },
        }),
      }),
    );
  });

  it('returns null', async () => {
    const ctx = createMockCtx();
    const handler = await getHandler();

    const result = await handler(ctx, { organizationId: 'org_1' });

    expect(result).toBeNull();
  });
});
