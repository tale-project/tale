import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AppError } from '../../lib/shared/errors/app-error';
import type { DsarGovernanceConfig } from '../../lib/shared/schemas/governance';
import { isLoosening } from './dsar_policy';

// The file-based DSAR policy path is split across several Convex functions.
// `proposeDsarPolicy`/`applyPendingDsarPolicyChange` are (internal) actions
// that delegate every read/write to internal functions via
// `ctx.runQuery`/`ctx.runMutation`/`ctx.runAction`; the audit + notify + db
// side effects live in the `recordDsarTighten`/`stageDsarLoosen`/
// `finalizeDsarApply` internal mutations. The api refs below are string
// sentinels so the mock ctx can route each `run*` call by reference.
vi.mock('../_generated/api', () => ({
  components: {
    betterAuth: { adapter: { findMany: 'betterAuth:adapter:findMany' } },
  },
  internal: {
    governance: {
      internal_queries: { verifyOrgMember: 'verifyOrgMember' },
      file_actions: {
        persistGovernancePolicyFile: 'persistGovernancePolicyFile',
      },
      dsar_policy: {
        readDsarStateInternal: 'readDsarStateInternal',
        recordDsarTighten: 'recordDsarTighten',
        stageDsarLoosen: 'stageDsarLoosen',
        applyPendingDsarPolicyChange: 'applyPendingDsarPolicyChange',
        finalizeDsarApply: 'finalizeDsarApply',
      },
    },
  },
}));

const mockGetAuthUser = vi.fn();
vi.mock('../auth', () => ({
  authComponent: {
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
}));

const mockGetOrganizationMember = vi.fn();
vi.mock('../lib/rls/organization/get_organization_member', () => ({
  getOrganizationMember: (...args: unknown[]) =>
    mockGetOrganizationMember(...args),
}));

const mockCreateAuditLog = vi.fn(
  async (..._args: unknown[]) => 'audit_id' as const,
);
vi.mock('../audit_logs/helpers', () => ({
  createAuditLog: (...args: unknown[]) => mockCreateAuditLog(...args),
}));

const mockWriteNotification = vi.fn();
vi.mock('../notifications/helpers', () => ({
  writeNotificationForOrgs: (...args: unknown[]) =>
    mockWriteNotification(...args),
}));

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutation: (config: Record<string, unknown>) => config,
    internalMutation: (config: Record<string, unknown>) => config,
    query: (config: Record<string, unknown>) => config,
    action: (config: Record<string, unknown>) => config,
    internalAction: (config: Record<string, unknown>) => config,
    internalQuery: (config: Record<string, unknown>) => config,
  };
});

// vi.mock above replaces Convex function builders with identity
// functions so the runtime shape is `{ args, returns, handler }`.
// Treated as a "third-party gap" per AGENTS.md.
//
// oxlint-disable-next-line typescript/no-explicit-any -- see above
type Handler = { handler: (...args: unknown[]) => Promise<any> };
async function loadDsarPolicy(): Promise<Record<string, Handler>> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  return (await import('./dsar_policy')) as unknown as Record<string, Handler>;
}

interface DbRow {
  _id: string;
  [k: string]: unknown;
}

interface IndexQ {
  eq: (field: string, value: unknown) => IndexQ;
  __filter: Record<string, unknown>;
}

function makeIndexQ(): IndexQ {
  const filter: Record<string, unknown> = {};
  const q: IndexQ = {
    eq(field, value) {
      filter[field] = value;
      return q;
    },
    __filter: filter,
  };
  return q;
}

interface IndexQueryBuilder {
  withIndex: (
    name: string,
    builder: (q: IndexQ) => IndexQ,
  ) => IndexQueryBuilder;
  first: () => Promise<DbRow | null>;
}

function buildQueryRunner(rows: DbRow[]): IndexQueryBuilder {
  let active: Record<string, unknown> = {};
  const builder: IndexQueryBuilder = {
    withIndex: (_name, fn) => {
      const q = makeIndexQ();
      fn(q);
      active = q.__filter;
      return builder;
    },
    first: async () =>
      rows.find((r) => Object.entries(active).every(([k, v]) => r[k] === v)) ??
      null,
  };
  return builder;
}

interface RunCall {
  ref: string;
  args: unknown;
}

