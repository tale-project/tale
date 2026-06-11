import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth:adapter:findMany',
      },
    },
  },
}));

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    query: (config: Record<string, unknown>) => config,
  };
});

const { listPasskeysForMember } = await import('./queries');

const handler = (
  listPasskeysForMember as unknown as {
    handler: (ctx: unknown, args: { memberId: string }) => Promise<unknown>;
  }
).handler;

interface CtxOptions {
  member?: Record<string, unknown> | null;
  callerMembership?: Record<string, unknown> | null;
  passkeys?: Record<string, unknown>[];
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
        return { page: opts.passkeys ?? [] };
      }
      return { page: [] };
    },
  );
  return { runQuery };
}

const CALLER = { userId: 'user_admin', email: 'admin@example.com' };

const TARGET_MEMBER = {
  _id: 'm_target',
  organizationId: 'org_1',
  userId: 'user_target',
  role: 'member',
};

describe('listPasskeysForMember handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when unauthenticated', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(null);
    const ctx = createCtx({});

    await expect(handler(ctx, { memberId: 'm_target' })).rejects.toThrow(
      'Unauthenticated',
    );
  });

  it('throws when the target member does not exist', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(CALLER);
    const ctx = createCtx({ member: null });

    await expect(handler(ctx, { memberId: 'm_target' })).rejects.toThrow(
      'Member not found',
    );
  });

  it('throws when the caller is not an admin in the target org', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(CALLER);
    const ctx = createCtx({
      member: TARGET_MEMBER,
      callerMembership: { role: 'member' },
    });

    await expect(handler(ctx, { memberId: 'm_target' })).rejects.toThrow(
      'Only admins can list passkeys for members',
    );
  });

  it('throws when the caller has no membership in the target org', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(CALLER);
    const ctx = createCtx({ member: TARGET_MEMBER, callerMembership: null });

    await expect(handler(ctx, { memberId: 'm_target' })).rejects.toThrow(
      'Only admins can list passkeys for members',
    );
  });

  it('returns display fields only for an admin caller', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(CALLER);
    const ctx = createCtx({
      member: TARGET_MEMBER,
      callerMembership: { role: 'admin' },
      passkeys: [
        {
          _id: 'pk_1',
          userId: 'user_target',
          name: 'MacBook Touch ID',
          deviceType: 'multiDevice',
          backedUp: true,
          createdAt: 1700000000000,
          // Credential material must never reach the client.
          publicKey: 'secret-public-key',
          counter: 7,
          credentialID: 'cred-1',
        },
        {
          _id: 'pk_2',
          userId: 'user_target',
          deviceType: 'singleDevice',
          backedUp: false,
        },
      ],
    });

    await expect(handler(ctx, { memberId: 'm_target' })).resolves.toEqual([
      {
        id: 'pk_1',
        name: 'MacBook Touch ID',
        deviceType: 'multiDevice',
        backedUp: true,
        createdAt: 1700000000000,
      },
      {
        id: 'pk_2',
        name: null,
        deviceType: 'singleDevice',
        backedUp: false,
        createdAt: null,
      },
    ]);
  });
});
