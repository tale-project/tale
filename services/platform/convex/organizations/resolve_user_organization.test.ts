// The org an API key operates on is a tenant boundary: an explicit
// X-Organization-Slug must be membership-checked (never a probe), and a
// write-capable machine key must be able to refuse the lastActiveOrganizationId
// fallback — that pointer moves with unrelated dashboard clicks, so following
// it would silently redirect a write to another tenant.
//
// The query factory is mocked to hand the config straight through (same
// pattern as projects/detach_document_from_project.test.ts) so the handler is
// unit-testable without a running backend.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', () => ({
  internalQuery: (config: unknown) => config,
}));

vi.mock('../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: { findOne: 'adapter.findOne', findMany: 'adapter.findMany' },
    },
  },
}));

type OrgResult = { organizationId: string; orgSlug: string };
type Handler = (
  ctx: unknown,
  args: { userId: string; orgSlug?: string; requireExplicitOrgSlug?: boolean },
) => Promise<OrgResult>;

const { resolveUserOrganization } = await import('./resolve_user_organization');
const query = resolveUserOrganization as unknown as { handler: Handler };

interface AdapterQuery {
  model: string;
  where?: Array<{ field: string; value: unknown }>;
}

interface Fixtures {
  orgs?: Array<{ _id: string; slug: string }>;
  members?: Array<{ organizationId: string; userId: string; role: string }>;
  user?: Record<string, unknown>;
}

/**
 * Answers the Better Auth adapter reads the handler makes, from fixture rows.
 * `models` records which adapter models were consulted, so a test can assert
 * the strict path never reads the `user` row (the lastActive lookup).
 */
function makeCtx(fixtures: Fixtures): {
  ctx: { runQuery: ReturnType<typeof vi.fn> };
  models: string[];
} {
  const models: string[] = [];
  const runQuery = vi.fn(async (_ref: unknown, rawArgs: unknown) => {
    const { model, where = [] } = rawArgs as AdapterQuery;
    models.push(model);
    const value = (field: string): unknown =>
      where.find((clause) => clause.field === field)?.value;
    if (model === 'organization') {
      const slug = value('slug');
      const id = value('_id');
      return (
        (fixtures.orgs ?? []).find((org) =>
          slug !== undefined ? org.slug === slug : org._id === id,
        ) ?? null
      );
    }
    if (model === 'member') {
      const organizationId = value('organizationId');
      const userId = value('userId');
      const page = (fixtures.members ?? []).filter(
        (member) =>
          (organizationId === undefined ||
            member.organizationId === organizationId) &&
          (userId === undefined || member.userId === userId),
      );
      return { page };
    }
    if (model === 'user') {
      return fixtures.user ?? null;
    }
    throw new Error(`unexpected adapter model "${model}"`);
  });
  return { ctx: { runQuery }, models };
}

const ORGS = [
  { _id: 'org_1', slug: 'acme' },
  { _id: 'org_2', slug: 'beta' },
];

function membership(
  organizationId: string,
  role = 'member',
): { organizationId: string; userId: string; role: string } {
  return { organizationId, userId: 'user_1', role };
}

describe('resolveUserOrganization', () => {
  it('resolves an explicit slug the user is a member of (multi-org)', async () => {
    const { ctx } = makeCtx({
      orgs: ORGS,
      members: [membership('org_1'), membership('org_2')],
    });
    await expect(
      query.handler(ctx, { userId: 'user_1', orgSlug: 'beta' }),
    ).resolves.toEqual({ organizationId: 'org_2', orgSlug: 'beta' });
  });

  it('refuses a slug the user is not a member of', async () => {
    const { ctx } = makeCtx({ orgs: ORGS, members: [membership('org_1')] });
    await expect(
      query.handler(ctx, { userId: 'user_1', orgSlug: 'beta' }),
    ).rejects.toThrow('Not a member of organization beta');
  });

  it('refuses a slug where the membership is disabled', async () => {
    const { ctx } = makeCtx({
      orgs: ORGS,
      members: [membership('org_2', 'disabled')],
    });
    await expect(
      query.handler(ctx, { userId: 'user_1', orgSlug: 'beta' }),
    ).rejects.toThrow('Not a member of organization beta');
  });

  it('refuses an unknown slug', async () => {
    const { ctx } = makeCtx({ orgs: ORGS, members: [membership('org_1')] });
    await expect(
      query.handler(ctx, { userId: 'user_1', orgSlug: 'ghost' }),
    ).rejects.toThrow('Organization not found: ghost');
  });

  it('demands the header for a strict multi-org key without consulting lastActive', async () => {
    const { ctx, models } = makeCtx({
      orgs: ORGS,
      members: [membership('org_1'), membership('org_2')],
      user: { _id: 'user_1', lastActiveOrganizationId: 'org_2' },
    });
    await expect(
      query.handler(ctx, { userId: 'user_1', requireExplicitOrgSlug: true }),
    ).rejects.toThrow(/X-Organization-Slug/);
    expect(models).not.toContain('user');
  });

  it('resolves a single-org user without the header even in strict mode', async () => {
    const { ctx } = makeCtx({ orgs: ORGS, members: [membership('org_1')] });
    await expect(
      query.handler(ctx, { userId: 'user_1', requireExplicitOrgSlug: true }),
    ).resolves.toEqual({ organizationId: 'org_1', orgSlug: 'acme' });
  });

  it('keeps the lastActive fallback for a multi-org user without the flag', async () => {
    const { ctx } = makeCtx({
      orgs: ORGS,
      members: [membership('org_1'), membership('org_2')],
      user: { _id: 'user_1', lastActiveOrganizationId: 'org_2' },
    });
    await expect(query.handler(ctx, { userId: 'user_1' })).resolves.toEqual({
      organizationId: 'org_2',
      orgSlug: 'beta',
    });
  });

  it('demands the header for a multi-org user with no usable lastActive', async () => {
    const { ctx } = makeCtx({
      orgs: ORGS,
      members: [membership('org_1'), membership('org_2')],
      user: { _id: 'user_1' },
    });
    await expect(query.handler(ctx, { userId: 'user_1' })).rejects.toThrow(
      /X-Organization-Slug/,
    );
  });

  it('ignores disabled memberships when counting orgs for strict mode', async () => {
    const { ctx } = makeCtx({
      orgs: ORGS,
      members: [membership('org_1'), membership('org_2', 'disabled')],
    });
    await expect(
      query.handler(ctx, { userId: 'user_1', requireExplicitOrgSlug: true }),
    ).resolves.toEqual({ organizationId: 'org_1', orgSlug: 'acme' });
  });
});
