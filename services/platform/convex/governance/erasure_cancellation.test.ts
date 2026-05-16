import { ConvexError } from 'convex/values';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../_generated/api', () => ({
  components: {
    betterAuth: { adapter: { findMany: 'betterAuth:adapter:findMany' } },
  },
  internal: {
    governance: {
      erasure: {
        beginProcessing: 'beginProcessing',
        eraseThreadById: 'eraseThreadById',
        finalizeProcessing: 'finalizeProcessing',
        eraseSubjectDocuments: 'eraseSubjectDocuments',
        eraseSubjectUserMemories: 'eraseSubjectUserMemories',
        eraseSubjectUserPreferences: 'eraseSubjectUserPreferences',
        eraseSubjectMessageFeedback: 'eraseSubjectMessageFeedback',
        eraseSubjectFileMetadata: 'eraseSubjectFileMetadata',
        eraseSubjectUsageLedger: 'eraseSubjectUsageLedger',
        eraseSubjectTwoFactorAttempts: 'eraseSubjectTwoFactorAttempts',
        eraseSubjectPolicyAcknowledgements:
          'eraseSubjectPolicyAcknowledgements',
        eraseSubjectOnedrive: 'eraseSubjectOnedrive',
        eraseSubjectLoginAttempts: 'eraseSubjectLoginAttempts',
        eraseSubjectNotifications: 'eraseSubjectNotifications',
        lookupSubjectEmail: 'lookupSubjectEmail',
        processErasureRequest: 'processErasureRequest',
        confirmAndScheduleErasure: 'confirmAndScheduleErasure',
      },
    },
    audit_logs: {
      internal_mutations: {
        createAuditLog: 'createAuditLog',
        scrubSubjectAuditLogs: 'scrubSubjectAuditLogs',
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

vi.mock('../lib/helpers/pii_hash', () => ({
  hashEmailForAudit: vi.fn(),
}));

vi.mock('../lib/helpers/rag_config', () => ({
  ragFetch: vi.fn(),
}));

vi.mock('../threads/cascade_helpers', () => ({
  cascadeDeleteThreadChildren: vi.fn(),
}));

vi.mock('./erase_document_blobs', () => ({
  eraseDocumentBlobs: vi.fn(),
}));

vi.mock('./legal_hold', () => ({
  loadActiveHolds: vi.fn(async () => ({
    orgHeld: false,
    userMembershipIds: new Set<string>(),
  })),
}));

const mockRateLimit = vi.fn();
vi.mock('../lib/rate_limiter', () => ({
  rateLimiter: {
    limit: (...args: unknown[]) => mockRateLimit(...args),
  },
}));

const mockGetDsarPolicy = vi.fn();
vi.mock('./dsar_policy', () => ({
  getDsarPolicy: (...args: unknown[]) => mockGetDsarPolicy(...args),
}));

const mockWriteNotification = vi.fn();
vi.mock('../notifications/helpers', () => ({
  writeNotificationForOrgs: (...args: unknown[]) =>
    mockWriteNotification(...args),
}));

vi.mock('../approvals/helpers', () => ({
  createApproval: vi.fn(async () => 'approval_id'),
}));

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutation: (config: Record<string, unknown>) => config,
    internalMutation: (config: Record<string, unknown>) => config,
    internalAction: (config: Record<string, unknown>) => config,
  };
});

// vi.mock above replaces Convex function builders with identity
// functions so the runtime shape is `{ args, returns, handler }`.
// Treated as a "third-party gap" per AGENTS.md.
//
// oxlint-disable-next-line typescript/no-explicit-any -- see above
type ErasureHandler = { handler: (...args: unknown[]) => Promise<any> };
async function loadErasure(): Promise<Record<string, ErasureHandler>> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  return (await import('./erasure')) as unknown as Record<
    string,
    ErasureHandler
  >;
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
  [Symbol.asyncIterator]: () => AsyncIterator<DbRow>;
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
    [Symbol.asyncIterator]: () => {
      const matches = rows.filter((r) =>
        Object.entries(active).every(([k, v]) => r[k] === v),
      );
      let i = 0;
      return {
        async next() {
          if (i >= matches.length) {
            return { value: undefined as never, done: true };
          }
          const value = matches[i];
          i++;
          return { value, done: false };
        },
      };
    },
  };
  return builder;
}

