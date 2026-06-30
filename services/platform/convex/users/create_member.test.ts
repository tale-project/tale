import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth:adapter:findMany',
        create: 'betterAuth:adapter:create',
      },
    },
  },
}));

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

vi.mock('../auth', () => ({
  createAuth: vi.fn(),
}));

vi.mock('../members/mirror_sync', () => ({
  upsertMemberMirror: vi.fn(),
}));

vi.mock('./password_metadata', () => ({
  recordPasswordChange: vi.fn(),
}));

function createMockCtx() {
  return {
    runQuery: vi.fn(),
    runMutation: vi.fn(),
  };
}

const AUTH_USER = {
  userId: 'user_caller',
  email: 'admin@example.com',
  name: 'Admin',
};

describe('createMember', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getCreateMember() {
    const mod = await import('./create_member');
    return mod.createMember;
  }

  const baseArgs = {
    organizationId: 'org_1',
    email: 'new@example.com',
    password: 'sup3r-secret-pw',
  };

  it('throws when unauthenticated', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(null);
    const ctx = createMockCtx();
    const createMember = await getCreateMember();

    await expect(createMember(ctx as never, baseArgs)).rejects.toThrow(
      'Unauthenticated',
    );
  });

  it('throws when caller is not an admin', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // caller membership lookup — plain member
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'member' }],
    });
    const createMember = await getCreateMember();

    await expect(createMember(ctx as never, baseArgs)).rejects.toThrow(
      'Only admins can create members',
    );
  });

  it('rejects assigning the owner role even for an admin caller', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // caller membership lookup — admin (passes isAdmin, but must not mint owner)
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'm_caller', role: 'admin' }],
    });
    const createMember = await getCreateMember();

    await expect(
      createMember(ctx as never, { ...baseArgs, role: 'owner' }),
    ).rejects.toThrow('The owner role cannot be assigned manually');

    // The guard must fire before any account/membership is written.
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });
});
