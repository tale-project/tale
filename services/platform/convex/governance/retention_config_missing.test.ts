import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regression coverage for #1997: opening Governance "Policies & Limits"
// on a fresh org (no retention.json installed yet) used to log three
// `ConvexError(RETENTION_CONFIG_MISSING)` because the read-only actions
// threw instead of returning an "empty state". These tests pin the
// graceful behaviour: the READ paths return null / empty bounds, while
// the WRITE path still throws (you cannot save against bounds the
// operator has not installed).

// String sentinels so the mock ctx can route each `run*` call by ref.
vi.mock('../_generated/api', () => ({
  internal: {
    governance: {
      internal_queries: {
        verifyOrgMember: 'verifyOrgMember',
        verifyOrgAdmin: 'verifyOrgAdmin',
        getAppliedBounds: 'getAppliedBounds',
        getRetentionPolicyForOrg: 'getRetentionPolicyForOrg',
      },
    },
    lib: {
      config_store: {
        actions: { readConfigArea: 'readConfigArea' },
      },
    },
  },
}));

const mockResolveOrgSlug = vi.fn(async (..._args: unknown[]) => 'acme');
vi.mock('../organizations/resolve_org_slug', () => ({
  resolveOrgSlug: (...args: unknown[]) => mockResolveOrgSlug(...args),
}));

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    action: (config: Record<string, unknown>) => config,
    internalAction: (config: Record<string, unknown>) => config,
  };
});

// vi.mock above replaces the Convex function builders with identity
// functions so the runtime shape is `{ args, returns, handler }`.
//
// oxlint-disable-next-line typescript/no-explicit-any -- third-party gap (see AGENTS.md)
type Handler = { handler: (...args: unknown[]) => Promise<any> };

async function loadActions(): Promise<Record<string, Handler>> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  return (await import('./retention_actions')) as unknown as Record<
    string,
    Handler
  >;
}

async function loadProposal(): Promise<Record<string, Handler>> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  return (await import('./retention_bounds_proposal')) as unknown as Record<
    string,
    Handler
  >;
}

interface RunCall {
  ref: string;
  args: unknown;
}

interface MockOptions {
  /** Value `readConfigArea` resolves to (null = config not installed). */
  configArea?: unknown;
  /** Identity returned by `ctx.auth.getUserIdentity`. */
  identity?: { subject: string; email?: string; name?: string } | null;
  /** Value the `verifyOrgAdmin` query resolves to (write paths). */
  member?: unknown;
}

function createMockCtx(opts: MockOptions = {}) {
  const runQueries: RunCall[] = [];
  const runActions: RunCall[] = [];
  const ctx = {
    auth: {
      getUserIdentity: vi.fn(async () =>
        opts.identity === undefined
          ? { subject: 'user_1', email: 'a@example.com', name: 'A' }
          : opts.identity,
      ),
    },
    runQuery: vi.fn(async (ref: string, args: unknown) => {
      runQueries.push({ ref, args });
      if (ref === 'verifyOrgMember') return { role: 'member' };
      if (ref === 'verifyOrgAdmin') return opts.member ?? { role: 'admin' };
      if (ref === 'getAppliedBounds') return null;
      if (ref === 'getRetentionPolicyForOrg') return null;
      throw new Error(`unexpected runQuery ref: ${ref}`);
    }),
    runAction: vi.fn(async (ref: string, args: unknown) => {
      runActions.push({ ref, args });
      if (ref === 'readConfigArea') return opts.configArea ?? null;
      throw new Error(`unexpected runAction ref: ${ref}`);
    }),
  };
  return { ctx, runQueries, runActions };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.TALE_RETENTION_DISABLED;
});

describe('getRetentionBoundsAction with missing config', () => {
  it('returns empty bounds instead of throwing RETENTION_CONFIG_MISSING', async () => {
    const m = await loadActions();
    const { ctx } = createMockCtx({ configArea: null });
    const result = await m.getRetentionBoundsAction.handler(ctx, {
      organizationId: 'org_A',
    });
    expect(result).toEqual({ bounds: [], retentionDisabled: false });
  });

  it('still reports retentionDisabled from the env flag', async () => {
    process.env.TALE_RETENTION_DISABLED = 'true';
    const m = await loadActions();
    const { ctx } = createMockCtx({ configArea: null });
    const result = await m.getRetentionBoundsAction.handler(ctx, {
      organizationId: 'org_A',
    });
    expect(result).toEqual({ bounds: [], retentionDisabled: true });
  });
});

describe('getPendingBoundsProposal with missing config', () => {
  it('returns null instead of throwing RETENTION_CONFIG_MISSING', async () => {
    const m = await loadProposal();
    const { ctx, runQueries } = createMockCtx({ configArea: null });
    const result = await m.getPendingBoundsProposal.handler(ctx, {
      organizationId: 'org_A',
    });
    expect(result).toBeNull();
    // Bails out before reading applied bounds — nothing to propose.
    expect(runQueries.some((c) => c.ref === 'getAppliedBounds')).toBe(false);
  });
});

describe('upsertRetentionPolicyAction with missing config', () => {
  it('still throws RETENTION_CONFIG_MISSING (write path unchanged)', async () => {
    const m = await loadActions();
    const { ctx } = createMockCtx({ configArea: null });
    await expect(
      m.upsertRetentionPolicyAction.handler(ctx, {
        organizationId: 'org_A',
        config: { documentsRetentionDays: 90 },
      }),
    ).rejects.toMatchObject({
      data: { code: 'RETENTION_CONFIG_MISSING' },
    });
  });

  it('the rejection is a ConvexError', async () => {
    const m = await loadActions();
    const { ctx } = createMockCtx({ configArea: null });
    await expect(
      m.upsertRetentionPolicyAction.handler(ctx, {
        organizationId: 'org_A',
        config: { documentsRetentionDays: 90 },
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });
});
