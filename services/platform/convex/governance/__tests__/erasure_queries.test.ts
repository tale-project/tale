import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_generated/api', () => ({
  components: {
    betterAuth: { adapter: { findMany: 'betterAuth:adapter:findMany' } },
  },
}));

const mockGetAuthUser = vi.fn();
vi.mock('../../auth', () => ({
  authComponent: {
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
}));

const mockGetOrganizationMember = vi.fn();
vi.mock('../../lib/rls/organization/get_organization_member', () => ({
  getOrganizationMember: (...args: unknown[]) =>
    mockGetOrganizationMember(...args),
}));

const mockGetUserNamesBatch = vi.fn(async () => new Map<string, string>());
vi.mock('../../documents/get_user_names_batch', () => ({
  getUserNamesBatch: () => mockGetUserNamesBatch(),
}));

const mockGetResourceAuditTrail = vi.fn(async () => [] as unknown[]);
vi.mock('../../audit_logs/helpers', () => ({
  getResourceAuditTrail: () => mockGetResourceAuditTrail(),
}));

vi.mock('../../audit_logs/validators', () => ({
  auditLogItemValidator: 'auditLogItem:validator',
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
  };
});

vi.mock('convex/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('convex/server')>();
  return {
    ...actual,
    paginationOptsValidator: 'paginationOpts:validator',
  };
});

vi.mock('../../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    query: (config: Record<string, unknown>) => config,
  };
});

interface MockErasureRow {
  _id: string;
  organizationId: string;
  targetUserId: string;
  reason: string;
  reasonCode?: string;
  requestedBy: string;
  requestedAt: number;
  slaDeadlineAt: number;
  status: 'pending' | 'running' | 'done' | 'partial' | 'failed' | 'blocked';
  threadsTargeted?: string[];
  threadsErased?: number;
  threadsBlockedByHold?: string[];
  documentsBlockedByHold?: string[];
  ragDocumentsRemoved?: number;
  documentsErased?: number;
  documentsSkippedByHold?: number;
  errorMessage?: string;
  startedAt?: number;
  completedAt?: number;
  extensionGrantedAt?: number;
  extensionGrantedBy?: string;
  extensionReason?: string;
  extensionDeadlineAt?: number;
}

function makeBuilder(rows: MockErasureRow[]) {
  return {
    withIndex: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    paginate: vi.fn().mockResolvedValue({
      page: rows,
      isDone: true,
      continueCursor: '',
    }),
  };
}

function createMockCtx(rows: MockErasureRow[] = []) {
  return {
    db: {
      query: vi.fn((table: string) => {
        if (table === 'gdprErasureRequests') return makeBuilder(rows);
        return makeBuilder([]);
      }),
      get: vi.fn((id: string) =>
        Promise.resolve(rows.find((r) => r._id === id) ?? null),
      ),
    },
  };
}

const ADMIN_USER = { _id: 'admin_user', email: 'admin@example.com' };
const MEMBER_USER = { _id: 'member_user', email: 'member@example.com' };

const PAGINATION = { numItems: 10, cursor: null };

async function importQueries() {
  return import('../erasure_queries');
}

const baseRow: MockErasureRow = {
  _id: 'er_1',
  organizationId: 'org_1',
  targetUserId: 'user_target',
  reason: 'consent withdrawn — verified by HR ticket #4711',
  reasonCode: 'consent_withdrawn',
  requestedBy: 'admin_user',
  requestedAt: 1_700_000_000_000,
  slaDeadlineAt: 1_700_000_000_000 + 30 * 86_400_000,
  status: 'done',
  threadsTargeted: ['t1', 't2'],
  threadsErased: 2,
  ragDocumentsRemoved: 3,
};

