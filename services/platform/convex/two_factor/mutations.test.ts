import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth:adapter:findMany',
        deleteMany: 'betterAuth:adapter:deleteMany',
        updateMany: 'betterAuth:adapter:updateMany',
      },
    },
  },
  internal: {
    two_factor: {
      internal_mutations: {
        logEnrollmentEvent: 'two_factor:internal_mutations:logEnrollmentEvent',
      },
    },
  },
}));

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutation: (config: Record<string, unknown>) => config,
  };
});

const { revokePasskeyForMember } = await import('./mutations');

const handler = (
  revokePasskeyForMember as unknown as {
    handler: (
      ctx: unknown,
      args: { memberId: string; passkeyId: string },
    ) => Promise<null>;
  }
).handler;

interface CtxOptions {
  /** Target member row (first `member` lookup). Null = not found. */
  member?: Record<string, unknown> | null;
  /** Caller's membership in the target org (second `member` lookup). */
  callerMembership?: Record<string, unknown> | null;
  /** Passkey row returned by the `passkey` lookup. Null = not found. */
  passkey?: Record<string, unknown> | null;
}

function createCtx(opts: CtxOptions) {
  let memberLookups = 0;
  const runQuery = vi.fn(
    async (_token: unknown, args: { model: string }): Promise<unknown> => {
      if (args.model === 'member') {
        memberLookups += 1;
        const row = memberLookups === 1 ? opts.member : opts.callerMembership;
        return { page: row ? [row] : [] };
      }
      if (args.model === 'passkey') {
        return { page: opts.passkey ? [opts.passkey] : [] };
      }
      // `session` re-check inside invalidateAllSessions — report empty so
      // the deletion loop terminates after one pass.
      return { page: [] };
    },
  );
  const runMutation = vi.fn(async () => null);
  return { runQuery, runMutation };
}

const CALLER = { userId: 'user_admin', email: 'admin@example.com' };

const TARGET_MEMBER = {
  _id: 'm_target',
  organizationId: 'org_1',
  userId: 'user_target',
  role: 'member',
};

const PASSKEY_ROW = {
  _id: 'pk_1',
  userId: 'user_target',
  name: 'MacBook Touch ID',
  deviceType: 'multiDevice',
  backedUp: true,
};

describe('revokePasskeyForMember handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when unauthenticated', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(null);
    const ctx = createCtx({});

    await expect(
      handler(ctx, { memberId: 'm_target', passkeyId: 'pk_1' }),
    ).rejects.toThrow('Unauthenticated');
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('throws when the target member does not exist', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(CALLER);
    const ctx = createCtx({ member: null });

    await expect(
      handler(ctx, { memberId: 'm_target', passkeyId: 'pk_1' }),
    ).rejects.toThrow('Member not found');
  });

  it('throws when the caller is not a member of the target org', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(CALLER);
    const ctx = createCtx({ member: TARGET_MEMBER, callerMembership: null });

    await expect(
      handler(ctx, { memberId: 'm_target', passkeyId: 'pk_1' }),
    ).rejects.toThrow('Only admins can revoke passkeys for members');
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('throws when the caller is a non-admin member', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(CALLER);
    const ctx = createCtx({
      member: TARGET_MEMBER,
      callerMembership: { role: 'member' },
    });

    await expect(
      handler(ctx, { memberId: 'm_target', passkeyId: 'pk_1' }),
    ).rejects.toThrow('Only admins can revoke passkeys for members');
  });

  it('rejects an admin (non-owner) targeting an owner', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(CALLER);
    const ctx = createCtx({
      member: { ...TARGET_MEMBER, role: 'owner' },
      callerMembership: { role: 'admin' },
      passkey: PASSKEY_ROW,
    });

    await expect(
      handler(ctx, { memberId: 'm_target', passkeyId: 'pk_1' }),
    ).rejects.toThrow('Cannot revoke passkeys for this member');
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('IDOR guard: rejects a passkey that belongs to a different user', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(CALLER);
    const ctx = createCtx({
      member: TARGET_MEMBER,
      callerMembership: { role: 'admin' },
      // Foreign credential — same org admin, but the passkey row belongs to
      // a user outside the target membership.
      passkey: { ...PASSKEY_ROW, userId: 'user_other_org' },
    });

    await expect(
      handler(ctx, { memberId: 'm_target', passkeyId: 'pk_1' }),
    ).rejects.toThrow('Passkey not found');
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('deletes the passkey, kills sessions, and audits on the happy path', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(CALLER);
    const ctx = createCtx({
      member: TARGET_MEMBER,
      callerMembership: { role: 'admin' },
      passkey: PASSKEY_ROW,
    });

    await expect(
      handler(ctx, { memberId: 'm_target', passkeyId: 'pk_1' }),
    ).resolves.toBeNull();

    // Passkey row deleted by id.
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'betterAuth:adapter:deleteMany',
      expect.objectContaining({
        input: expect.objectContaining({
          model: 'passkey',
          where: [{ field: '_id', value: 'pk_1', operator: 'eq' }],
        }),
      }),
    );

    // All sessions of the target user invalidated (resetForUser parity).
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'betterAuth:adapter:deleteMany',
      expect.objectContaining({
        input: expect.objectContaining({
          model: 'session',
          where: [{ field: 'userId', value: 'user_target', operator: 'eq' }],
        }),
      }),
    );

    // Audit entry keyed on both admin and target.
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'two_factor:internal_mutations:logEnrollmentEvent',
      expect.objectContaining({
        userId: 'user_target',
        actorId: 'user_admin',
        action: 'passkey_revoked_by_admin',
        metadata: { memberId: 'm_target', passkeyId: 'pk_1' },
      }),
    );
  });

  it('allows an owner to revoke another owner’s passkey', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(CALLER);
    const ctx = createCtx({
      member: { ...TARGET_MEMBER, role: 'owner' },
      callerMembership: { role: 'owner' },
      passkey: PASSKEY_ROW,
    });

    await expect(
      handler(ctx, { memberId: 'm_target', passkeyId: 'pk_1' }),
    ).resolves.toBeNull();
  });
});
