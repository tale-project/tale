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

describe('legal_hold_queries.getLegalHoldByTarget — user-custodian cascade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Cascade-aware ctx: tracks every chained `eq()` call so the mock
   * builder can resolve `first()` based on the actual filter values.
   * This lets the test return null for the direct (org, 'thread', 't1')
   * lookup while still returning a userMembership hold for the cascade
   * lookup of (org, 'userMembership', 'u1').
   */
  function createCascadeCtx({
    holds = [],
    threads = [],
    documents = [],
  }: {
    holds?: MockHold[];
    threads?: Array<{
      _id: string;
      organizationId: string;
      threadId: string;
      userId?: string;
    }>;
    documents?: Array<{
      _id: string;
      organizationId: string;
      createdBy?: string;
    }>;
  }) {
    function makeFilteringBuilder<T>(rows: T[]) {
      const captured = new Map<string, unknown>();
      const indexQ = {
        eq: (field: string, value: unknown) => {
          captured.set(field, value);
          return indexQ;
        },
      };
      const filterQ = {
        eq: (a: unknown, b: unknown) => ({
          field: a,
          value: b,
          op: 'eq',
        }),
        field: (name: string) => name,
      };
      const builder = {
        withIndex: (_indexName: string, fn: (q: unknown) => unknown) => {
          fn(indexQ);
          return builder;
        },
        filter: (_fn: (q: unknown) => unknown) => {
          // Apply the filter callback to capture (field, value) pairs.
          // Our queries always use `q.eq(q.field('releasedAt'), undefined)`
          // — capture the field name -> value into the same map.
          _fn({
            ...filterQ,
            eq: (left: unknown, right: unknown) => {
              if (typeof left === 'string') captured.set(left, right);
              return null;
            },
          });
          return builder;
        },
        order: (_dir: string) => builder,
        first: vi.fn().mockImplementation(async () => {
          const matched = rows.find((row) =>
            [...captured.entries()].every(
              ([key, value]) => (row as Record<string, unknown>)[key] === value,
            ),
          );
          return matched ?? null;
        }),
        collect: vi.fn().mockImplementation(async () => {
          if (captured.size === 0) return rows;
          return rows.filter((row) =>
            [...captured.entries()].every(
              ([key, value]) => (row as Record<string, unknown>)[key] === value,
            ),
          );
        }),
        paginate: vi.fn().mockResolvedValue({
          page: rows,
          isDone: true,
          continueCursor: '',
        }),
      };
      return builder;
    }
    return {
      db: {
        query: vi.fn((table: string) => {
          if (table === 'legalHolds') return makeFilteringBuilder(holds);
          if (table === 'threadMetadata') return makeFilteringBuilder(threads);
          if (table === 'documents') return makeFilteringBuilder(documents);
          if (table === 'legalHoldReleaseRequests')
            return makeFilteringBuilder([]);
          return makeFilteringBuilder([]);
        }),
        get: vi.fn(async (id: string) => {
          const doc = documents.find((d) => d._id === id);
          return doc ?? null;
        }),
      },
    };
  }

  it("returns a synthetic hold via='user_custodian' when thread author is held", async () => {
    mockGetAuthUser.mockResolvedValue(MEMBER_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'member' });
    const { getLegalHoldByTarget } = (await importQueries()) as unknown as {
      getLegalHoldByTarget: { handler: Function };
    };
    const ctx = createCascadeCtx({
      holds: [
        // Active userMembership hold against u1.
        {
          _id: 'h_user',
          organizationId: 'org_1',
          targetType: 'userMembership',
          targetId: 'u1',
          reason: 'custodian for matter X',
          placedBy: 'admin1',
          placedAt: 100,
        },
      ],
      threads: [
        { _id: 'tm1', organizationId: 'org_1', threadId: 't1', userId: 'u1' },
      ],
    });

    const result = await getLegalHoldByTarget.handler(ctx, {
      organizationId: 'org_1',
      targetType: 'thread',
      targetId: 't1',
    });

    expect(result).not.toBeNull();
    expect(result._id).toBe('h_user');
    expect(result.via).toBe('user_custodian');
    // Member projection — reason stripped.
    expect(result.reason).toBeUndefined();
  });

  it("returns via='direct' when the thread itself is held", async () => {
    mockGetAuthUser.mockResolvedValue(MEMBER_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'member' });
    const { getLegalHoldByTarget } = (await importQueries()) as unknown as {
      getLegalHoldByTarget: { handler: Function };
    };
    const ctx = createCascadeCtx({
      holds: [
        {
          _id: 'h_direct',
          organizationId: 'org_1',
          targetType: 'thread',
          targetId: 't1',
          reason: 'direct hold',
          placedBy: 'admin1',
          placedAt: 100,
        },
      ],
      threads: [
        { _id: 'tm1', organizationId: 'org_1', threadId: 't1', userId: 'u1' },
      ],
    });

    const result = await getLegalHoldByTarget.handler(ctx, {
      organizationId: 'org_1',
      targetType: 'thread',
      targetId: 't1',
    });

    expect(result).not.toBeNull();
    expect(result._id).toBe('h_direct');
    expect(result.via).toBe('direct');
  });

  it('returns null when neither thread nor author is held', async () => {
    mockGetAuthUser.mockResolvedValue(MEMBER_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'member' });
    const { getLegalHoldByTarget } = (await importQueries()) as unknown as {
      getLegalHoldByTarget: { handler: Function };
    };
    const ctx = createCascadeCtx({
      holds: [],
      threads: [
        { _id: 'tm1', organizationId: 'org_1', threadId: 't1', userId: 'u1' },
      ],
    });

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