describe('listErasureRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when not authenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const { listErasureRequests } = (await importQueries()) as unknown as {
      listErasureRequests: { handler: Function };
    };
    const ctx = createMockCtx();
    await expect(
      listErasureRequests.handler(ctx, {
        paginationOpts: PAGINATION,
        organizationId: 'org_1',
      }),
    ).rejects.toThrow('Unauthenticated');
  });

  it('throws when caller is not an admin', async () => {
    mockGetAuthUser.mockResolvedValue(MEMBER_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'member' });
    const { listErasureRequests } = (await importQueries()) as unknown as {
      listErasureRequests: { handler: Function };
    };
    const ctx = createMockCtx();
    await expect(
      listErasureRequests.handler(ctx, {
        paginationOpts: PAGINATION,
        organizationId: 'org_1',
      }),
    ).rejects.toThrow('Admin role required.');
  });

  it('shapes summaries with names resolved and threadsTargeted as a count', async () => {
    mockGetAuthUser.mockResolvedValue(ADMIN_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    mockGetUserNamesBatch.mockResolvedValue(
      new Map<string, string>([
        ['user_target', 'Subject Person'],
        ['admin_user', 'Admin One'],
      ]),
    );
    const { listErasureRequests } = (await importQueries()) as unknown as {
      listErasureRequests: { handler: Function };
    };
    const ctx = createMockCtx([baseRow]);
    const result = await listErasureRequests.handler(ctx, {
      paginationOpts: PAGINATION,
      organizationId: 'org_1',
    });
    expect(result.page).toHaveLength(1);
    expect(result.page[0]).toMatchObject({
      _id: 'er_1',
      targetUserName: 'Subject Person',
      requestedByName: 'Admin One',
      threadsTargeted: 2,
      reasonCode: 'consent_withdrawn',
    });
  });

  it('filters by multi-status set in-memory', async () => {
    // Multi-status filter takes the post-fetch branch — verify it
    // narrows the result set to the requested statuses.
    mockGetAuthUser.mockResolvedValue(ADMIN_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    const rows: MockErasureRow[] = [
      { ...baseRow, _id: 'er_p', status: 'partial' },
      { ...baseRow, _id: 'er_b', status: 'blocked' },
      { ...baseRow, _id: 'er_d', status: 'done' },
    ];
    const { listErasureRequests } = (await importQueries()) as unknown as {
      listErasureRequests: { handler: Function };
    };
    const ctx = createMockCtx(rows);
    const result = await listErasureRequests.handler(ctx, {
      paginationOpts: PAGINATION,
      organizationId: 'org_1',
      statuses: ['partial', 'blocked'],
    });
    expect(result.page.map((r: { _id: string }) => r._id).sort()).toEqual([
      'er_b',
      'er_p',
    ]);
  });

  it("includes 'blocked' as a valid filter status", async () => {
    // Live enum has 6 values including blocked; the issue body listed only
    // 5. Lock in that the query accepts blocked.
    mockGetAuthUser.mockResolvedValue(ADMIN_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    const rows: MockErasureRow[] = [
      { ...baseRow, _id: 'er_b', status: 'blocked' },
    ];
    const { listErasureRequests } = (await importQueries()) as unknown as {
      listErasureRequests: { handler: Function };
    };
    const ctx = createMockCtx(rows);
    const result = await listErasureRequests.handler(ctx, {
      paginationOpts: PAGINATION,
      organizationId: 'org_1',
      statuses: ['blocked'],
    });
    expect(result.page).toHaveLength(1);
    expect(result.page[0].status).toBe('blocked');
  });
});

describe('getErasureRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when the request does not exist', async () => {
    const { getErasureRequest } = (await importQueries()) as unknown as {
      getErasureRequest: { handler: Function };
    };
    const ctx = createMockCtx([]);
    await expect(
      getErasureRequest.handler(ctx, { requestId: 'er_missing' }),
    ).rejects.toThrow('Erasure request does not exist.');
  });

  it('throws when the caller is not an admin of the request org', async () => {
    mockGetAuthUser.mockResolvedValue(MEMBER_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'member' });
    const { getErasureRequest } = (await importQueries()) as unknown as {
      getErasureRequest: { handler: Function };
    };
    const ctx = createMockCtx([baseRow]);
    await expect(
      getErasureRequest.handler(ctx, { requestId: 'er_1' }),
    ).rejects.toThrow('Admin role required.');
  });

  it('returns row plus the gdpr_erasure_* audit chain', async () => {
    mockGetAuthUser.mockResolvedValue(ADMIN_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    mockGetUserNamesBatch.mockResolvedValue(
      new Map<string, string>([['user_target', 'Subject Person']]),
    );
    mockGetResourceAuditTrail.mockResolvedValue([
      { action: 'gdpr_erasure_requested', resourceId: 'user_target' },
      { action: 'unrelated_event', resourceId: 'user_target' },
      { action: 'gdpr_erasure_executed', resourceId: 'user_target' },
    ]);
    const { getErasureRequest } = (await importQueries()) as unknown as {
      getErasureRequest: { handler: Function };
    };
    const ctx = createMockCtx([baseRow]);
    const result = await getErasureRequest.handler(ctx, {
      requestId: 'er_1',
    });
    expect(result.request._id).toBe('er_1');
    expect(result.request.targetUserName).toBe('Subject Person');
    expect(
      result.auditEntries.map((e: { action: string }) => e.action),
    ).toEqual(['gdpr_erasure_requested', 'gdpr_erasure_executed']);
  });
});
