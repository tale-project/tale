import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth:adapter:findMany',
      },
    },
  },
}));

const mockGetAuthUser = vi.fn();
vi.mock('../../auth', () => ({
  authComponent: {
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
}));

const mockGetOrganizationMember = vi.fn();
vi.mock('../../lib/rls', () => ({
  getOrganizationMember: (...args: unknown[]) =>
    mockGetOrganizationMember(...args),
}));

const mockGetUserNamesBatch = vi.fn(async () => new Map<string, string>());
vi.mock('../../documents/get_user_names_batch', () => ({
  getUserNamesBatch: () => mockGetUserNamesBatch(),
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

interface MockHold {
  _id: string;
  organizationId: string;
  targetType: 'thread' | 'document' | 'execution' | 'userMembership' | 'org';
  targetId: string;
  reason: string;
  matterRef?: string;
  placedBy: string;
  placedAt: number;
  releasedAt?: number;
  releasedBy?: string;
  releaseReason?: string;
}

interface MockReleaseRequest {
  _id: string;
  organizationId: string;
  holdId: string;
  requestedBy: string;
  requestedAt: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'effected';
  approvedBy?: string;
  approvedAt?: number;
  effectiveAt?: number;
  rejectedBy?: string;
  rejectedAt?: number;
  rejectReason?: string;
}

function makeBuilder(rows: unknown[]) {
  const builder = {
    withIndex: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(rows[0] ?? null),
    collect: vi.fn().mockResolvedValue(rows),
    paginate: vi.fn().mockResolvedValue({
      page: rows,
      isDone: true,
      continueCursor: '',
    }),
  };
  return builder;
}

function createMockCtx({
  holds = [],
  releaseRequests = [],
  matters = [],
}: {
  holds?: MockHold[];
  releaseRequests?: MockReleaseRequest[];
  matters?: Array<{ _id: string; organizationId: string; name: string }>;
} = {}) {
  return {
    db: {
      query: vi.fn((table: string) => {
        if (table === 'legalHolds') return makeBuilder(holds);
        if (table === 'legalHoldReleaseRequests')
          return makeBuilder(releaseRequests);
        if (table === 'legalMatters') return makeBuilder(matters);
        return makeBuilder([]);
      }),
      get: vi.fn((id: string) => {
        const matter = matters.find((m) => m._id === id);
        if (matter) return Promise.resolve(matter);
        const hold = holds.find((h) => h._id === id);
        if (hold) return Promise.resolve(hold);
        return Promise.resolve(null);
      }),
    },
  };
}

const ADMIN_USER = { _id: 'admin_user', email: 'admin@example.com' };
const MEMBER_USER = { _id: 'member_user', email: 'member@example.com' };

async function importQueries() {
  return import('../legal_hold_queries');
}

describe('legal_hold_queries.listLegalHolds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when not authenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const { listLegalHolds } = (await importQueries()) as unknown as {
      listLegalHolds: { handler: Function };
    };
    const ctx = createMockCtx();
    await expect(
      listLegalHolds.handler(ctx, { organizationId: 'org_1' }),
    ).rejects.toThrow('Unauthenticated');
  });

  it('throws when caller is not an admin', async () => {
    mockGetAuthUser.mockResolvedValue(MEMBER_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'member' });
    const { listLegalHolds } = (await importQueries()) as unknown as {
      listLegalHolds: { handler: Function };
    };
    const ctx = createMockCtx();
    await expect(
      listLegalHolds.handler(ctx, { organizationId: 'org_1' }),
    ).rejects.toThrow('Admin role required.');
  });

  it('returns empty array when org has no holds', async () => {
    mockGetAuthUser.mockResolvedValue(ADMIN_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    const { listLegalHolds } = (await importQueries()) as unknown as {
      listLegalHolds: { handler: Function };
    };
    const ctx = createMockCtx({ holds: [] });
    const result = await listLegalHolds.handler(ctx, {
      organizationId: 'org_1',
    });
    expect(result).toEqual([]);
  });

  it("filters released holds when status is 'active' (default)", async () => {
    mockGetAuthUser.mockResolvedValue(ADMIN_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    const { listLegalHolds } = (await importQueries()) as unknown as {
      listLegalHolds: { handler: Function };
    };
    const ctx = createMockCtx({
      holds: [
        {
          _id: 'h1',
          organizationId: 'org_1',
          targetType: 'thread',
          targetId: 't1',
          reason: 'r1',
          placedBy: 'u1',
          placedAt: 1,
        },
        {
          _id: 'h2',
          organizationId: 'org_1',
          targetType: 'thread',
          targetId: 't2',
          reason: 'r2',
          placedBy: 'u1',
          placedAt: 2,
          releasedAt: 3,
          releasedBy: 'u1',
        },
      ],
    });
    const result = await listLegalHolds.handler(ctx, {
      organizationId: 'org_1',
    });
    expect(result).toHaveLength(1);
    expect(result[0]._id).toBe('h1');
  });

  it("returns only released holds when status is 'released'", async () => {
    mockGetAuthUser.mockResolvedValue(ADMIN_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    const { listLegalHolds } = (await importQueries()) as unknown as {
      listLegalHolds: { handler: Function };
    };
    const ctx = createMockCtx({
      holds: [
        {
          _id: 'h1',
          organizationId: 'org_1',
          targetType: 'thread',
          targetId: 't1',
          reason: 'r1',
          placedBy: 'u1',
          placedAt: 1,
        },
        {
          _id: 'h2',
          organizationId: 'org_1',
          targetType: 'thread',
          targetId: 't2',
          reason: 'r2',
          placedBy: 'u1',
          placedAt: 2,
          releasedAt: 3,
          releasedBy: 'u1',
        },
      ],
    });
    const result = await listLegalHolds.handler(ctx, {
      organizationId: 'org_1',
      status: 'released',
    });
    expect(result).toHaveLength(1);
    expect(result[0]._id).toBe('h2');
  });
});

describe('legal_hold_queries.getLegalHoldByTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('strips reason/matterRef/placedBy for non-admin members', async () => {
    mockGetAuthUser.mockResolvedValue(MEMBER_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'member' });
    const { getLegalHoldByTarget } = (await importQueries()) as unknown as {
      getLegalHoldByTarget: { handler: Function };
    };
    const ctx = createMockCtx({
      holds: [
        {
          _id: 'h1',
          organizationId: 'org_1',
          targetType: 'thread',
          targetId: 't1',
          reason: 'sensitive case Acme v. Co.',
          matterRef: 'matter_xyz',
          placedBy: 'u1',
          placedAt: 1,
        },
      ],
      releaseRequests: [],
    });

    const result = await getLegalHoldByTarget.handler(ctx, {
      organizationId: 'org_1',
      targetType: 'thread',
      targetId: 't1',
    });

    expect(result).not.toBeNull();
    expect(result.view).toBe('member');
    expect(result.reason).toBeUndefined();
    expect(result.matterRef).toBeUndefined();
    expect(result.placedBy).toBeUndefined();
    expect(result.placedByName).toBeUndefined();
    expect(result.targetId).toBe('t1');
    expect(result.placedAt).toBe(1);
    expect(result.hasPendingRelease).toBe(false);
    expect(result.hasApprovedRelease).toBe(false);
  });

  it('returns full row including reason for admin callers', async () => {
    mockGetAuthUser.mockResolvedValue(ADMIN_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    const { getLegalHoldByTarget } = (await importQueries()) as unknown as {
      getLegalHoldByTarget: { handler: Function };
    };
    const ctx = createMockCtx({
      holds: [
        {
          _id: 'h1',
          organizationId: 'org_1',
          targetType: 'thread',
          targetId: 't1',
          reason: 'sensitive case Acme v. Co.',
          placedBy: 'u1',
          placedAt: 1,
        },
      ],
      releaseRequests: [],
    });

    const result = await getLegalHoldByTarget.handler(ctx, {
      organizationId: 'org_1',
      targetType: 'thread',
      targetId: 't1',
    });

    expect(result).not.toBeNull();
    expect(result.view).toBe('admin');
    expect(result.reason).toBe('sensitive case Acme v. Co.');
    expect(result.placedBy).toBe('u1');
  });

  it('returns null when no active hold exists', async () => {
    mockGetAuthUser.mockResolvedValue(MEMBER_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'member' });
    const { getLegalHoldByTarget } = (await importQueries()) as unknown as {
      getLegalHoldByTarget: { handler: Function };
    };
    const ctx = createMockCtx({ holds: [] });
    const result = await getLegalHoldByTarget.handler(ctx, {
      organizationId: 'org_1',
      targetType: 'thread',
      targetId: 't1',
    });
    expect(result).toBeNull();
  });
});

describe('legal_hold_queries.listActiveHoldTargetIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only target ids of active (un-released) holds', async () => {
    mockGetAuthUser.mockResolvedValue(MEMBER_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'member' });
    const { listActiveHoldTargetIds } = (await importQueries()) as unknown as {
      listActiveHoldTargetIds: { handler: Function };
    };
    const ctx = createMockCtx({
      holds: [
        {
          _id: 'h1',
          organizationId: 'org_1',
          targetType: 'thread',
          targetId: 't1',
          reason: 'r',
          placedBy: 'u1',
          placedAt: 1,
        },
        {
          _id: 'h2',
          organizationId: 'org_1',
          targetType: 'thread',
          targetId: 't2',
          reason: 'r',
          placedBy: 'u1',
          placedAt: 2,
          releasedAt: 3,
        },
      ],
    });
    const result = await listActiveHoldTargetIds.handler(ctx, {
      organizationId: 'org_1',
      targetType: 'thread',
    });
    expect(result.targetIds).toEqual(['t1']);
  });
});