interface MockState {
  tables: Record<string, DbRow[]>;
  patches: { id: string; patch: Record<string, unknown> }[];
  inserts: { table: string; doc: Record<string, unknown> }[];
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
        state.patches.push({ id, patch });
        for (const rows of Object.values(state.tables)) {
          const idx = rows.findIndex((r) => r._id === id);
          if (idx >= 0) {
            rows[idx] = { ...rows[idx], ...patch };
            return;
          }
        }
      }),
      insert: vi.fn(async (table: string, doc: Record<string, unknown>) => {
        nextId++;
        const id = `${table}_${nextId}`;
        state.inserts.push({ table, doc });
        const list = state.tables[table] ?? (state.tables[table] = []);
        list.push({ _id: id, ...doc });
        return id;
      }),
    },
    runMutation: vi.fn(async (..._args: unknown[]) => null),
    scheduler: {
      runAfter: vi.fn(async () => 'scheduled_job_id'),
      cancel: vi.fn(async (id: string) => {
        state.cancels.push(id);
      }),
    },
  };
}

const ADMIN = { _id: 'admin_user', email: 'admin@example.com' };

describe('cancelErasureRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockResolvedValue(ADMIN);
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    mockRateLimit.mockResolvedValue({ ok: true, retryAfter: 0 });
    mockWriteNotification.mockResolvedValue(undefined);
    mockGetDsarPolicy.mockResolvedValue({
      coolingOffHours: 24,
      requireDualApproval: false,
      dailyLimitPerAdmin: 5,
    });
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  it('happy path: pending row in cooling-off → cancelled, scheduler.cancel called, notification fan-out, claim cleared', async () => {
    const erasure = await loadErasure();
    const futureEffectiveAt = Date.now() + 24 * 60 * 60 * 1000;
    const state: MockState = {
      tables: {
        gdprErasureRequests: [
          {
            _id: 'er_1',
            status: 'pending',
            organizationId: 'org_A',
            targetUserId: 'subject',
            requestedBy: 'admin_user',
            effectiveAt: futureEffectiveAt,
            scheduledJobId: 'scheduled_job_id',
          },
        ],
        activeErasureClaims: [
          {
            _id: 'claim_1',
            organizationId: 'org_A',
            targetUserId: 'subject',
            requestId: 'er_1',
            claimedAt: Date.now(),
          },
        ],
      },
      patches: [],
      inserts: [],
      cancels: [],
    };
    const ctx = createMockCtx(state);
    await erasure.cancelErasureRequest.handler(ctx, {
      requestId: 'er_1',
      cancellationReason: 'Subject withdrew the request via HR ticket',
    });

    // status flipped + cancellation fields written
    const row = state.tables.gdprErasureRequests?.[0];
    expect(row?.status).toBe('cancelled');
    expect(row?.cancelledBy).toBe('admin_user');
    expect(row?.cancellationReason).toContain('HR ticket');
    // scheduler cancel was called
    expect(state.cancels).toContain('scheduled_job_id');
    // claim cleared
    expect(state.tables.activeErasureClaims?.[0]?.requestId).toBeUndefined();
    // notification fan-out
    expect(mockWriteNotification).toHaveBeenCalled();
    // audit log emitted
    const auditCall = mockCreateAuditLog.mock.calls.find((c) => {
      const payload = c[1] as { action?: string };
      return payload.action === 'gdpr_erasure_cancelled';
    });
    expect(auditCall).toBeDefined();
  });

  it('refuses when cooling-off window has elapsed', async () => {
    const erasure = await loadErasure();
    const pastEffectiveAt = Date.now() - 1000; // already lapsed
    const state: MockState = {
      tables: {
        gdprErasureRequests: [
          {
            _id: 'er_2',
            status: 'pending',
            organizationId: 'org_A',
            targetUserId: 'subject',
            requestedBy: 'admin_user',
            effectiveAt: pastEffectiveAt,
            scheduledJobId: 'scheduled_job_id',
          },
        ],
      },
      patches: [],
      inserts: [],
      cancels: [],
    };
    const ctx = createMockCtx(state);
    await expect(
      erasure.cancelErasureRequest.handler(ctx, {
        requestId: 'er_2',
        cancellationReason: 'Too late to cancel',
      }),
    ).rejects.toBeInstanceOf(ConvexError);
    // No state changes
    expect(state.tables.gdprErasureRequests?.[0]?.status).toBe('pending');
    expect(state.cancels).toHaveLength(0);
  });

  it('refuses when caller is not an admin', async () => {
    mockGetOrganizationMember.mockResolvedValue({ role: 'member' });
    const erasure = await loadErasure();
    const state: MockState = {
      tables: {
        gdprErasureRequests: [
          {
            _id: 'er_3',
            status: 'pending',
            organizationId: 'org_A',
            targetUserId: 'subject',
            requestedBy: 'admin_user',
            effectiveAt: Date.now() + 60_000,
            scheduledJobId: 'scheduled_job_id',
          },
        ],
      },
      patches: [],
      inserts: [],
      cancels: [],
    };
    const ctx = createMockCtx(state);
    await expect(
      erasure.cancelErasureRequest.handler(ctx, {
        requestId: 'er_3',
        cancellationReason: 'Not authorized to do this',
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  it('refuses when reason is shorter than 10 characters', async () => {
    const erasure = await loadErasure();
    const state: MockState = {
      tables: {
        gdprErasureRequests: [
          {
            _id: 'er_4',
            status: 'pending',
            organizationId: 'org_A',
            targetUserId: 'subject',
            requestedBy: 'admin_user',
            effectiveAt: Date.now() + 60_000,
          },
        ],
      },
      patches: [],
      inserts: [],
      cancels: [],
    };
    const ctx = createMockCtx(state);
    await expect(
      erasure.cancelErasureRequest.handler(ctx, {
        requestId: 'er_4',
        cancellationReason: 'short',
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });
});

describe('requestErasure self-deletion + rate-limit guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockResolvedValue(ADMIN);
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    mockRateLimit.mockResolvedValue({ ok: true, retryAfter: 0 });
    mockWriteNotification.mockResolvedValue(undefined);
    mockGetDsarPolicy.mockResolvedValue({
      coolingOffHours: 0,
      requireDualApproval: false,
      dailyLimitPerAdmin: 5,
    });
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  it('rejects when admin attempts to file against themselves', async () => {
    const erasure = await loadErasure();
    const state: MockState = {
      tables: {},
      patches: [],
      inserts: [],
      cancels: [],
    };
    const ctx = createMockCtx(state);
    await expect(
      erasure.requestErasure.handler(ctx, {
        organizationId: 'org_A',
        userId: 'admin_user', // === callerId
        reason: 'self-deletion attempt',
        reasonCode: 'consent_withdrawn',
      }),
    ).rejects.toBeInstanceOf(ConvexError);
    // Audit log emitted with self_deletion_forbidden
    const auditCall = mockCreateAuditLog.mock.calls.find((c) => {
      const payload = c[1] as { errorMessage?: string };
      return payload.errorMessage === 'self_deletion_forbidden';
    });
    expect(auditCall).toBeDefined();
  });

  it('rejects when rate limiter says not ok', async () => {
    mockRateLimit.mockResolvedValue({ ok: false, retryAfter: 60_000 });
    const erasure = await loadErasure();
    const state: MockState = {
      tables: {},
      patches: [],
      inserts: [],
      cancels: [],
    };
    const ctx = createMockCtx(state);
    await expect(
      erasure.requestErasure.handler(ctx, {
        organizationId: 'org_A',
        userId: 'subject',
        reason: 'should be rate-limited',
        reasonCode: 'consent_withdrawn',
      }),
    ).rejects.toBeInstanceOf(ConvexError);
    const auditCall = mockCreateAuditLog.mock.calls.find((c) => {
      const payload = c[1] as { errorMessage?: string };
      return payload.errorMessage === 'rate_limited';
    });
    expect(auditCall).toBeDefined();
  });
});
