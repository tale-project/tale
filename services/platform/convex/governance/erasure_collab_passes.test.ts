import { describe, it, expect, vi, beforeEach } from 'vitest';

// The three per-user erasure passes added for the collab/notifications tables
// (userNotifications, notificationPreferences, taskSubscriptions). Mirrors the
// mock-ctx idiom of erasure_cross_org.test.ts: `_generated/server` is replaced
// with identity factories so each internalMutation's `.handler` is callable,
// and `legal_hold.loadActiveHolds` is mocked so we can drive the hold path.

vi.mock('../_generated/api', () => ({
  components: {
    betterAuth: { adapter: { findMany: 'betterAuth:adapter:findMany' } },
  },
  internal: { governance: { erasure: {} } },
}));

const mockLoadActiveHolds = vi.fn(async () => ({
  orgHeld: false,
  userMembershipIds: new Set<string>(),
}));
vi.mock('./legal_hold', () => ({
  loadActiveHolds: () => mockLoadActiveHolds(),
}));

vi.mock('../lib/helpers/pii_hash', () => ({ hashEmailForAudit: vi.fn() }));
vi.mock('../discussions/thread_cascade', () => ({
  cascadeDeleteThreadChildren: vi.fn(),
}));
vi.mock('./erase_document_blobs', () => ({ eraseDocumentBlobs: vi.fn() }));
vi.mock('../lib/rate_limiter', () => ({
  rateLimiter: { limit: vi.fn(async () => ({ ok: true })) },
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

// oxlint-disable-next-line typescript/no-explicit-any -- vi.mock above narrows the runtime shape to { handler }
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

function buildQueryRunner(rows: DbRow[]) {
  let active: Record<string, unknown> = {};
  const builder = {
    withIndex: (
      _name: string,
      fn: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
    ) => {
      const filter: Record<string, unknown> = {};
      const q = {
        eq(field: string, value: unknown) {
          filter[field] = value;
          return q;
        },
      };
      fn(q);
      active = filter;
      return builder;
    },
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
          return { value: matches[i++], done: false };
        },
      };
    },
  };
  return builder;
}

function createMockCtx(tables: Record<string, DbRow[]>) {
  const deleted: string[] = [];
  const ctx = {
    db: {
      query: vi.fn((table: string) => buildQueryRunner(tables[table] ?? [])),
      delete: vi.fn(async (id: string) => {
        deleted.push(id);
      }),
    },
  };
  return { ctx, deleted };
}

describe('eraseSubject collab/notification passes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadActiveHolds.mockResolvedValue({
      orgHeld: false,
      userMembershipIds: new Set<string>(),
    });
  });

  it('eraseSubjectUserNotifications deletes only the subject org+user rows', async () => {
    const erasure = await loadErasure();
    const { ctx, deleted } = createMockCtx({
      userNotifications: [
        { _id: 'n1', userId: 'user_1', organizationId: 'org_1' },
        { _id: 'n2', userId: 'user_1', organizationId: 'org_1' },
        { _id: 'n3', userId: 'user_2', organizationId: 'org_1' }, // other user
        { _id: 'n4', userId: 'user_1', organizationId: 'org_2' }, // other org
      ],
    });
    const res = await erasure.eraseSubjectUserNotifications.handler(ctx, {
      organizationId: 'org_1',
      userId: 'user_1',
    });
    expect(res).toEqual({ rows: 2, skippedByHold: 0 });
    expect(deleted).toEqual(['n1', 'n2']);
  });

  it('eraseSubjectNotificationPreferences deletes the subject row', async () => {
    const erasure = await loadErasure();
    const { ctx, deleted } = createMockCtx({
      notificationPreferences: [
        { _id: 'p1', userId: 'user_1', organizationId: 'org_1' },
        { _id: 'p2', userId: 'user_2', organizationId: 'org_1' },
      ],
    });
    const res = await erasure.eraseSubjectNotificationPreferences.handler(ctx, {
      organizationId: 'org_1',
      userId: 'user_1',
    });
    expect(res).toEqual({ rows: 1, skippedByHold: 0 });
    expect(deleted).toEqual(['p1']);
  });

  it('eraseSubjectTaskSubscriptions deletes the user subs but NOT agent subs', async () => {
    const erasure = await loadErasure();
    const { ctx, deleted } = createMockCtx({
      taskSubscriptions: [
        {
          _id: 's1',
          organizationId: 'org_1',
          subscriberType: 'user',
          subscriberId: 'user_1',
        },
        {
          _id: 's2',
          organizationId: 'org_1',
          subscriberType: 'agent', // must NOT match
          subscriberId: 'user_1',
        },
        {
          _id: 's3',
          organizationId: 'org_1',
          subscriberType: 'user',
          subscriberId: 'user_2', // other user
        },
        {
          _id: 's4',
          organizationId: 'org_2', // other org
          subscriberType: 'user',
          subscriberId: 'user_1',
        },
      ],
    });
    const res = await erasure.eraseSubjectTaskSubscriptions.handler(ctx, {
      organizationId: 'org_1',
      userId: 'user_1',
    });
    expect(res).toEqual({ rows: 1, skippedByHold: 0 });
    expect(deleted).toEqual(['s1']);
  });

  it('skips deletion and counts skippedByHold when the subject is under legal hold', async () => {
    mockLoadActiveHolds.mockResolvedValue({
      orgHeld: false,
      userMembershipIds: new Set<string>(['user_1']),
    });
    const erasure = await loadErasure();
    const { ctx, deleted } = createMockCtx({
      userNotifications: [
        { _id: 'n1', userId: 'user_1', organizationId: 'org_1' },
        { _id: 'n2', userId: 'user_1', organizationId: 'org_1' },
      ],
    });
    const res = await erasure.eraseSubjectUserNotifications.handler(ctx, {
      organizationId: 'org_1',
      userId: 'user_1',
    });
    expect(res).toEqual({ rows: 0, skippedByHold: 2 });
    expect(deleted).toEqual([]);
  });
});
