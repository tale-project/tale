import { ConvexError } from 'convex/values';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isLoosening } from './dsar_policy';

vi.mock('../_generated/api', () => ({
  components: {
    betterAuth: { adapter: { findMany: 'betterAuth:adapter:findMany' } },
  },
  internal: {
    governance: {
      dsar_policy: {
        applyPendingDsarPolicyChange: 'applyPendingDsarPolicyChange',
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

interface MockState {
  tables: Record<string, DbRow[]>;
  scheduled: { delayMs: number; ref: string; args: unknown }[];
  cancels: string[];
}

function createMockCtx(state: MockState) {
  let nextId = 0;
  return {
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
      patch: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        for (const rows of Object.values(state.tables)) {
          const idx = rows.findIndex((r) => r._id === id);
          if (idx >= 0) {
            // simulate Convex behavior: undefined values clear the field
            const merged: Record<string, unknown> = { ...rows[idx] };
            for (const [k, v] of Object.entries(patch)) {
              if (v === undefined) delete merged[k];
              else merged[k] = v;
            }
            rows[idx] = merged as DbRow;
            return;
          }
        }
      }),
      insert: vi.fn(async (table: string, doc: Record<string, unknown>) => {
        nextId++;
        const id = `${table}_${nextId}`;
        const list = state.tables[table] ?? (state.tables[table] = []);
        list.push({ _id: id, ...doc });
        return id;
      }),
    },
    scheduler: {
      runAfter: vi.fn(async (delayMs: number, ref: string, args: unknown) => {
        const id = `job_${state.scheduled.length}`;
        state.scheduled.push({ delayMs, ref, args });
        return id;
      }),
      cancel: vi.fn(async (id: string) => {
        state.cancels.push(id);
      }),
    },
  };
}

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
    mockGetOrganizationMember.mockResolvedValue({ role: 'owner' });
    mockWriteNotification.mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  it('refuses non-owner (admin) writes', async () => {
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    const m = await loadDsarPolicy();
    const state: MockState = { tables: {}, scheduled: [], cancels: [] };
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
    ).rejects.toBeInstanceOf(ConvexError);
  });

  it('tightening applies immediately (no scheduled job, audit + notify)', async () => {
    const m = await loadDsarPolicy();
    const state: MockState = {
      tables: {
        governancePolicies: [
          {
            _id: 'policy_1',
            organizationId: 'org_A',
            policyType: 'dsar_governance',
            config: {
              coolingOffHours: 24,
              requireDualApproval: false,
              dailyLimitPerAdmin: 5,
            },
          },
        ],
      },
      scheduled: [],
      cancels: [],
    };
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
    expect(state.scheduled).toHaveLength(0);
    const row = state.tables.governancePolicies?.[0];
    const cfg = row?.config as Record<string, unknown>;
    expect(cfg.coolingOffHours).toBe(48);
    expect(cfg.requireDualApproval).toBe(true);
    expect(cfg.dailyLimitPerAdmin).toBe(3);
    // audit + notify fired
    const auditCall = mockCreateAuditLog.mock.calls.find((c) => {
      const p = c[1] as { action?: string };
      return p.action === 'dsar_governance_policy_tightened';
    });
    expect(auditCall).toBeDefined();
    expect(mockWriteNotification).toHaveBeenCalled();
  });

  it('loosening stages as pending + schedules apply (config not changed yet)', async () => {
    const m = await loadDsarPolicy();
    const state: MockState = {
      tables: {
        governancePolicies: [
          {
            _id: 'policy_1',
            organizationId: 'org_A',
            policyType: 'dsar_governance',
            config: {
              coolingOffHours: 24,
              requireDualApproval: true,
              dailyLimitPerAdmin: 5,
            },
          },
        ],
      },
      scheduled: [],
      cancels: [],
    };
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
    // config NOT changed yet
    const row = state.tables.governancePolicies?.[0];
    const cfg = row?.config as Record<string, unknown>;
    expect(cfg.coolingOffHours).toBe(24);
    // pending fields populated
    const pending = row?.pendingConfig as Record<string, unknown>;
    expect(pending.coolingOffHours).toBe(4);
    expect(row?.pendingProposedBy).toBe('owner_user');
    // scheduled apply with 24h delay
    expect(state.scheduled).toHaveLength(1);
    expect(state.scheduled[0]?.delayMs).toBe(24 * 60 * 60 * 1000);
    // notification fired
    const notifCall = mockWriteNotification.mock.calls.find((c) => {
      const args = c[1] as { titleKey?: string };
      return args.titleKey === 'dsarPolicyLoosenProposed';
    });
    expect(notifCall).toBeDefined();
  });

  it('refuses when a pending change is already staged', async () => {
    const m = await loadDsarPolicy();
    const state: MockState = {
      tables: {
        governancePolicies: [
          {
            _id: 'policy_1',
            organizationId: 'org_A',
            policyType: 'dsar_governance',
            config: {
              coolingOffHours: 24,
              requireDualApproval: false,
              dailyLimitPerAdmin: 5,
            },
            pendingConfig: {
              coolingOffHours: 4,
              requireDualApproval: false,
              dailyLimitPerAdmin: 5,
            },
            pendingEffectiveAt: Date.now() + 60_000,
            pendingProposedBy: 'owner_user',
            pendingProposedAt: Date.now(),
          },
        ],
      },
      scheduled: [],
      cancels: [],
    };
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
    ).rejects.toBeInstanceOf(ConvexError);
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

  it('admin (not just owner) can cancel pending change; scheduler.cancel called; pending fields cleared', async () => {
    const m = await loadDsarPolicy();
    const state: MockState = {
      tables: {
        governancePolicies: [
          {
            _id: 'policy_1',
            organizationId: 'org_A',
            policyType: 'dsar_governance',
            config: {
              coolingOffHours: 24,
              requireDualApproval: true,
              dailyLimitPerAdmin: 5,
            },
            pendingConfig: {
              coolingOffHours: 4,
              requireDualApproval: false,
              dailyLimitPerAdmin: 50,
            },
            pendingEffectiveAt: Date.now() + 60_000,
            pendingProposedBy: 'owner_user',
            pendingProposedAt: Date.now(),
            pendingScheduledJobId: 'scheduled_job_id',
          },
        ],
      },
      scheduled: [],
      cancels: [],
    };
    const ctx = createMockCtx(state);
    await m.cancelPendingDsarPolicyChange.handler(ctx, {
      organizationId: 'org_A',
    });
    expect(state.cancels).toContain('scheduled_job_id');
    const row = state.tables.governancePolicies?.[0];
    expect(row?.pendingConfig).toBeUndefined();
    expect(row?.pendingEffectiveAt).toBeUndefined();
    expect(row?.pendingScheduledJobId).toBeUndefined();
    // config NOT changed
    const cfg = row?.config as Record<string, unknown>;
    expect(cfg.coolingOffHours).toBe(24);
    // notification fired
    const notifCall = mockWriteNotification.mock.calls.find((c) => {
      const args = c[1] as { titleKey?: string };
      return args.titleKey === 'dsarPolicyLoosenCancelled';
    });
    expect(notifCall).toBeDefined();
  });

  it('refuses when no pending change exists', async () => {
    const m = await loadDsarPolicy();
    const state: MockState = {
      tables: {
        governancePolicies: [
          {
            _id: 'policy_1',
            organizationId: 'org_A',
            policyType: 'dsar_governance',
            config: {
              coolingOffHours: 24,
              requireDualApproval: false,
              dailyLimitPerAdmin: 5,
            },
          },
        ],
      },
      scheduled: [],
      cancels: [],
    };
    const ctx = createMockCtx(state);
    await expect(
      m.cancelPendingDsarPolicyChange.handler(ctx, {
        organizationId: 'org_A',
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });
});

describe('applyPendingDsarPolicyChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteNotification.mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  it('flips config = pendingConfig and clears pending fields when window has elapsed', async () => {
    const m = await loadDsarPolicy();
    const state: MockState = {
      tables: {
        governancePolicies: [
          {
            _id: 'policy_1',
            organizationId: 'org_A',
            policyType: 'dsar_governance',
            config: {
              coolingOffHours: 24,
              requireDualApproval: true,
              dailyLimitPerAdmin: 5,
            },
            pendingConfig: {
              coolingOffHours: 4,
              requireDualApproval: false,
              dailyLimitPerAdmin: 50,
            },
            pendingEffectiveAt: Date.now() - 1000, // already elapsed
            pendingProposedBy: 'owner_user',
            pendingProposedAt: Date.now() - 24 * 60 * 60 * 1000,
            pendingScheduledJobId: 'scheduled_job_id',
          },
        ],
      },
      scheduled: [],
      cancels: [],
    };
    const ctx = createMockCtx(state);
    await m.applyPendingDsarPolicyChange.handler(ctx, {
      organizationId: 'org_A',
    });
    const row = state.tables.governancePolicies?.[0];
    const cfg = row?.config as Record<string, unknown>;
    expect(cfg.coolingOffHours).toBe(4);
    expect(cfg.requireDualApproval).toBe(false);
    expect(cfg.dailyLimitPerAdmin).toBe(50);
    expect(row?.pendingConfig).toBeUndefined();
    expect(row?.pendingEffectiveAt).toBeUndefined();
    // applied notification + audit
    const notifCall = mockWriteNotification.mock.calls.find((c) => {
      const args = c[1] as { titleKey?: string };
      return args.titleKey === 'dsarPolicyLoosenApplied';
    });
    expect(notifCall).toBeDefined();
  });

  it('idempotent: no-op when pendingConfig already cleared (e.g. cancelled)', async () => {
    const m = await loadDsarPolicy();
    const state: MockState = {
      tables: {
        governancePolicies: [
          {
            _id: 'policy_1',
            organizationId: 'org_A',
            policyType: 'dsar_governance',
            config: {
              coolingOffHours: 24,
              requireDualApproval: true,
              dailyLimitPerAdmin: 5,
            },
            // no pendingConfig
          },
        ],
      },
      scheduled: [],
      cancels: [],
    };
    const ctx = createMockCtx(state);
    await m.applyPendingDsarPolicyChange.handler(ctx, {
      organizationId: 'org_A',
    });
    // config unchanged
    const row = state.tables.governancePolicies?.[0];
    const cfg = row?.config as Record<string, unknown>;
    expect(cfg.coolingOffHours).toBe(24);
    expect(mockWriteNotification).not.toHaveBeenCalled();
  });
});
