import { ConvexError } from 'convex/values';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { UnauthorizedError } from '../lib/rls/errors';

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

// Single shared cast site: vi.mock above replaces `mutation` /
// `internalMutation` / `internalAction` with identity functions so the
// runtime shape is `{ args, returns, handler }`. The module's static
// type is still the original Convex function-reference, so we narrow
// once here and reuse across tests. Treated as a "third-party gap"
// per AGENTS.md.
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

const ADMIN_USER = { _id: 'admin_user', email: 'admin@example.com' };

interface DbRow {
  _id: string;
  [k: string]: unknown;
}

interface IndexQueryBuilder {
  withIndex: (
    name: string,
    builder: (q: IndexQ) => IndexQ,
  ) => IndexQueryBuilder;
  first: () => Promise<DbRow | null>;
  [Symbol.asyncIterator]: () => AsyncIterator<DbRow>;
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

function createMockCtx(
  tables: Record<string, DbRow[]> = {},
  patches: { id: string; patch: Record<string, unknown> }[] = [],
  inserts: { table: string; doc: Record<string, unknown> }[] = [],
) {
  return {
    db: {
      query: vi.fn((table: string) => buildQueryRunner(tables[table] ?? [])),
      get: vi.fn(async (id: string) => {
        for (const rows of Object.values(tables)) {
          const m = rows.find((r) => r._id === id);
          if (m) return m;
        }
        return null;
      }),
      patch: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      }),
      insert: vi.fn(async (table: string, doc: Record<string, unknown>) => {
        const id = `inserted_${inserts.length}`;
        inserts.push({ table, doc });
        return id;
      }),
    },
    runMutation: vi.fn(async (..._args: unknown[]) => null),
    scheduler: { runAfter: vi.fn(async () => 'scheduled') },
  };
}

describe('requestErasure cross-org IDOR guard (C1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  it('rejects when target userId is not a member of the requesting org', async () => {
    mockGetAuthUser.mockResolvedValue(ADMIN_USER);
    mockGetOrganizationMember.mockImplementation(
      async (_ctx, _orgId, user: { userId: string }) => {
        if (user.userId === 'admin_user') return { role: 'admin' };
        throw new UnauthorizedError('Not a member of organization org_A');
      },
    );
    const erasure = await loadErasure();
    const ctx = createMockCtx();
    await expect(
      erasure.requestErasure.handler(ctx, {
        organizationId: 'org_A',
        userId: 'cross_org_target',
        reason: 'attempted abuse',
        reasonCode: 'no_longer_necessary',
      }),
    ).rejects.toBeInstanceOf(ConvexError);
    // forbidden audit row was written (for cross_org_target, not for the
    // admin-role denial path)
    const auditCalls = mockCreateAuditLog.mock.calls;
    expect(auditCalls.length).toBe(1);
    const auditPayload = auditCalls[0]?.[1] as Record<string, unknown>;
    expect(auditPayload.action).toBe('gdpr_erasure_denied');
    expect(auditPayload.errorMessage).toBe('cross_org_target');
    expect(auditPayload.status).toBe('denied');
    // No receipt row written
    expect(ctx.db.insert).not.toHaveBeenCalled();
    // No processor scheduled
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it('passes when target user is a member of the same org (regression guard)', async () => {
    mockGetAuthUser.mockResolvedValue(ADMIN_USER);
    mockGetOrganizationMember.mockImplementation(async () => ({
      role: 'admin',
    }));
    const erasure = await loadErasure();
    const ctx = createMockCtx({
      gdprErasureRequests: [],
      threadMetadata: [],
    });
    await erasure.requestErasure.handler(ctx, {
      organizationId: 'org_A',
      userId: 'subject_user',
      reason: 'consent withdrawn',
      reasonCode: 'consent_withdrawn',
    });
    // Receipt row written, processor scheduled
    expect(ctx.db.insert).toHaveBeenCalledWith(
      'gdprErasureRequests',
      expect.objectContaining({
        organizationId: 'org_A',
        targetUserId: 'subject_user',
        status: 'pending',
      }),
    );
    expect(ctx.scheduler.runAfter).toHaveBeenCalled();
    // Two getOrganizationMember calls: one for caller, one for target
    expect(mockGetOrganizationMember).toHaveBeenCalledTimes(2);
    expect(mockGetOrganizationMember).toHaveBeenNthCalledWith(
      2,
      ctx,
      'org_A',
      expect.objectContaining({
        userId: 'subject_user',
        email: '',
      }),
    );
  });
});

describe('beginProcessing whitelist (M4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['blocked', 'running', 'done', 'failed'] as const)(
    'returns null for status=%s',
    async (status) => {
      const erasure = await loadErasure();
      const ctx = createMockCtx({
        gdprErasureRequests: [
          {
            _id: 'er_1',
            status,
            organizationId: 'org_A',
            targetUserId: 'subject',
            threadsTargeted: [],
            requestedBy: 'admin',
          },
        ],
      });
      const result = await erasure.beginProcessing.handler(ctx, {
        requestId: 'er_1',
      });
      expect(result).toBeNull();
      expect(ctx.db.patch).not.toHaveBeenCalled();
    },
  );

  it.each(['pending', 'partial'] as const)(
    'transitions to running for status=%s',
    async (status) => {
      const erasure = await loadErasure();
      const ctx = createMockCtx({
        gdprErasureRequests: [
          {
            _id: 'er_2',
            status,
            organizationId: 'org_A',
            targetUserId: 'subject',
            threadsTargeted: ['t_1'],
            requestedBy: 'admin',
          },
        ],
      });
      const result = await erasure.beginProcessing.handler(ctx, {
        requestId: 'er_2',
      });
      expect(result).not.toBeNull();
      expect(ctx.db.patch).toHaveBeenCalledWith(
        'er_2',
        expect.objectContaining({ status: 'running' }),
      );
    },
  );
});