interface MockState {
  /** Result returned by the `verifyOrgMember` internal query (action path). */
  member: { role: string };
  /** Result returned by the `readDsarStateInternal` internal query. */
  dsarState: {
    config: DsarGovernanceConfig;
    pending: { config: DsarGovernanceConfig; effectiveAt: number } | null;
  };
  /** Tables backing the db-using mutations (cancel + the internal mutations). */
  tables: Record<string, DbRow[]>;
  scheduled: { delayMs: number; ref: string; args: unknown }[];
  cancels: string[];
  deletes: string[];
  runMutations: RunCall[];
  runActions: RunCall[];
}

function emptyState(overrides: Partial<MockState> = {}): MockState {
  return {
    member: { role: 'owner' },
    dsarState: { config: { ...BASE_CONFIG }, pending: null },
    tables: {},
    scheduled: [],
    cancels: [],
    deletes: [],
    runMutations: [],
    runActions: [],
    ...overrides,
  };
}

function createMockCtx(state: MockState) {
  let nextId = 0;
  return {
    auth: {
      // Production uses getAuthUserIdentity (ctx.auth.getUserIdentity). Derive
      // the identity from the same mock source so test intent is preserved.
      getUserIdentity: vi.fn(async () => {
        const u = (await mockGetAuthUser()) as
          | { _id: string; email?: string; name?: string }
          | null
          | undefined;
        return u ? { subject: u._id, email: u.email, name: u.name } : null;
      }),
    },
    runQuery: vi.fn(async (ref: string, _args: unknown) => {
      if (ref === 'verifyOrgMember') return state.member;
      if (ref === 'readDsarStateInternal') return state.dsarState;
      throw new Error(`unexpected runQuery ref: ${ref}`);
    }),
    runMutation: vi.fn(async (ref: string, args: unknown) => {
      state.runMutations.push({ ref, args });
      return null;
    }),
    runAction: vi.fn(async (ref: string, args: unknown) => {
      state.runActions.push({ ref, args });
      return null;
    }),
    scheduler: {
      runAfter: vi.fn(async (delayMs: number, ref: string, args: unknown) => {
        state.scheduled.push({ delayMs, ref, args });
        return 'scheduled_job_id';
      }),
      cancel: vi.fn(async (id: string) => {
        state.cancels.push(id);
      }),
    },
    db: {
      query: vi.fn((table: string) =>
        buildQueryRunner(state.tables[table] ?? []),
      ),
      get: vi.fn(async (id: string) => {
        for (const rows of Object.values(state.tables)) {
          const m = rows.find((r) => r._id === id);
          if (m) return m;
        }
        return null;
      }),
      insert: vi.fn(async (table: string, doc: Record<string, unknown>) => {
        nextId++;
        const id = `${table}_${nextId}`;
        const list = state.tables[table] ?? (state.tables[table] = []);
        list.push({ _id: id, ...doc });
        return id;
      }),
      delete: vi.fn(async (id: string) => {
        state.deletes.push(id);
        for (const rows of Object.values(state.tables)) {
          const idx = rows.findIndex((r) => r._id === id);
          if (idx >= 0) {
            rows.splice(idx, 1);
            return;
          }
        }
      }),
    },
  };
}

const BASE_CONFIG: DsarGovernanceConfig = {
  coolingOffHours: 24,
  requireDualApproval: false,
  dailyLimitPerAdmin: 5,
};

const OWNER = { _id: 'owner_user', email: 'owner@example.com' };

describe('isLoosening', () => {
  const base = {
    coolingOffHours: 24,
    requireDualApproval: true,
    dailyLimitPerAdmin: 5,
  };
  it('detects shorter cooling-off as loosening', () => {
    expect(isLoosening(base, { ...base, coolingOffHours: 4 })).toBe(true);
  });
  it('detects disabling dual approval as loosening', () => {
    expect(isLoosening(base, { ...base, requireDualApproval: false })).toBe(
      true,
    );
  });
  it('detects raising daily limit as loosening', () => {
    expect(isLoosening(base, { ...base, dailyLimitPerAdmin: 50 })).toBe(true);
  });
  it('treats tightening as not loosening', () => {
    expect(isLoosening(base, { ...base, coolingOffHours: 48 })).toBe(false);
    expect(
      isLoosening(
        { ...base, requireDualApproval: false },
        { ...base, requireDualApproval: true },
      ),
    ).toBe(false);
    expect(isLoosening(base, { ...base, dailyLimitPerAdmin: 1 })).toBe(false);
  });
  it('mixed direction: any single loosening axis triggers true', () => {
    expect(
      isLoosening(base, {
        coolingOffHours: 4, // looser
        requireDualApproval: true,
        dailyLimitPerAdmin: 1, // tighter
      }),
    ).toBe(true);
  });
  it('no change returns false', () => {
    expect(isLoosening(base, { ...base })).toBe(false);
  });
});

