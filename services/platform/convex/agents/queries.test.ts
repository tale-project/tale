// #2570 — `getAvailableIntegrations` moved from a `query` to an `action` so it
// can merge the org's `integration.json` catalog `description` (filesystem,
// Node-only) alongside the `integrationCredentials` table rows. These tests
// lock: the auth gate, the active-only filter, the description merge by slug,
// and that a missing/unreadable catalog degrades to "no description" instead
// of failing the whole picker.

import { ConvexError } from 'convex/values';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../_generated/server', () => ({
  query: (config: unknown) => config,
  action: (config: unknown) => config,
}));

vi.mock('../_generated/api', () => ({
  internal: {
    integrations: {
      credential_queries: { listInternal: 'credential_queries:listInternal' },
      file_actions: {
        listIntegrationsInternal: 'file_actions:listIntegrationsInternal',
      },
    },
  },
}));

const mockRequireOrgMembershipById = vi.fn();
vi.mock('../lib/auth/require_org_membership', () => ({
  requireOrgMembershipById: (...args: unknown[]) =>
    mockRequireOrgMembershipById(...args),
}));

vi.mock('../lib/rls', () => ({
  getAuthUserIdentity: vi.fn(),
  getOrganizationMember: vi.fn(),
}));

type ActionHandler = {
  handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

const { getAvailableIntegrations } = (await import('./queries')) as unknown as {
  getAvailableIntegrations: ActionHandler;
};

function makeCtx({
  credentials,
  catalog,
}: {
  credentials: Array<{
    slug: string;
    status: string;
    sqlConnectionConfig?: unknown;
  }>;
  catalog: Array<{ slug: string; description?: string }>;
}) {
  const runQuery = vi.fn().mockResolvedValue(credentials);
  const runAction = vi.fn().mockResolvedValue(catalog);
  return { ctx: { runQuery, runAction }, runQuery, runAction };
}

describe('getAvailableIntegrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireOrgMembershipById.mockResolvedValue({
      orgSlug: 'acme',
      orgId: 'org_1',
      userId: 'user_1',
      email: 'u@acme.test',
      name: 'U',
      member: { _id: 'member_1', role: 'member' },
    });
  });

  it('throws when the caller is not an org member', async () => {
    mockRequireOrgMembershipById.mockRejectedValue(
      new ConvexError({ code: 'ORG_FORBIDDEN', message: 'nope' }),
    );
    const { ctx } = makeCtx({ credentials: [], catalog: [] });

    await expect(
      getAvailableIntegrations.handler(ctx, { organizationId: 'org_1' }),
    ).rejects.toMatchObject({ data: { code: 'ORG_FORBIDDEN' } });
  });

  it('merges the catalog description onto the matching active credential', async () => {
    const { ctx, runAction } = makeCtx({
      credentials: [
        { slug: 'tavily', status: 'active' },
        { slug: 'stale-one', status: 'disconnected' },
      ],
      catalog: [
        { slug: 'tavily', description: 'Web search for research agents.' },
      ],
    });

    const result = await getAvailableIntegrations.handler(ctx, {
      organizationId: 'org_1',
    });

    // Only the active credential is bindable; the catalog is only consulted
    // with the resolved orgSlug, never the raw organizationId.
    expect(runAction).toHaveBeenCalledWith(
      'file_actions:listIntegrationsInternal',
      { orgSlug: 'acme' },
    );
    expect(result).toEqual([
      {
        name: 'tavily',
        title: 'tavily',
        type: 'rest_api',
        description: 'Web search for research agents.',
      },
    ]);
  });

  it('degrades to no description when the catalog has no matching entry', async () => {
    const { ctx } = makeCtx({
      credentials: [{ slug: 'no-catalog-entry', status: 'active' }],
      catalog: [],
    });

    const result = await getAvailableIntegrations.handler(ctx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual([
      {
        name: 'no-catalog-entry',
        title: 'no-catalog-entry',
        type: 'rest_api',
        description: undefined,
      },
    ]);
  });

  it('marks a SQL credential by its connection config, never surfacing it', async () => {
    const { ctx } = makeCtx({
      credentials: [
        {
          slug: 'warehouse',
          status: 'active',
          sqlConnectionConfig: { host: 'db.internal', password: 'secret' },
        },
      ],
      catalog: [],
    });

    const result = (await getAvailableIntegrations.handler(ctx, {
      organizationId: 'org_1',
    })) as Array<Record<string, unknown>>;

    expect(result[0]).toMatchObject({ name: 'warehouse', type: 'sql' });
    // No connection-config field (host/password) ever leaves the projection.
    expect(result[0]).not.toHaveProperty('sqlConnectionConfig');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('skips the catalog read entirely when there are no active credentials', async () => {
    const { ctx, runAction } = makeCtx({
      credentials: [{ slug: 'disabled', status: 'disconnected' }],
      catalog: [],
    });

    const result = await getAvailableIntegrations.handler(ctx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual([]);
    expect(runAction).not.toHaveBeenCalled();
  });
});
