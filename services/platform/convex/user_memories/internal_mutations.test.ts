import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../_generated/api', () => ({
  internal: {
    user_memory_audit_log: {
      internal_mutations: {
        appendAudit: 'appendAudit',
      },
    },
  },
}));

vi.mock('../_generated/server', () => ({
  internalMutation: (config: Record<string, unknown>) => config,
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
    ConvexError: class ConvexError extends Error {
      data: unknown;
      constructor(data: unknown) {
        super(typeof data === 'string' ? data : 'ConvexError');
        this.data = data;
      }
    },
  };
});

vi.mock('./lazy_cleanup', () => ({
  maybeRunCleanup: vi.fn().mockResolvedValue(undefined),
}));

const evaluateGates = vi.fn();
vi.mock('../personalization/internal_queries', () => ({
  evaluatePersonalizationGates: (...args: unknown[]): Promise<boolean> =>
    evaluateGates(...args),
}));

interface FakeMemoryRow {
  _id: string;
  userId: string;
  organizationId: string;
  source: 'manual' | 'agent_proposed';
  status: 'pending' | 'approved';
  sourceThreadId?: string;
  pendingExpiresAt?: number;
  deletedAt?: number;
  createdAt: number;
}

interface FakeAuditRow {
  _id: string;
  organizationId: string;
  subjectUserId: string;
  action: string;
  outcome: string;
  createdAt: number;
}

function createMockCtx({
  memories = [],
  auditRows = [],
}: {
  memories?: FakeMemoryRow[];
  auditRows?: FakeAuditRow[];
}) {
  const inserted: FakeMemoryRow[] = [];
  const auditCalls: Array<Record<string, unknown>> = [];

  const ctx = {
    runMutation: vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
      // Only the audit log writer is invoked from writeProposal.
      auditCalls.push(args);
    }),
    db: {
      query: vi.fn((table: string) => {
        if (table === 'userMemoryAuditLog') {
          return {
            withIndex: (_name: string, cb: (q: unknown) => unknown) => {
              const builder: unknown = {
                eq: () => builder,
                gte: () => builder,
              };
              cb(builder);
              return { collect: async () => auditRows };
            },
          };
        }
        return {
          withIndex: (_name: string, cb: (q: unknown) => unknown) => {
            const builder: unknown = { eq: () => builder };
            cb(builder);
            return { collect: async () => memories };
          },
        };
      }),
      insert: vi.fn(async (_table: string, doc: FakeMemoryRow) => {
        const id = `mem_${inserted.length + 1}`;
        inserted.push({ ...doc, _id: id });
        return id;
      }),
    },
  };

  return { ctx, inserted, auditCalls };
}

async function getHandler() {
  const { writeProposal } = await import('./internal_mutations');
  return (writeProposal as unknown as { handler: Function }).handler;
}

const BASE_ARGS = {
  userId: 'u_1',
  organizationId: 'o_1',
  threadId: 't_1',
  content: 'loves chess',
  pendingTtlMs: 24 * 60 * 60 * 1000,
  perThreadCap: 3,
  perDayCap: 20,
};

describe('writeProposal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evaluateGates.mockReset();
  });

  it('rejects when personalization gates evaluate to false (default-OFF / org disabled / prefs.enabled=false / threadDisable)', async () => {
    evaluateGates.mockResolvedValue(false);
    const { ctx, inserted, auditCalls } = createMockCtx({});
    const handler = await getHandler();

    const result = await handler(ctx, BASE_ARGS);

    expect(result).toMatchObject({ ok: false });
    expect(inserted).toHaveLength(0);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      action: 'propose',
      outcome: 'denied',
    });
  });

  it('rejects content with disallowed characters even when gates pass', async () => {
    evaluateGates.mockResolvedValue(true);
    const { ctx, inserted, auditCalls } = createMockCtx({});
    const handler = await getHandler();

    const result = await handler(ctx, {
      ...BASE_ARGS,
      content: 'has\nnewline',
    });

    expect(result).toMatchObject({ ok: false });
    expect(inserted).toHaveLength(0);
    expect(auditCalls[0]).toMatchObject({ outcome: 'denied' });
  });

  it('counts dismissed proposals via audit rows so dismiss-then-propose loops cannot bypass the daily cap', async () => {
    evaluateGates.mockResolvedValue(true);
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const auditRows: FakeAuditRow[] = Array.from({ length: 20 }, (_, i) => ({
      _id: `aud_${i}`,
      organizationId: 'o_1',
      subjectUserId: 'u_1',
      action: 'propose',
      outcome: 'ok',
      createdAt: now - i * 60_000,
    }));
    const { ctx, inserted } = createMockCtx({ auditRows });
    const handler = await getHandler();

    const result = await handler(ctx, BASE_ARGS);

    expect(result).toMatchObject({ ok: false });
    expect(result.reason).toMatch(/Daily memory proposal cap/);
    expect(inserted).toHaveLength(0);

    // Sanity: the cap check uses the 24h window, not just live rows. The
    // audit rows are within `dayMs` of now, so all 20 count.
    expect(auditRows.filter((r) => r.createdAt >= now - dayMs)).toHaveLength(
      20,
    );
  });

  it('inserts a pending row and writes ok audit on the happy path', async () => {
    evaluateGates.mockResolvedValue(true);
    const { ctx, inserted, auditCalls } = createMockCtx({});
    const handler = await getHandler();

    const result = await handler(ctx, BASE_ARGS);

    expect(result).toMatchObject({ ok: true });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      userId: 'u_1',
      organizationId: 'o_1',
      content: 'loves chess',
      source: 'agent_proposed',
      status: 'pending',
      sourceThreadId: 't_1',
    });
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      action: 'propose',
      outcome: 'ok',
      subjectUserId: 'u_1',
    });
  });
});