describe('proposeDsarPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockResolvedValue(OWNER);
    mockWriteNotification.mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  it('refuses non-owner (admin) writes', async () => {
    const m = await loadDsarPolicy();
    const state = emptyState({ member: { role: 'admin' } });
    const ctx = createMockCtx(state);
    await expect(
      m.proposeDsarPolicy.handler(ctx, {
        organizationId: 'org_A',
        config: {
          coolingOffHours: 12,
          requireDualApproval: false,
          dailyLimitPerAdmin: 5,
        },
      }),
    ).rejects.toBeInstanceOf(AppError);
    // No file write or staging for a rejected caller.
    expect(state.runActions).toHaveLength(0);
    expect(state.runMutations).toHaveLength(0);
  });

  it('tightening writes the file immediately (no scheduled job)', async () => {
    const m = await loadDsarPolicy();
    const state = emptyState({
      member: { role: 'owner' },
      dsarState: {
        config: {
          coolingOffHours: 24,
          requireDualApproval: false,
          dailyLimitPerAdmin: 5,
        },
        pending: null,
      },
    });
    const ctx = createMockCtx(state);
    const result = await m.proposeDsarPolicy.handler(ctx, {
      organizationId: 'org_A',
      config: {
        coolingOffHours: 48, // tighter
        requireDualApproval: true, // tighter
        dailyLimitPerAdmin: 3, // tighter
      },
    });
    expect(result).toEqual({ applied: true });
    // No deferred apply scheduled for a tightening change.
    expect(state.scheduled).toHaveLength(0);
    // Policy file persisted with the tightened config.
    const persist = state.runActions.find(
      (c) => c.ref === 'persistGovernancePolicyFile',
    );
    expect(persist).toBeDefined();
    expect(persist?.args).toMatchObject({
      organizationId: 'org_A',
      policyType: 'dsar_governance',
      config: {
        coolingOffHours: 48,
        requireDualApproval: true,
        dailyLimitPerAdmin: 3,
      },
    });
    // Tighten audit + notify recorded.
    expect(state.runMutations.some((c) => c.ref === 'recordDsarTighten')).toBe(
      true,
    );
    expect(state.runMutations.some((c) => c.ref === 'stageDsarLoosen')).toBe(
      false,
    );
  });

  it('loosening stages as pending + schedules apply (file not changed yet)', async () => {
    const m = await loadDsarPolicy();
    const state = emptyState({
      member: { role: 'owner' },
      dsarState: {
        config: {
          coolingOffHours: 24,
          requireDualApproval: true,
          dailyLimitPerAdmin: 5,
        },
        pending: null,
      },
    });
    const ctx = createMockCtx(state);
    const result = await m.proposeDsarPolicy.handler(ctx, {
      organizationId: 'org_A',
      config: {
        coolingOffHours: 4, // looser
        requireDualApproval: true,
        dailyLimitPerAdmin: 5,
      },
    });
    expect(result.applied).toBe(false);
    expect(typeof result.effectiveAt).toBe('number');
    // File NOT written immediately for a loosening change.
    expect(
      state.runActions.some((c) => c.ref === 'persistGovernancePolicyFile'),
    ).toBe(false);
    // Deferred apply scheduled 24h out.
    expect(state.scheduled).toHaveLength(1);
    expect(state.scheduled[0]?.delayMs).toBe(24 * 60 * 60 * 1000);
    expect(state.scheduled[0]?.ref).toBe('applyPendingDsarPolicyChange');
    // Loosening staged with the proposed config.
    const stage = state.runMutations.find((c) => c.ref === 'stageDsarLoosen');
    expect(stage).toBeDefined();
    expect(stage?.args).toMatchObject({
      organizationId: 'org_A',
      pendingConfig: { coolingOffHours: 4 },
      proposedBy: 'owner_user',
    });
  });

  it('refuses when a pending change is already staged', async () => {
    const m = await loadDsarPolicy();
    const state = emptyState({
      member: { role: 'owner' },
      dsarState: {
        config: {
          coolingOffHours: 24,
          requireDualApproval: false,
          dailyLimitPerAdmin: 5,
        },
        pending: {
          config: {
            coolingOffHours: 4,
            requireDualApproval: false,
            dailyLimitPerAdmin: 5,
          },
          effectiveAt: Date.now() + 60_000,
        },
      },
    });
    const ctx = createMockCtx(state);
    await expect(
      m.proposeDsarPolicy.handler(ctx, {
        organizationId: 'org_A',
        config: {
          coolingOffHours: 12,
          requireDualApproval: false,
          dailyLimitPerAdmin: 5,
        },
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(state.scheduled).toHaveLength(0);
    expect(state.runActions).toHaveLength(0);
  });
});

describe('recordDsarTighten / stageDsarLoosen (internal mutations)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteNotification.mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  it('recordDsarTighten audits + notifies', async () => {
    const m = await loadDsarPolicy();
    const state = emptyState();
    const ctx = createMockCtx(state);
    await m.recordDsarTighten.handler(ctx, {
      organizationId: 'org_A',
      previousConfig: { coolingOffHours: 24 },
      nextConfig: { coolingOffHours: 48 },
      actorId: 'owner_user',
      actorEmail: 'owner@example.com',
    });
    const auditCall = mockCreateAuditLog.mock.calls.find((c) => {
      const p = c[1] as { action?: string };
      return p.action === 'dsar_governance_policy_tightened';
    });
    expect(auditCall).toBeDefined();
    expect(mockWriteNotification).toHaveBeenCalled();
  });

  it('stageDsarLoosen inserts the pending row, audits + notifies', async () => {
    const m = await loadDsarPolicy();
    const state = emptyState();
    const ctx = createMockCtx(state);
    await m.stageDsarLoosen.handler(ctx, {
      organizationId: 'org_A',
      pendingConfig: {
        coolingOffHours: 4,
        requireDualApproval: false,
        dailyLimitPerAdmin: 5,
      },
      effectiveAt: Date.now() + 24 * 60 * 60 * 1000,
      proposedBy: 'owner_user',
      proposedByEmail: 'owner@example.com',
      proposedAt: Date.now(),
      scheduledJobId: 'scheduled_job_id',
      previousConfig: BASE_CONFIG,
    });
    const pendingRow = state.tables.dsarPolicyPendingChanges?.[0];
    expect(pendingRow?.organizationId).toBe('org_A');
    expect(pendingRow?.proposedBy).toBe('owner_user');
    const notifCall = mockWriteNotification.mock.calls.find((c) => {
      const args = c[1] as { titleKey?: string };
      return args.titleKey === 'dsarPolicyLoosenProposed';
    });
    expect(notifCall).toBeDefined();
  });
});

describe('cancelPendingDsarPolicyChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockResolvedValue(OWNER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    mockWriteNotification.mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  it('admin (not just owner) can cancel; scheduler.cancel called; pending row deleted', async () => {
    const m = await loadDsarPolicy();
    const state = emptyState({
      tables: {
        dsarPolicyPendingChanges: [
          {
            _id: 'pending_1',
            organizationId: 'org_A',
            pendingConfig: {
              coolingOffHours: 4,
              requireDualApproval: false,
              dailyLimitPerAdmin: 50,
            },
            effectiveAt: Date.now() + 60_000,
            proposedBy: 'owner_user',
            proposedAt: Date.now(),
            scheduledJobId: 'scheduled_job_id',
          },
        ],
      },
    });
    const ctx = createMockCtx(state);
    await m.cancelPendingDsarPolicyChange.handler(ctx, {
      organizationId: 'org_A',
    });
    expect(state.cancels).toContain('scheduled_job_id');
    expect(state.deletes).toContain('pending_1');
    expect(state.tables.dsarPolicyPendingChanges).toHaveLength(0);
    const notifCall = mockWriteNotification.mock.calls.find((c) => {
      const args = c[1] as { titleKey?: string };
      return args.titleKey === 'dsarPolicyLoosenCancelled';
    });
    expect(notifCall).toBeDefined();
  });

  it('refuses when no pending change exists', async () => {
    const m = await loadDsarPolicy();
    const state = emptyState({ tables: { dsarPolicyPendingChanges: [] } });
    const ctx = createMockCtx(state);
    await expect(
      m.cancelPendingDsarPolicyChange.handler(ctx, {
        organizationId: 'org_A',
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('refuses a non-admin, non-owner caller', async () => {
    mockGetOrganizationMember.mockResolvedValue({ role: 'member' });
    const m = await loadDsarPolicy();
    const state = emptyState({
      tables: {
        dsarPolicyPendingChanges: [
          {
            _id: 'pending_1',
            organizationId: 'org_A',
            pendingConfig: BASE_CONFIG,
            effectiveAt: Date.now() + 60_000,
            proposedBy: 'owner_user',
            proposedAt: Date.now(),
          },
        ],
      },
    });
    const ctx = createMockCtx(state);
    await expect(
      m.cancelPendingDsarPolicyChange.handler(ctx, {
        organizationId: 'org_A',
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(state.cancels).toHaveLength(0);
    expect(state.deletes).toHaveLength(0);
  });
});

describe('applyPendingDsarPolicyChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteNotification.mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  it('writes the staged file + finalizes when the window has elapsed', async () => {
    const m = await loadDsarPolicy();
    const state = emptyState({
      dsarState: {
        config: BASE_CONFIG,
        pending: {
          config: {
            coolingOffHours: 4,
            requireDualApproval: false,
            dailyLimitPerAdmin: 50,
          },
          effectiveAt: Date.now() - 1000, // already elapsed
        },
      },
    });
    const ctx = createMockCtx(state);
    await m.applyPendingDsarPolicyChange.handler(ctx, {
      organizationId: 'org_A',
    });
    const persist = state.runActions.find(
      (c) => c.ref === 'persistGovernancePolicyFile',
    );
    expect(persist).toBeDefined();
    expect(persist?.args).toMatchObject({
      policyType: 'dsar_governance',
      config: { coolingOffHours: 4, dailyLimitPerAdmin: 50 },
    });
    expect(state.runMutations.some((c) => c.ref === 'finalizeDsarApply')).toBe(
      true,
    );
  });

  it('no-op when the window has not yet elapsed', async () => {
    const m = await loadDsarPolicy();
    const state = emptyState({
      dsarState: {
        config: BASE_CONFIG,
        pending: {
          config: { ...BASE_CONFIG, coolingOffHours: 4 },
          effectiveAt: Date.now() + 60_000, // not yet due
        },
      },
    });
    const ctx = createMockCtx(state);
    await m.applyPendingDsarPolicyChange.handler(ctx, {
      organizationId: 'org_A',
    });
    expect(state.runActions).toHaveLength(0);
    expect(state.runMutations).toHaveLength(0);
  });

  it('idempotent: no-op when there is no pending change (e.g. cancelled)', async () => {
    const m = await loadDsarPolicy();
    const state = emptyState({
      dsarState: { config: BASE_CONFIG, pending: null },
    });
    const ctx = createMockCtx(state);
    await m.applyPendingDsarPolicyChange.handler(ctx, {
      organizationId: 'org_A',
    });
    expect(state.runActions).toHaveLength(0);
    expect(state.runMutations).toHaveLength(0);
    expect(mockWriteNotification).not.toHaveBeenCalled();
  });
});

// #2016: the read gate must throw `AppError({ code })` so the client can
// branch — UNAUTHENTICATED when signed out, FORBIDDEN for a non-admin/owner.
// Message-only assertions would pass against a raw throw, so assert data.code.
describe('getDsarPolicyForUi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws AppError UNAUTHENTICATED when not signed in', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const m = await loadDsarPolicy();
    const ctx = createMockCtx(emptyState());
    await expect(
      m.getDsarPolicyForUi.handler(ctx, { organizationId: 'org_A' }),
    ).rejects.toMatchObject({ data: { code: 'UNAUTHENTICATED' } });
    await expect(
      m.getDsarPolicyForUi.handler(ctx, { organizationId: 'org_A' }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('throws AppError FORBIDDEN for a non-admin/owner member', async () => {
    mockGetAuthUser.mockResolvedValue({
      _id: 'member_user',
      email: 'member@example.com',
    });
    mockGetOrganizationMember.mockResolvedValue({ role: 'member' });
    const m = await loadDsarPolicy();
    const ctx = createMockCtx(emptyState());
    await expect(
      m.getDsarPolicyForUi.handler(ctx, { organizationId: 'org_A' }),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
  });
});
