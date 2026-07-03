import { ConvexError } from 'convex/values';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression test for #2018: createMember's lifecycle rejections used to surface
// as opaque raw `Error`s ("Server Error"). They now throw `ConvexError({ code })`
// so the UI (notably the add-member dialog's inline DUPLICATE_MEMBER handling)
// can branch on a stable code.

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

const mockSignUpEmail = vi.fn();
vi.mock('../auth', () => ({
  createAuth: () => ({
    api: { signUpEmail: (...a: unknown[]) => mockSignUpEmail(...a) },
  }),
}));

const mockUpsertMemberMirror = vi.fn();
vi.mock('../members/mirror_sync', () => ({
  upsertMemberMirror: (...args: unknown[]) => mockUpsertMemberMirror(...args),
}));

const mockRecordPasswordChange = vi.fn();
vi.mock('./password_metadata', () => ({
  recordPasswordChange: (...args: unknown[]) =>
    mockRecordPasswordChange(...args),
}));

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

const AUTH_USER = { userId: 'admin_user', email: 'admin@example.com' };
const ORG_ID = 'org_1';

// Per-test controls for the three findMany lookups create_member issues.
let callerMemberPage: unknown[];
let userLookupPage: unknown[];
let existingMemberPage: unknown[];

interface FindManyArgs {
  model: string;
  where?: Array<{ field: string; value: unknown }>;
}

function findUserIdWhere(qargs: FindManyArgs) {
  return qargs.where?.find((w) => w.field === 'userId')?.value;
}

function createMockCtx() {
  return {
    runQuery: vi.fn(async (_ref: unknown, qargs: FindManyArgs) => {
      if (qargs.model === 'user') {
        return { page: userLookupPage };
      }
      if (qargs.model === 'member') {
        // The caller-role lookup queries by the authenticated admin's id; the
        // membership-dedup lookup queries by the existing user's id.
        if (findUserIdWhere(qargs) === AUTH_USER.userId) {
          return { page: callerMemberPage };
        }
        return { page: existingMemberPage };
      }
      return { page: [] };
    }),
    runMutation: vi.fn(async () => ({ _id: 'member_new' })),
  };
}

async function getCreateMember() {
  const mod = await import('./create_member');
  return mod.createMember;
}

const BASE_ARGS = {
  organizationId: ORG_ID,
  email: 'New.User@Example.com',
  password: 'StrongP@ss1',
  displayName: 'New User',
};

describe('createMember', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue(AUTH_USER);
    // Caller is an admin by default.
    callerMemberPage = [{ _id: 'caller_member', role: 'admin' }];
    // No pre-existing user by default.
    userLookupPage = [];
    existingMemberPage = [];
    mockSignUpEmail.mockResolvedValue({ user: { id: 'created' } });
    mockUpsertMemberMirror.mockResolvedValue(undefined);
    mockRecordPasswordChange.mockResolvedValue(undefined);
  });

  it('throws UNAUTHENTICATED when there is no authenticated user', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(null);
    const createMember = await getCreateMember();

    await expect(
      createMember(createMockCtx() as never, BASE_ARGS),
    ).rejects.toMatchObject({ data: { code: 'UNAUTHENTICATED' } });
  });

  it('throws FORBIDDEN when the caller is not an admin', async () => {
    callerMemberPage = [{ _id: 'caller_member', role: 'member' }];
    const createMember = await getCreateMember();

    await expect(
      createMember(createMockCtx() as never, BASE_ARGS),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
  });

  it('throws FORBIDDEN when the caller has no membership in the org', async () => {
    callerMemberPage = [];
    const createMember = await getCreateMember();

    await expect(
      createMember(createMockCtx() as never, BASE_ARGS),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
  });

  it('rejects assigning the owner role even for an admin caller', async () => {
    // Caller is an admin by default (passes isAdmin, but must not mint owner).
    // The owner-role guard throws a raw Error and must fire before any
    // account/membership is written.
    const ctx = createMockCtx();
    const createMember = await getCreateMember();

    await expect(
      createMember(ctx as never, { ...BASE_ARGS, role: 'owner' }),
    ).rejects.toThrow(/owner role cannot be assigned/i);

    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('throws DUPLICATE_MEMBER when the user is already a member of the org', async () => {
    userLookupPage = [{ _id: 'existing_user' }];
    existingMemberPage = [{ _id: 'existing_member' }];
    const createMember = await getCreateMember();

    await expect(
      createMember(createMockCtx() as never, BASE_ARGS),
    ).rejects.toMatchObject({ data: { code: 'DUPLICATE_MEMBER' } });
  });

  it('throws PASSWORD_REQUIRED when creating a brand-new user without a password', async () => {
    const createMember = await getCreateMember();

    await expect(
      createMember(createMockCtx() as never, {
        ...BASE_ARGS,
        password: undefined,
      }),
    ).rejects.toMatchObject({ data: { code: 'PASSWORD_REQUIRED' } });
  });

  it('throws USER_CREATION_FAILED when Better Auth signup returns nothing', async () => {
    mockSignUpEmail.mockResolvedValue(null);
    const createMember = await getCreateMember();

    await expect(
      createMember(createMockCtx() as never, BASE_ARGS),
    ).rejects.toMatchObject({ data: { code: 'USER_CREATION_FAILED' } });
  });

  it('throws USER_CREATION_FAILED when the user cannot be found after signup', async () => {
    // signup succeeds, but the follow-up user lookup returns nothing.
    userLookupPage = [];
    const createMember = await getCreateMember();

    await expect(
      createMember(createMockCtx() as never, BASE_ARGS),
    ).rejects.toMatchObject({ data: { code: 'USER_CREATION_FAILED' } });
  });

  it('surfaces all rejections as ConvexError, never a raw Error', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(null);
    const createMember = await getCreateMember();

    await expect(
      createMember(createMockCtx() as never, BASE_ARGS),
    ).rejects.toBeInstanceOf(ConvexError);
  });
});
