import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth:adapter:findMany',
        create: 'betterAuth:adapter:create',
        updateOne: 'betterAuth:adapter:updateOne',
      },
    },
  },
}));

const mockLogJoinedOrganization = vi.fn();
vi.mock('../../audit_logs/helpers', () => ({
  logJoinedOrganization: (...args: unknown[]) =>
    mockLogJoinedOrganization(...args),
}));

import { findOrCreateUserFromHeaders } from './find_or_create_user_from_headers';

type RunMutationFn = ReturnType<typeof vi.fn>;
type RunQueryFn = ReturnType<typeof vi.fn>;

interface QueueDriver {
  runQuery: RunQueryFn;
  runMutation: RunMutationFn;
}

function makeCtx({
  existingUserPage,
  existingMemberPage,
  existingAdminPage,
  createdUserId = 'user_new',
  createdOrgId = 'org_new',
}: {
  existingUserPage: unknown[];
  existingMemberPage?: unknown[];
  existingAdminPage?: unknown[];
  createdUserId?: string;
  createdOrgId?: string;
}): QueueDriver {
  // Order of runQuery calls inside findOrCreateUserFromHeaders:
  //   1. find user by email
  //   2a. (if user exists) find member by userId
  //   2b. (if user does not exist) find admin member to attach to existing org
  const runQuery = vi.fn();
  runQuery.mockResolvedValueOnce({ page: existingUserPage });
  if (existingUserPage.length > 0) {
    runQuery.mockResolvedValueOnce({ page: existingMemberPage ?? [] });
  } else {
    runQuery.mockResolvedValueOnce({ page: existingAdminPage ?? [] });
  }

  // runMutation calls (in order, depending on branch):
  //   - updateOne (only when existing user has a stale name)
  //   - create user
  //   - create member (existing-org branch) OR create org + create member (new-org branch)
  const runMutation = vi.fn();
  runMutation.mockImplementation(async (ref: string, args: unknown) => {
    const a = args as { input?: { model?: string } };
    if (ref === 'betterAuth:adapter:create') {
      if (a.input?.model === 'user') return { _id: createdUserId };
      if (a.input?.model === 'organization') return { _id: createdOrgId };
      if (a.input?.model === 'member') return { _id: 'member_new' };
    }
    return undefined;
  });

  return { runQuery, runMutation };
}

const ARGS = {
  email: 'new@example.com',
  name: 'New User',
  role: 'member',
};

describe('findOrCreateUserFromHeaders — joined_organization audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips logJoinedOrganization when the user already exists', async () => {
    const ctx = makeCtx({
      existingUserPage: [
        { _id: 'user_existing', email: ARGS.email, name: ARGS.name },
      ],
      existingMemberPage: [
        {
          _id: 'member_existing',
          userId: 'user_existing',
          organizationId: 'org_existing',
        },
      ],
    });

    await findOrCreateUserFromHeaders(
      ctx as unknown as Parameters<typeof findOrCreateUserFromHeaders>[0],
      ARGS,
    );

    expect(mockLogJoinedOrganization).not.toHaveBeenCalled();
  });

  it('logs joined_organization with role=member when attaching new user to existing org', async () => {
    const ctx = makeCtx({
      existingUserPage: [],
      existingAdminPage: [
        {
          _id: 'admin_member',
          userId: 'user_other',
          organizationId: 'org_existing',
        },
      ],
      createdUserId: 'user_new',
    });

    await findOrCreateUserFromHeaders(
      ctx as unknown as Parameters<typeof findOrCreateUserFromHeaders>[0],
      ARGS,
    );

    expect(mockLogJoinedOrganization).toHaveBeenCalledTimes(1);
    expect(mockLogJoinedOrganization).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        organizationId: 'org_existing',
        userId: 'user_new',
        userEmail: ARGS.email,
        userRole: 'member',
      }),
    );
  });

  it('logs joined_organization with role=admin when creating the first org for the first user', async () => {
    const ctx = makeCtx({
      existingUserPage: [],
      existingAdminPage: [],
      createdUserId: 'user_first',
      createdOrgId: 'org_first',
    });

    await findOrCreateUserFromHeaders(
      ctx as unknown as Parameters<typeof findOrCreateUserFromHeaders>[0],
      ARGS,
    );

    expect(mockLogJoinedOrganization).toHaveBeenCalledTimes(1);
    expect(mockLogJoinedOrganization).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        organizationId: 'org_first',
        userId: 'user_first',
        userEmail: ARGS.email,
        userRole: 'admin',
      }),
    );
  });

  it('does not propagate audit failures back to the caller', async () => {
    mockLogJoinedOrganization.mockRejectedValueOnce(
      new Error('audit table down'),
    );

    const ctx = makeCtx({
      existingUserPage: [],
      existingAdminPage: [],
      createdUserId: 'user_first',
      createdOrgId: 'org_first',
    });

    await expect(
      findOrCreateUserFromHeaders(
        ctx as unknown as Parameters<typeof findOrCreateUserFromHeaders>[0],
        ARGS,
      ),
    ).resolves.toEqual({
      userId: 'user_first',
      organizationId: 'org_first',
    });
  });
});
