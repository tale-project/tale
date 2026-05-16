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

vi.mock('../lib/rate_limiter', () => ({
  rateLimiter: {
    limit: vi.fn(async () => ({ ok: true })),
  },
}));

vi.mock('./dsar_policy', () => ({
  getDsarPolicy: vi.fn(async () => ({
    coolingOffHours: 0,
    requireDualApproval: false,
    dailyLimitPerAdmin: 5,
  })),
}));

vi.mock('../notifications/helpers', () => ({
  writeNotificationForOrgs: vi.fn(async () => undefined),
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
    scheduler: { runAfter: vi.fn(async () => 'scheduled') },
  };
}

const ADMIN = { _id: 'admin_user', email: 'admin@example.com' };

describe('activeErasureClaims (H1, H2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockResolvedValue(ADMIN);
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  it('two sequential requestErasure on same subject — second throws ALREADY_PENDING with winner requestId', async () => {
    const erasure = await loadErasure();
    const state: MockState = { tables: {}, patches: [], inserts: [] };
    const ctx = createMockCtx(state);

    // First call succeeds, inserts row + claim
    await erasure.requestErasure.handler(ctx, {
      organizationId: 'org_A',
      userId: 'subject',
      reason: 'consent withdrawn',
      reasonCode: 'consent_withdrawn',
    });
    const winnerId =
      (state.tables.gdprErasureRequests ?? [])[0]?._id ?? 'unknown';
    expect(state.tables.activeErasureClaims?.[0]?.requestId).toBe(winnerId);

    // Second call sees the claim → throws ALREADY_PENDING
    await expect(
      erasure.requestErasure.handler(ctx, {
        organizationId: 'org_A',
        userId: 'subject',
        reason: 'duplicate filing',
        reasonCode: 'consent_withdrawn',
      }),
    ).rejects.toBeInstanceOf(ConvexError);

    // Only one receipt row was inserted
    expect(state.tables.gdprErasureRequests?.length).toBe(1);
  });

  it('finalizeProcessing on done clears the claim — next requestErasure for same subject succeeds', async () => {
    const erasure = await loadErasure();
    const state: MockState = { tables: {}, patches: [], inserts: [] };
    const ctx = createMockCtx(state);
    await erasure.requestErasure.handler(ctx, {
      organizationId: 'org_A',
      userId: 'subject',
      reason: 'consent withdrawn',
      reasonCode: 'consent_withdrawn',
    });
    const winnerId = (state.tables.gdprErasureRequests ?? [])[0]?._id;
    expect(winnerId).toBeDefined();
    if (!winnerId) throw new Error('expected receipt row');

    // Promote to running so finalize can transition done
    await ctx.db.patch(winnerId, { status: 'running', threadsTargeted: [] });

    await erasure.finalizeProcessing.handler(ctx, {
      requestId: winnerId,
      threadsErased: 0,
      ragDocumentsRemoved: 0,
    });
    // Claim cleared
    expect(state.tables.activeErasureClaims?.[0]?.requestId).toBeUndefined();

    // Now a fresh requestErasure on same subject succeeds
    await erasure.requestErasure.handler(ctx, {
      organizationId: 'org_A',
      userId: 'subject',
      reason: 'subsequent request',
      reasonCode: 'no_longer_necessary',
    });
    expect(state.tables.gdprErasureRequests?.length).toBe(2);
  });

  it('ALREADY_PENDING fires when claim points to a partial row (H2)', async () => {
    const erasure = await loadErasure();
    const state: MockState = {
      tables: {
        gdprErasureRequests: [
          {
            _id: 'er_old',
            status: 'partial',
            organizationId: 'org_A',
            targetUserId: 'subject',
          },
        ],
        activeErasureClaims: [
          {
            _id: 'claim_old',
            organizationId: 'org_A',
            targetUserId: 'subject',
            requestId: 'er_old',
            claimedAt: 1,
          },
        ],
      },
      patches: [],
      inserts: [],
    };
    const ctx = createMockCtx(state);

    await expect(
      erasure.requestErasure.handler(ctx, {
        organizationId: 'org_A',
        userId: 'subject',
        reason: 'duplicate',
        reasonCode: 'consent_withdrawn',
      }),
    ).rejects.toBeInstanceOf(ConvexError);
    // No new receipt inserted
    expect(state.tables.gdprErasureRequests?.length).toBe(1);
  });

  it('recoverStuckErasureRequests (watchdog) clears claim on running→failed', async () => {
    const erasure = await loadErasure();
    const oldStartedAt = Date.now() - 36 * 60 * 1000;
    const state: MockState = {
      tables: {
        gdprErasureRequests: [
          {
            _id: 'er_stuck',
            status: 'running',
            organizationId: 'org_A',
            targetUserId: 'subject',
            requestedAt: oldStartedAt,
            startedAt: oldStartedAt,
            requestedBy: 'admin',
          },
        ],
        activeErasureClaims: [
          {
            _id: 'claim_stuck',
            organizationId: 'org_A',
            targetUserId: 'subject',
            requestId: 'er_stuck',
            claimedAt: oldStartedAt,
          },
        ],
      },
      patches: [],
      inserts: [],
    };
    const ctx = createMockCtx(state);
    const result = await erasure.recoverStuckErasureRequests.handler(ctx, {});
    expect((result as { recovered: number }).recovered).toBe(1);
    expect(state.tables.activeErasureClaims?.[0]?.requestId).toBeUndefined();
  });

  it('retryErasureRequest after watchdog re-acquires the claim', async () => {
    const erasure = await loadErasure();
    const state: MockState = {
      tables: {
        gdprErasureRequests: [
          {
            _id: 'er_failed',
            status: 'failed',
            organizationId: 'org_A',
            targetUserId: 'subject',
            errorMessage: 'Erasure timed out (watchdog)',
            requestedBy: 'admin_user',
          },
        ],
        activeErasureClaims: [
          {
            _id: 'claim_cleared',
            organizationId: 'org_A',
            targetUserId: 'subject',
            requestId: undefined,
            claimedAt: 1,
          },
        ],
      },
      patches: [],
      inserts: [],
    };
    const ctx = createMockCtx(state);
    await erasure.retryErasureRequest.handler(ctx, {
      requestId: 'er_failed',
    });
    // Claim re-acquired pointing at the retried row
    expect(state.tables.activeErasureClaims?.[0]?.requestId).toBe('er_failed');
    // Row flipped to pending
    expect(state.tables.gdprErasureRequests?.[0]?.status).toBe('pending');
    // Processor re-scheduled
    expect(ctx.scheduler.runAfter).toHaveBeenCalled();
  });
});
