import { describe, it, expect, vi, beforeEach } from 'vitest';

// #2016: the admin/auth gates in governance/queries.ts must throw
// `AppError({ code })` (UNAUTHENTICATED / FORBIDDEN) so the client can
// branch on the structured code — not a raw `Error`. The message-only
// assertions elsewhere would pass identically against a raw throw, so these
// tests lock the `data.code` contract on the file named in the issue title.

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    query: (config: Record<string, unknown>) => config,
  };
});

const mockGetOrganizationMember = vi.fn();
vi.mock('../lib/rls/organization/get_organization_member', () => ({
  getOrganizationMember: (...args: unknown[]) =>
    mockGetOrganizationMember(...args),
}));

// Sibling modules the gated handlers only reach *after* the auth check —
// stubbed so importing queries.ts doesn't pull their (codegen-dependent)
// transitive graph into the unit test.
vi.mock('../documents/get_user_names_batch', () => ({
  getUserNamesBatch: vi.fn(async () => new Map<string, string>()),
}));
vi.mock('../lib/get_user_teams', () => ({
  getUserTeamIds: vi.fn(async () => [] as string[]),
}));
vi.mock('./budget_enforcement', () => ({ checkBudget: vi.fn() }));
vi.mock('./feature_enforcement', () => ({ resolveFeatureFlags: vi.fn() }));
vi.mock('./get_org_usage_metrics', () => ({ getOrgUsageMetrics: vi.fn() }));
vi.mock('./model_access_enforcement', () => ({ getAccessibleModels: vi.fn() }));
vi.mock('./read_guardrails_policies', () => ({
  readGuardrailsPolicies: vi.fn(async () => [] as unknown[]),
}));
vi.mock('./schema', () => ({
  GOVERNANCE_POLICY_TYPES: ['retention_policy', 'feature_flags'],
}));
vi.mock('./soft_delete_helpers', () => ({ SOFT_DELETE_RESOURCE_CONFIG: {} }));
vi.mock('./soft_delete_validators', () => ({
  softDeleteResourceTypeValidator: 'softDeleteResourceType:validator',
}));

vi.mock('convex/values', () => {
  const stub = () => 'validator';
  return {
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
      any: stub,
      record: stub,
    },
    AppError: class AppError extends Error {
      data: unknown;
      constructor(data: unknown) {
        super(typeof data === 'string' ? data : JSON.stringify(data));
        this.data = data;
      }
    },
  };
});

// The `query` mock replaces the Convex builder with an identity function, so
// the runtime shape is `{ args, returns, handler }`. The module's static type
// stays the original Convex function reference, hence the narrowing here.
// Treated as a "third-party gap" per AGENTS.md.
//
// oxlint-disable-next-line typescript/no-explicit-any -- see above
type QueryHandler = { handler: (...args: unknown[]) => Promise<any> };
async function importQueries(): Promise<Record<string, QueryHandler>> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  return (await import('./queries')) as unknown as Record<string, QueryHandler>;
}

function createMockCtx(identity: unknown) {
  return {
    auth: {
      getUserIdentity: vi.fn(async () => identity),
    },
    db: {
      // The gates throw before any db read; a throwing stub proves it.
      query: vi.fn(() => {
        throw new Error('db should not be queried after a failed gate');
      }),
    },
  };
}

const AUTHED = { subject: 'user_1', email: 'member@example.com', name: 'Mem' };

// Each entry: the gated handler, the args it needs, and the code its FORBIDDEN
// (non-admin) branch must carry. UNAUTHENTICATED is asserted uniformly.
const ADMIN_GATED: Array<{
  name: string;
  args: Record<string, unknown>;
}> = [
  { name: 'getPendingRetentionChange', args: { organizationId: 'org_1' } },
  {
    name: 'getPolicy',
    // retention_policy is *not* member-readable -> sensitive, admin-only.
    args: { organizationId: 'org_1', policyType: 'retention_policy' },
  },
  {
    name: 'getUsageSummary',
    args: { organizationId: 'org_1' },
  },
  {
    name: 'getOrgUsageMetrics',
    args: {
      organizationId: 'org_1',
      periodDays: 7,
      granularity: 'daily',
    },
  },
  { name: 'listTrashedRows', args: { organizationId: 'org_1' } },
];

describe('governance/queries admin-gate error codes (#2016)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(ADMIN_GATED)(
    '$name throws AppError UNAUTHENTICATED when not signed in',
    async ({ name, args }) => {
      const handlers = await importQueries();
      const ctx = createMockCtx(null);
      await expect(handlers[name].handler(ctx, args)).rejects.toMatchObject({
        data: { code: 'UNAUTHENTICATED' },
      });
    },
  );

  it.each(ADMIN_GATED)(
    '$name throws AppError FORBIDDEN for a non-admin member',
    async ({ name, args }) => {
      mockGetOrganizationMember.mockResolvedValue({ role: 'member' });
      const handlers = await importQueries();
      const ctx = createMockCtx(AUTHED);
      await expect(handlers[name].handler(ctx, args)).rejects.toMatchObject({
        data: { code: 'FORBIDDEN' },
      });
    },
  );
});
