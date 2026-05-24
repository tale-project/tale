import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', () => ({
  internalQuery: vi.fn((config) => config),
}));

vi.mock('../_generated/api', () => ({
  components: {
    betterAuth: { adapter: { findOne: 'findOne', findMany: 'findMany' } },
  },
}));

vi.mock('../streaming/validators', () => ({
  citationItemValidator: 'citationItemValidator',
}));

const { resolveUserOrganization } = await import('./internal_queries');

type Handler = (ctx: unknown, args: unknown) => Promise<unknown>;
const handler = (resolveUserOrganization as unknown as { handler: Handler })
  .handler;

interface FakeData {
  organizations: Record<string, { _id: string; slug: string }>;
  members: Array<{ organizationId: string; userId: string; role: string }>;
  users: Record<string, { _id: string; lastActiveOrganizationId?: string }>;
}

function makeCtx(data: FakeData) {
  return {
    runQuery: vi.fn(
      async (
        ref: string,
        params: {
          model: string;
          where: Array<{ field: string; value: string; operator: string }>;
          paginationOpts?: unknown;
        },
      ) => {
        if (ref === 'findOne' && params.model === 'organization') {
          const idEq = params.where.find((w) => w.field === '_id');
          const slugEq = params.where.find((w) => w.field === 'slug');
          if (idEq) return data.organizations[idEq.value] ?? null;
          if (slugEq) {
            const hit = Object.values(data.organizations).find(
              (o) => o.slug === slugEq.value,
            );
            return hit ?? null;
          }
          return null;
        }
        if (ref === 'findOne' && params.model === 'user') {
          const idEq = params.where.find((w) => w.field === '_id');
          return idEq ? (data.users[idEq.value] ?? null) : null;
        }
        if (ref === 'findMany' && params.model === 'member') {
          const orgEq = params.where.find(
            (w) => w.field === 'organizationId',
          )?.value;
          const userEq = params.where.find((w) => w.field === 'userId')?.value;
          return {
            page: data.members.filter(
              (m) =>
                (!orgEq || m.organizationId === orgEq) &&
                (!userEq || m.userId === userEq),
            ),
          };
        }
        return null;
      },
    ),
  };
}

const baseData: FakeData = {
  organizations: {
    org_a: { _id: 'org_a', slug: 'acme' },
    org_b: { _id: 'org_b', slug: 'beta' },
  },
  members: [
    { organizationId: 'org_a', userId: 'user_1', role: 'admin' },
    { organizationId: 'org_b', userId: 'user_2', role: 'admin' },
  ],
  users: {
    user_1: { _id: 'user_1' },
    user_2: { _id: 'user_2' },
  },
};

describe('resolveUserOrganization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the org when the slug header points to a membership', async () => {
    const ctx = makeCtx(baseData);
    await expect(
      handler(ctx, { userId: 'user_1', orgSlug: 'acme' }),
    ).resolves.toEqual({ organizationId: 'org_a', orgSlug: 'acme' });
  });

  it('rejects when the slug header points to an org the caller is not in', async () => {
    const ctx = makeCtx(baseData);
    await expect(
      handler(ctx, { userId: 'user_1', orgSlug: 'beta' }),
    ).rejects.toThrow(/Not a member of organization beta/);
  });

  it('rejects disabled members on the header path', async () => {
    const ctx = makeCtx({
      ...baseData,
      members: [
        { organizationId: 'org_a', userId: 'user_1', role: 'disabled' },
      ],
    });
    await expect(
      handler(ctx, { userId: 'user_1', orgSlug: 'acme' }),
    ).rejects.toThrow(/Not a member of organization acme/);
  });

  it('auto-resolves a single-membership user with no header', async () => {
    const ctx = makeCtx(baseData);
    await expect(handler(ctx, { userId: 'user_1' })).resolves.toEqual({
      organizationId: 'org_a',
      orgSlug: 'acme',
    });
  });

  it('falls back to lastActiveOrganizationId for a multi-membership user', async () => {
    const ctx = makeCtx({
      organizations: baseData.organizations,
      members: [
        { organizationId: 'org_a', userId: 'user_1', role: 'admin' },
        { organizationId: 'org_b', userId: 'user_1', role: 'admin' },
      ],
      users: { user_1: { _id: 'user_1', lastActiveOrganizationId: 'org_b' } },
    });
    await expect(handler(ctx, { userId: 'user_1' })).resolves.toEqual({
      organizationId: 'org_b',
      orgSlug: 'beta',
    });
  });

  it('errors a multi-membership user without lastActive', async () => {
    const ctx = makeCtx({
      organizations: baseData.organizations,
      members: [
        { organizationId: 'org_a', userId: 'user_1', role: 'admin' },
        { organizationId: 'org_b', userId: 'user_1', role: 'admin' },
      ],
      users: { user_1: { _id: 'user_1' } },
    });
    await expect(handler(ctx, { userId: 'user_1' })).rejects.toThrow(
      /multiple organizations/,
    );
  });

  it('errors a user with no memberships', async () => {
    const ctx = makeCtx({
      organizations: baseData.organizations,
      members: [],
      users: { user_lonely: { _id: 'user_lonely' } },
    });
    await expect(handler(ctx, { userId: 'user_lonely' })).rejects.toThrow(
      /no organization memberships/,
    );
  });
});
